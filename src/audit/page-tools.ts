// Adapted from interface-craft render_audit.mjs (https://github.com/harun-yardimci/interface-craft),
// MIT License, Copyright (c) 2026 Harun Yardimci. See NOTICE.
import type { Page } from 'playwright';
import type { AuditFinding, Rect, Severity, StressKind } from './types.js';

export type StressResult = { kind: 'pseudo'; changed: number } | { kind: 'large-text'; total: number; fixed: number; ex: string[] };

// Runs in the browser. Real text is longer than sample text: translations (+30-40%),
// Turkish suffixes, long compound words and big amounts. Large text doubles the root size.
export function applyStress(kind: StressKind): StressResult {
  const simple = (e: Element) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
  if (kind === 'pseudo') {
    const words = ['Öğrenciliğimizdeki', 'çalışmalarımızın', 'güncelleştirilmesi', 'İşletmelerimiz', 'şğüçöı'];
    const tw = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.textContent?.trim().length ?? 0) >= 2 && n.parentElement && !n.parentElement.closest('script,style,code,pre,noscript,textarea,svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const nodes: Node[] = [];
    let n: Node | null;
    while ((n = tw.nextNode())) nodes.push(n);
    nodes.forEach((t, i) => {
      let v = t.textContent ?? '';
      const trail = v.match(/\s*$/)?.[0] ?? '', core = v.slice(0, v.length - trail.length);
      if (/\d/.test(core) && core.trim().length <= 14) v = core.replace(/\d[\d.,]*/, '1.234.567,89') + trail;
      else {
        const extra = Math.max(3, Math.round(core.trim().length * 0.4));
        let pad = '', w = i;
        while (pad.length < extra) pad += ' ' + words[w++ % words.length];
        v = core + pad + (i % 7 === 3 && core.length > 12 ? ' Hesapdoğrulamaişlemlerinizdeki' : '') + trail;
      }
      t.textContent = v;
    });
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder],textarea[placeholder]')) el.placeholder += ' ' + words[0];
    return { kind, changed: nodes.length };
  }
  const els = [...(document.body || document.documentElement).querySelectorAll('*')].filter(e => [...e.childNodes].some(c => c.nodeType === 3 && c.textContent?.trim()) && e.getBoundingClientRect().width > 0);
  const before = els.map(e => parseFloat(getComputedStyle(e).fontSize));
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  document.documentElement.style.fontSize = (root * 2) + 'px';
  const fixed = els.filter((e, i) => parseFloat(getComputedStyle(e).fontSize) <= before[i] + 0.5);
  return { kind, total: els.length, fixed: fixed.length, ex: [...new Set(fixed.map(simple))].slice(0, 5) };
}

interface FocusWindow {
  __kraftaBase?: Map<Element, string>;
  __kraftaKey?: (el: Element) => string;
  __kraftaSeen?: WeakSet<Element>;
  __kraftaSel?: (el: Element) => string;
}
interface FocusStop { end?: false; sel: string; indicator: boolean; hidden: boolean; text: string; rect: Rect }

// Node drives the Tab key. The page records each stop.
export async function focusAudit(page: Page, maxTabs: number): Promise<{ findings: AuditFinding[]; stops: number }> {
  await page.evaluate(() => {
    const w = window as unknown as FocusWindow;
    // Focus styles often live on ::before, ::after or the parent (:focus-within).
    const k = (x: CSSStyleDeclaration) => [x.outlineStyle, x.outlineWidth, x.outlineColor, x.boxShadow, x.borderColor, x.backgroundColor, x.opacity].join('|');
    const key = (el: Element) => { const s = getComputedStyle(el), p = el.parentElement; return [k(s), s.color, s.textDecorationLine, k(getComputedStyle(el, '::before')), k(getComputedStyle(el, '::after')), p ? k(getComputedStyle(p)) : ''].join('#'); };
    w.__kraftaBase = new Map();
    for (const el of document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]')) w.__kraftaBase.set(el, key(el));
    w.__kraftaKey = key;
    w.__kraftaSeen = new WeakSet();
    if (document.activeElement && document.activeElement !== document.body) (document.activeElement as HTMLElement).blur?.();
    window.scrollTo(0, 0);
  });
  const findings: AuditFinding[] = [];
  const push = (rule: string, severity: Severity, f: FocusStop, message: string) => findings.push({ rule, severity, selector: f.sel, rect: f.rect, text: f.text, message, source: 'audit' });
  let prev: FocusStop | null = null, stops = 0;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(70);
    const f = await page.evaluate((): FocusStop | { end: true } => {
      const w = window as unknown as FocusWindow;
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return { end: true };
      if (w.__kraftaSeen!.has(el)) return { end: true }; // focus cycled back
      w.__kraftaSeen!.add(el);
      const s = getComputedStyle(el);
      const outlineOn = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(s.outlineColor);
      const changed = w.__kraftaBase!.has(el) && w.__kraftaBase!.get(el) !== w.__kraftaKey!(el);
      const r = el.getBoundingClientRect();
      const hidden = r.width < 2 || r.height < 2 || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const input = el as HTMLInputElement;
      const text = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || (typeof input.value === 'string' ? input.value : '') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return { sel: w.__kraftaSel ? w.__kraftaSel(el) : el.tagName.toLowerCase(), indicator: outlineOn || changed, hidden, text, rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) } };
    });
    if (f.end) break;
    stops++;
    if (f.hidden) push('focus-on-hidden', 'error', f, `Tab stop ${stops} lands on an invisible element. Keyboard users lose track of focus.`);
    else if (!f.indicator) push('no-focus-indicator', 'warn', f, `Tab stop ${stops} shows no focus style change. Check the tile: the ring can be on a wrapper.`);
    if (prev && !f.hidden && !prev.hidden && f.rect.y + f.rect.h < prev.rect.y - 40) push('focus-order-jump', 'info', f, `Focus jumps back up the page after "${prev.text}". Does the Tab order match the reading order?`);
    prev = f;
  }
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur?.(); window.scrollTo(0, 0); });
  return { findings, stops };
}

