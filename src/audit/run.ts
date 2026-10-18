// Adapted from interface-craft render_audit.mjs (https://github.com/harun-yardimci/interface-craft),
// MIT License, Copyright (c) 2026 Harun Yardimci. See NOTICE.
import type { Browser, BrowserContext } from 'playwright';
import type { AuditFinding, AuditOptions, AuditReport, AuditRun, AuditSettings, Severity, Tile, StressKind } from './types.js';
import type { Policy } from '../check/types.js';
import type { Scheme } from '../theme.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from '../check/browser.js';
import { checkPage, validatePolicy } from '../check/engine.js';
import { applyTheme, contextScheme, mediaTheme } from '../theme.js';
import { pageAudit } from './page-audit.js';
import { applyStress, focusAudit, annotate, locate, snippets, shortSelectors } from './page-tools.js';
import { buildMarkdown } from './markdown.js';

export const defaultAuditSettings: AuditSettings = {
  viewports: [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }],
  themes: ['light', 'dark'],
  stress: false,
  states: [],
  stateParam: '__state',
  maxPerRule: 25,
  focus: true,
  tiles: true,
  maxHeight: 8000,
  wait: 800,
};

const SEV_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
// Audit rules that measure the same thing as a gate rule. When the gate runs, its
// measurement is the one to trust, so these leads are not repeated.
export const coveredByGate: Record<string, string> = {
  'low-contrast': 'text-contrast',
  'horizontal-scroll': 'horizontal-overflow',
  'no-accessible-name': 'accessible-name',
  'target-too-small': 'target-size',
};

interface Job { viewport: { width: number; height: number }; theme: Scheme; url: string; label: string; stress?: StressKind; name: string }

export function validateAuditSettings(input: unknown = {}): AuditSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('audit settings must be an object.');
  const settings = { ...structuredClone(defaultAuditSettings), ...input } as AuditSettings;
  for (const key of Object.keys(input)) if (!(key in defaultAuditSettings)) throw new Error(`Unknown audit field: ${key}`);
  if (!Array.isArray(settings.viewports) || !settings.viewports.length) throw new Error('audit.viewports must be a nonempty list.');
  for (const v of settings.viewports) if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['width', 'height'].includes(k)) || !Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width < 100 || v.height < 100 || v.width > 4000 || v.height > 4000) throw new Error('Each audit viewport needs integer width and height from 100 to 4000.');
  if (!Array.isArray(settings.themes) || !settings.themes.length || settings.themes.some(t => t !== 'light' && t !== 'dark')) throw new Error('audit.themes must contain light or dark.');
  if (typeof settings.stress !== 'boolean' || typeof settings.focus !== 'boolean' || typeof settings.tiles !== 'boolean') throw new Error('audit.stress, audit.focus and audit.tiles must be true or false.');
  if (!Array.isArray(settings.states) || settings.states.some(s => typeof s !== 'string' || !/^[\w-]{1,40}$/.test(s))) throw new Error('audit.states must be a list of names that use letters, digits, - or _.');
  if (typeof settings.stateParam !== 'string' || !/^[\w-]{1,40}$/.test(settings.stateParam)) throw new Error('audit.stateParam must be a query parameter name.');
  for (const [key, min, max] of [['maxPerRule', 1, 10000], ['maxHeight', 500, 8000], ['wait', 0, 60000]] as const) {
    if (!Number.isInteger(settings[key]) || settings[key] < min || settings[key] > max) throw new Error(`audit.${key} must be an integer from ${min} to ${max}.`);
  }
  return settings;
}

