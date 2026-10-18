import type { ScanHit, ScanReport, ScanSettings, ScanSeverity, SuppressedHit, Scanner } from './types.js';
import { collectFiles, globToRegExp } from './files.js';
import { scanTheme } from './theme.js';
import { scanTokens } from './tokens.js';
import { scanHitAreas } from './hit-area.js';
export type * from './types.js';

export const scanners: readonly Scanner[] = ['theme', 'tokens', 'hit-area'];
export const scanRuleIds = [
  'theme/fixed-bg', 'theme/fixed-stroke', 'theme/scheme-override', 'theme/mix', 'theme/fixed-color', 'theme/tw-no-dark', 'theme/tw-mix',
  'theme/inline-color', 'theme/class-override', 'theme/asset-no-dark', 'theme/android-no-night', 'theme/web-no-color-scheme',
  'tokens/fixed-font', 'tokens/off-grid', 'tokens/one-off', 'tokens/sprawl',
  'hit-area/clip-overflow', 'hit-area/small-target', 'hit-area/tap-catcher', 'hit-area/overlay-hit',
] as const;
export const defaultScanSettings: ScanSettings = { paths: ['.'], scanners: [...scanners], grid: 4, maxPerRule: 40, failOn: 'high', exceptions: [] };
const ORDER: Record<ScanSeverity, number> = { high: 0, warn: 1, info: 2 };
// A reason is required: `// krafta-ignore theme/fixed-bg: brand header keeps white text on purpose`
const INLINE_IGNORE = /krafta-ignore\s+([\w/-]+)\s*:\s*(\S.*?)\s*(?:\*\/|-->)?\s*$/;

export function validateScanSettings(input: unknown = {}): ScanSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('scan settings must be an object.');
  const settings = { ...structuredClone(defaultScanSettings), ...input } as ScanSettings;
  for (const key of Object.keys(input)) if (!(key in defaultScanSettings)) throw new Error(`Unknown scan field: ${key}`);
  if (!Array.isArray(settings.paths) || !settings.paths.length || settings.paths.some(p => typeof p !== 'string' || !p.trim())) throw new Error('scan.paths must be a nonempty list of paths.');
  if (!Array.isArray(settings.scanners) || !settings.scanners.length || settings.scanners.some(s => !scanners.includes(s))) throw new Error(`scan.scanners must contain ${scanners.join(', ')}.`);
  if (typeof settings.grid !== 'number' || !(settings.grid > 0)) throw new Error('scan.grid must be a positive number.');
  if (!Number.isInteger(settings.maxPerRule) || settings.maxPerRule < 1) throw new Error('scan.maxPerRule must be a positive integer.');
  if (!['high', 'warn', 'info', 'never'].includes(settings.failOn)) throw new Error('scan.failOn must be high, warn, info, or never.');
  if (!Array.isArray(settings.exceptions)) throw new Error('scan.exceptions must be a list.');
  for (const e of settings.exceptions) {
    if (!e || typeof e !== 'object' || Object.keys(e).some(k => !['path', 'rules', 'reason'].includes(k)) || typeof e.path !== 'string' || !e.path.trim() || typeof e.reason !== 'string' || !e.reason.trim() || !Array.isArray(e.rules) || !e.rules.length)
      throw new Error('Each scan exception needs a path, rules, and a reason.');
    for (const rule of e.rules) if (!(scanRuleIds as readonly string[]).includes(rule)) throw new Error(`Unknown scan rule: ${rule}`);
  }
  return settings;
}

const fails = (severity: ScanSeverity, failOn: ScanSettings['failOn']) => failOn !== 'never' && ORDER[severity] <= ORDER[failOn];

export async function scanPath(root: string, input: Partial<ScanSettings> = {}): Promise<ScanReport> {
  const settings = validateScanSettings(input);
  const files = await collectFiles(root, settings.paths);
  const all: ScanHit[] = [];
  if (settings.scanners.includes('theme')) all.push(...scanTheme(files));
  const tokens = scanTokens(files, settings.grid);
  if (settings.scanners.includes('tokens')) all.push(...tokens.hits);
  if (settings.scanners.includes('hit-area')) all.push(...scanHitAreas(files));

  const byRel = new Map(files.map(f => [f.rel, f]));
  const exceptions = settings.exceptions.map(e => ({ ...e, pattern: globToRegExp(e.path) }));
  const hits: ScanHit[] = [], suppressed: SuppressedHit[] = [];
  for (const hit of all) {
    const exception = exceptions.find(e => e.rules.includes(hit.rule) && e.pattern.test(hit.file));
    if (exception) { suppressed.push({ ...hit, reason: exception.reason }); continue; }
    // An inline ignore applies on its own line or the line above.
    const lines = byRel.get(hit.file)?.lines ?? [];
    const inline = [lines[hit.line - 1], lines[hit.line - 2]].map(l => l === undefined || hit.line < 1 ? null : INLINE_IGNORE.exec(l)).find(m => m && m[1] === hit.rule);
    if (inline) { suppressed.push({ ...hit, reason: inline[2] }); continue; }
    hits.push(hit);
  }
  hits.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line);
  const counts = { high: 0, warn: 0, info: 0 };
  for (const hit of hits) counts[hit.severity]++;
  return { root, files: files.length, hits, suppressed, tokens: tokens.summary, counts, failed: hits.some(h => fails(h.severity, settings.failOn)) };
}

export function formatScan(report: ScanReport, maxPerRule = defaultScanSettings.maxPerRule): string {
  const lines: string[] = [];
  if (!report.hits.length) lines.push(`No source findings in ${report.files} files. Static scans find leads only: still render both themes and tap-test controls next to media.`);
  const shown = new Map<string, number>();
  for (const hit of report.hits) {
    const n = (shown.get(hit.rule) ?? 0) + 1;
    shown.set(hit.rule, n);
    if (n > maxPerRule) continue;
    lines.push(`[${hit.severity.toUpperCase().padEnd(4)}] ${hit.rule.padEnd(26)} ${hit.line ? `${hit.file}:${hit.line}` : hit.file}`);
    lines.push(`       ${hit.message}`);
    if (hit.snippet) lines.push(`       > ${hit.snippet}`);
  }
  const hidden = [...shown].filter(([, n]) => n > maxPerRule);
  if (hidden.length) lines.push('', `More hits than shown: ${hidden.map(([rule, n]) => `${rule} ${n}`).join(', ')}. Use --json to see all.`);
  if (report.hits.length) {
    lines.push('', `Summary: ${report.counts.high} high, ${report.counts.warn} warn, ${report.counts.info} info in ${report.files} files.`);
    lines.push('Hits are leads, not verdicts. Confirm each one by rendering both themes or tapping on a device.');
  }
  if (report.suppressed.length) lines.push(`${report.suppressed.length} hits excluded by exceptions. See the JSON report for reasons.`);
  return lines.join('\n');
}