// Draw numbered boxes that match the finding IDs in report.md.
export async function annotate(page: Page, items: { id: number; severity: Severity; rect: Rect }[]): Promise<void> {
  await page.evaluate(items => {
    const root = document.createElement('div');
    root.id = '__krafta_annot';
    root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    const col = { error: '#e11d48', warn: '#d97706', info: '#2563eb' };
    // Lower IDs (gate findings, then errors) are drawn last so their labels stay on top.
    for (const it of [...items].reverse()) {
      const b = document.createElement('div');
      const c = col[it.severity];
      b.style.cssText = `position:absolute;left:${it.rect.x - 2}px;top:${it.rect.y - 2}px;width:${it.rect.w + 4}px;height:${it.rect.h + 4}px;outline:2px solid ${c};outline-offset:0;box-sizing:border-box;`;
      const l = document.createElement('div');
      l.textContent = String(it.id);
      l.style.cssText = `position:absolute;left:-2px;top:-16px;font:700 11px/14px system-ui,sans-serif;color:#fff;background:${c};padding:0 4px;border-radius:3px;white-space:nowrap;`;
      b.appendChild(l); root.appendChild(b);
    }
    document.documentElement.appendChild(root);
  }, items);
}

// Measure where gate findings are, so the annotated screenshot can number them too.
export async function locate(page: Page, selectors: string[]): Promise<(Rect | null)[]> {
  return page.evaluate(selectors => selectors.map(selector => {
    try {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return null;
      return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
    } catch { return null; }
  }), selectors);
}

// Short, readable selectors for gate findings, in the same style as audit findings.
export async function shortSelectors(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate(selectors => {
    const html = document.documentElement;
    const okId = (s: string) => /^[A-Za-z][\w-]*$/.test(s) && document.querySelectorAll('#' + s).length === 1;
    const short = (el: Element) => {
      if (el === html) return 'html';
      if (el.id && okId(el.id)) return '#' + el.id;
      const parts: string[] = [];
      let e: Element | null = el;
      for (let i = 0; e && e !== html && i < 12; i++) {
        if (e.id && okId(e.id)) { parts.unshift('#' + e.id); break; }
        let p = e.tagName.toLowerCase();
        const cls = [...e.classList].filter(c => /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
        if (cls.length) p += '.' + cls.join('.');
        const par: Element | null = e.parentElement;
        if (par) {
          const tag = e.tagName;
          const same = [...par.children].filter(c => c.tagName === tag);
          if (same.length > 1) p += `:nth-of-type(${same.indexOf(e) + 1})`;
        }
        parts.unshift(p);
        e = par;
        if (i >= 3) { try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch { /* keep walking */ } }
      }
      return parts.join(' > ');
    };
    return selectors.map(selector => {
      try { const el = document.querySelector(selector); return el ? short(el) : selector; } catch { return selector; }
    });
  }, selectors);
}

export async function snippets(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate(selectors => selectors.map(selector => {
    try {
      const el = document.querySelector(selector);
      const t = ((el as HTMLElement | null)?.innerText || el?.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      return t.length > 60 ? t.slice(0, 57) + '…' : t;
    } catch { return ''; }
  }), selectors);
}