// Map check findings into the audit shape so one report and one screenshot show both.
async function gateFindings(page: import('playwright').Page, policy: Policy): Promise<{ findings: AuditFinding[]; error?: string }> {
  try {
    const report = await checkPage(page, policy);
    const selectors = report.findings.map(f => f.selector);
    const [rects, texts, short] = await Promise.all([locate(page, selectors), snippets(page, selectors), shortSelectors(page, selectors)]);
    return {
      findings: report.findings.map((f, i) => ({
        rule: f.rule,
        severity: f.status === 'unresolved' ? 'warn' : 'error',
        selector: short[i],
        fullSelector: f.selector,
        rect: rects[i],
        text: texts[i],
        message: f.status === 'unresolved' ? `Needs review: ${f.message}` : f.message,
        fix: f.fix,
        source: 'check',
      })),
    };
  } catch (error) {
    return { findings: [], error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
  }
}

export async function auditUrl(url: string, options: AuditOptions = {}): Promise<AuditReport> {
  const { out = 'krafta-audit', waitFor, storageState, theme = mediaTheme, policy = {}, log = () => {}, ...rest } = options;
  const settings = validateAuditSettings(rest);
  const gatePolicy = policy === false ? null : validatePolicy(policy);
  const parsed = new URL(url);
  if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error('Use an HTTP, HTTPS, or file URL.');

  const targets = [{ label: '', url }];
  for (const state of settings.states) {
    const u = new URL(url); u.searchParams.set(settings.stateParam, state);
    targets.push({ label: state, url: u.href });
  }
  const jobs: Job[] = [];
  for (const t of targets) for (const viewport of settings.viewports) {
    for (const scheme of settings.themes) jobs.push({ viewport, theme: scheme, url: t.url, label: t.label, name: `${t.label ? t.label + '-' : ''}${viewport.width}x${viewport.height}-${scheme}` });
    if (settings.stress && !t.label) for (const kind of ['pseudo', 'large-text'] as const) jobs.push({ viewport, theme: settings.themes[0], url: t.url, label: '', stress: kind, name: `${viewport.width}x${viewport.height}-${settings.themes[0]}-${kind}` });
  }

  await mkdir(out, { recursive: true });
  const runs: AuditRun[] = [], failedRuns: { name: string; error: string }[] = [];
  const shotHash: Record<string, Partial<Record<Scheme, string>>> = {};
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    for (const job of jobs) {
      const holder: { ctx?: BrowserContext } = {};
      try {
        await runJob(browser, job, holder);
      } catch (error) {
        // One broken run must not discard the others.
        const message = String(error instanceof Error ? error.message : error).split('\n')[0].slice(0, 200);
        log(`✗ ${job.name}: ${message}`);
        failedRuns.push({ name: job.name, error: message });
      } finally { await holder.ctx?.close().catch(() => {}); }
    }
  } finally { await browser?.close(); }

  async function runJob(browser: Browser, job: Job, holder: { ctx?: BrowserContext }): Promise<void> {
    const { viewport, name } = job;
    const dir = path.join(out, name);
    await mkdir(dir, { recursive: true });
    const mobile = viewport.width < 768;
    const ctx = await browser.newContext({
      viewport, deviceScaleFactor: 2, colorScheme: contextScheme(job.theme, theme),
      isMobile: mobile, hasTouch: mobile, ...(storageState ? { storageState } : {}),
    });
    holder.ctx = ctx;
    await ctx.addInitScript(() => {
      const w = window as unknown as { __kraftaCLS: number; __kraftaShifts: { value: number; sources: string[] }[] };
      w.__kraftaCLS = 0; w.__kraftaShifts = [];
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput?: boolean; value: number; sources?: { node?: Node | null }[] })[]) {
            if (entry.hadRecentInput) continue;
            w.__kraftaCLS += entry.value;
            w.__kraftaShifts.push({ value: +entry.value.toFixed(4), sources: (entry.sources || []).map(s => {
              const node = s.node as Element | null | undefined;
              if (!node || node.nodeType !== 1) return '';
              return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + (typeof node.className === 'string' && node.className ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
            }).filter(Boolean) });
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch { /* unsupported */ }
    });
    const page = await ctx.newPage();
    const notes: string[] = [], consoleErrors: string[] = [], failed: string[] = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => consoleErrors.push(String(e.message || e).slice(0, 200)));
    page.on('requestfailed', r => failed.push(`${r.failure()?.errorText || 'failed'} ${r.url().slice(0, 120)}`));
    page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url().slice(0, 120)}`); });
    let loaded = true;
    try { await page.goto(job.url, { waitUntil: 'networkidle', timeout: 45000 }); }
    catch {
      notes.push('networkidle timeout; audited after load');
      await page.goto(job.url, { waitUntil: 'load', timeout: 60000 }).catch((e: Error) => { loaded = false; notes.push('load failed: ' + e.message.split('\n')[0]); });
    }
    if (!loaded || page.url().startsWith('chrome-error://')) throw new Error(`page did not load (${notes.at(-1) || page.url()})`);
    if (!(await page.evaluate(() => !!document.body))) throw new Error('not an HTML document (no <body>); audit the HTML page that embeds it');
    await applyTheme(page, job.theme, theme);
    if (waitFor) await page.waitForSelector(waitFor, { state: 'visible', timeout: 20000 }).catch(() => notes.push(`wait-for ${waitFor} not found`));
    // Scroll through once so lazy content loads, then settle at the top.
    await page.evaluate(async () => {
      const h = () => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
      for (let y = 0, i = 0; y < h() && i < 40; y += innerHeight * 0.8, i++) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(settings.wait);
    const extra: AuditFinding[] = [];
    if (job.stress) {
      const r = await page.evaluate(applyStress, job.stress);
      await page.waitForTimeout(250);
      if (r.kind === 'pseudo') notes.push(`stress: ${r.changed} text nodes ~40% longer, Turkish characters, long unbreakable words, large numbers`);
      else {
        notes.push('stress: root font size doubled (simulates 200% text)');
        if (r.fixed) extra.push({ rule: 'fixed-px-text', severity: r.fixed / r.total > 0.3 ? 'warn' : 'info', selector: '', rect: null, text: '', source: 'audit', message: `${r.fixed} of ${r.total} text elements did not grow with the root font size (px units). They ignore the user's text-size setting. Examples: ${r.ex.join(', ')}` });
      }
    }

    const vpShot = await page.screenshot({ path: path.join(dir, 'viewport.png'), animations: 'disabled' });
    const key = (job.label ? job.label + '-' : '') + viewport.width + 'x' + viewport.height;
    if (!job.stress) (shotHash[key] ||= {})[job.theme] = vpShot.toString('base64');
    const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0));
    const capH = Math.min(docH, settings.maxHeight);
    if (docH > settings.maxHeight) notes.push(`page is ${docH}px tall; screenshots cut at ${settings.maxHeight}px`);
    await page.screenshot({ path: path.join(dir, 'full.png'), fullPage: true, animations: 'disabled', clip: { x: 0, y: 0, width: viewport.width, height: capH } });

    let tiles: Tile[] | null = null, tileGrid = '';
    if (settings.tiles) {
      await mkdir(path.join(dir, 'tiles'), { recursive: true });
      const cols = viewport.width >= 1024 ? 3 : viewport.width >= 640 ? 2 : 1;
      const tw = Math.ceil(viewport.width / cols), th = Math.round(viewport.height / 2), ov = 16;
      const rowsN = Math.ceil(capH / th);
      tiles = [];
      for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
        const x = Math.max(0, c * tw - ov), y = Math.max(0, r * th - ov);
        const w = Math.min(viewport.width - x, tw + 2 * ov), h = Math.min(capH - y, th + 2 * ov);
        if (w < 8 || h < 8) continue;
        const file = `tiles/r${String(r + 1).padStart(2, '0')}c${c + 1}.png`;
        await page.screenshot({ path: path.join(dir, file), fullPage: true, animations: 'disabled', clip: { x, y, width: w, height: h } });
        tiles.push({ file, x, y, w, h });
      }
      tileGrid = `${rowsN} rows × ${cols} cols, ${tw}×${th}px each`;
      await writeFile(path.join(dir, 'tiles.json'), JSON.stringify(tiles, null, 2));
    }

    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        try { const t = a.effect?.getComputedTiming(); if (!t || t.endTime === Infinity) a.cancel(); else a.finish(); }
        catch { try { a.cancel(); } catch { /* ignore */ } }
      }
    });
    // Gate rules run before the audit scrolls and tabs, so focus and scroll are as loaded.
    // Stress runs change the text on purpose, so the gate does not judge them.
    const gate = gatePolicy && !job.stress ? await gateFindings(page, gatePolicy) : null;
    if (gate?.error) notes.push(`gate rules could not finish: ${gate.error}`);
    const res = await page.evaluate(pageAudit, { maxPerRule: settings.maxPerRule, mobile, touch: mobile, vpWidth: viewport.width });
    let focus: { findings: AuditFinding[]; stops: number } | null = null;
    if (settings.focus && !job.stress) focus = await focusAudit(page, 60).catch((e: Error) => { notes.push('focus traversal failed: ' + e.message); return null; });
    const gated = gate && !gate.error;
    const leads = gated ? res.findings.filter(f => !coveredByGate[f.rule]) : res.findings;
    const findings = [...(gate?.findings ?? []), ...leads, ...(focus ? focus.findings : []), ...extra];
    if (res.cls > 0.1) findings.push({ rule: 'layout-shift', severity: res.cls > 0.25 ? 'error' : 'warn', selector: '', rect: null, text: '', source: 'audit', message: `Cumulative layout shift ${res.cls.toFixed(3)} during load (good: under 0.1). Shifted: ${[...new Set(res.shifts.flatMap(s => s.sources))].slice(0, 6).join(', ') || 'unknown'}` });
    if (consoleErrors.length) findings.push({ rule: 'console-error', severity: 'warn', selector: '', rect: null, text: '', source: 'audit', message: `${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(' | ')}` });
    if (failed.length) findings.push({ rule: 'failed-request', severity: 'warn', selector: '', rect: null, text: '', source: 'audit', message: `${failed.length} failed request(s): ${failed.slice(0, 4).join(' | ')}` });
    findings.sort((a, b) => (a.source === b.source ? 0 : a.source === 'check' ? -1 : 1) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.rect?.y ?? 1e9) - (b.rect?.y ?? 1e9));
    findings.forEach((f, i) => { f.id = i + 1; });

    const boxed = findings.filter(f => f.rect && f.rect.w > 0).slice(0, 200).map(f => ({ id: f.id!, severity: f.severity, rect: f.rect! }));
    await annotate(page, boxed);
    await page.screenshot({ path: path.join(dir, 'annotated.png'), fullPage: true, animations: 'disabled', clip: { x: 0, y: 0, width: viewport.width, height: capH } });
    runs.push({
      name, theme: job.theme, viewport, stress: job.stress ?? null, state: job.label || null, allKeys: res.allKeys, leftEdges: res.leftEdges, accentHues: res.accentHues,
      vw: res.vw, docH: res.docH, cls: res.cls, findings, perRule: res.perRule, maxPerRule: settings.maxPerRule, inventory: res.inventory, offGrid: res.offGrid,
      ...(focus ? { focusStops: focus.stops } : {}), gate: !!gated, tiles, tileGrid, notes,
    });
    log(`✓ ${name}: ${findings.length} findings`);
  }

  for (const [key, shots] of Object.entries(shotHash)) if (shots.light && shots.dark && shots.light === shots.dark) {
    for (const r of runs) if (r.name.startsWith(key + '-') && !r.stress) r.notes.push('light and dark render identically: the page has no dark mode, or it uses a class or attribute toggle (set "theme" in krafta.config.json)');
  }
  const total = (s: Severity) => runs.reduce((n, r) => n + r.findings.filter(f => f.source === 'audit' && f.severity === s).length, 0);
  const report: AuditReport = {
    target: url, out, runs, failedRuns,
    totals: { error: total('error'), warn: total('warn'), info: total('info') },
    gateFindings: runs.reduce((n, r) => n + r.findings.filter(f => f.source === 'check').length, 0),
  };
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(out, 'report.md'), buildMarkdown(url, runs, failedRuns));
  return report;
}
