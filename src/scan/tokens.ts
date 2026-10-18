// Adapted from interface-craft token_audit.py (https://github.com/harun-yardimci/interface-craft),
// MIT License, Copyright (c) 2026 Harun Yardimci. See NOTICE.
import type { ScanHit, SourceFile, TokenSummary } from './types.js';

type Category = 'font' | 'spacing' | 'radius';
type Kind = 'swift' | 'kt' | 'css' | 'tw';
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const g = (source: string) => new RegExp(source, 'g');

const RULES: Record<Kind, Record<Category, RegExp[]>> = {
  swift: {
    font: [g(String.raw`\.system\(\s*size:\s*${NUM}`), g(String.raw`Font\.custom\([^)]*size:\s*${NUM}(?![^)]*relativeTo)`)],
    spacing: [g(String.raw`\.padding\((?:\s*\.[a-zA-Z]+\s*,)?\s*${NUM}\s*\)`), g(String.raw`\bspacing:\s*${NUM}`)],
    radius: [g(String.raw`cornerRadius:\s*${NUM}`), g(String.raw`\.cornerRadius\(\s*${NUM}`)],
  },
  kt: {
    font: [g(String.raw`fontSize\s*=\s*${NUM}\.sp`)],
    spacing: [g(String.raw`(?:padding|spacedBy|Spacer\(Modifier\.(?:height|width))\([^)]*?${NUM}\.dp`)],
    radius: [g(String.raw`RoundedCornerShape\(\s*${NUM}\.dp`)],
  },
  css: {
    font: [g(String.raw`^\s*font-size\s*:\s*${NUM}px`)],
    spacing: [g(String.raw`^\s*(?:padding|margin|gap|row-gap|column-gap)[a-z-]*\s*:\s*([^;]+)`)],
    radius: [g(String.raw`^\s*border(?:-[a-z]+)*-radius\s*:\s*${NUM}px`)],
  },
  tw: {
    font: [g(String.raw`\btext-\[${NUM}px\]`)],
    spacing: [g(String.raw`\b-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-\[${NUM}px\]`)],
    radius: [g(String.raw`\brounded(?:-[a-z]+)?-\[${NUM}px\]`)],
  },
};
const FILE_KIND: Record<string, Kind> = {
  '.swift': 'swift', '.kt': 'kt', '.kts': 'kt', '.css': 'css', '.scss': 'css', '.less': 'css',
  '.tsx': 'tw', '.jsx': 'tw', '.html': 'tw', '.vue': 'tw', '.svelte': 'tw', '.astro': 'tw',
};
const LIMITS: Record<Category, number> = { font: 8, spacing: 10, radius: 5 };
const fmt = (v: number) => String(Number.isInteger(v) ? v : v);

// Static scan for design-token drift: literal sizes, off-grid spacing, one-off values,
// and fonts that ignore the user's text size. A few literals in a token file are expected.
export function scanTokens(files: SourceFile[], grid = 4): { hits: ScanHit[]; summary: TokenSummary } {
  const values: Record<Category, Map<number, number>> = { font: new Map(), spacing: new Map(), radius: new Map() };
  const where: Record<Category, { file: string; line: number; v: number; snippet: string }[]> = { font: [], spacing: [], radius: [] };
  const hits: ScanHit[] = [];
  for (const file of files) {
    const kind = FILE_KIND[file.ext];
    if (!kind) continue;
    file.lines.forEach((line, i) => {
      const s = line.trim();
      // Skip comments and CSS custom-property (token) definitions.
      if (/^(\/\/|\/\*|\*|--)/.test(s) || /^\s*--[\w-]+\s*:/.test(line)) return;
      // CSS declarations often share a line: `.card { padding: 12px; border-radius: 8px; }`
      const pieces = kind === 'css' ? line.split(/[;{}]/) : [line];
      for (const cat of ['font', 'spacing', 'radius'] as const) for (const rx of RULES[kind][cat]) for (const piece of pieces) for (const m of piece.matchAll(rx)) {
        const raw = m[1];
        const nums = kind === 'css' && cat === 'spacing' ? [...raw.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map(x => parseFloat(x[1])) : [parseFloat(raw)];
        for (const n of nums) {
          const v = Math.abs(n);
          values[cat].set(v, (values[cat].get(v) ?? 0) + 1);
          where[cat].push({ file: file.rel, line: i + 1, v, snippet: s.slice(0, 120) });
          if (cat === 'spacing' && v >= grid && v % grid)
            hits.push({ severity: 'warn', rule: 'tokens/off-grid', file: file.rel, line: i + 1, snippet: s.slice(0, 120), message: `Spacing ${fmt(v)} is not on the ${fmt(grid)}pt grid. Map it to a spacing token.` });
          if (cat === 'font' && kind === 'swift' && line.replace(/\s/g, '').includes('.system(size:'))
            hits.push({ severity: 'warn', rule: 'tokens/fixed-font', file: file.rel, line: i + 1, snippet: s.slice(0, 120), message: '`.system(size:)` does not scale with Dynamic Type. Use a text style (.body, .headline) or a scaled custom font.' });
        }
      }
    });
  }
  for (const cat of ['font', 'radius'] as const) for (const [v, n] of values[cat]) if (n === 1) {
    const loc = where[cat].find(w => w.v === v)!;
    hits.push({ severity: 'info', rule: 'tokens/one-off', file: loc.file, line: loc.line, snippet: loc.snippet, message: `${cat === 'font' ? 'Font size' : 'Radius'} ${fmt(v)} is used once. It is likely drift from the scale.` });
  }
  for (const cat of ['font', 'spacing', 'radius'] as const) if (values[cat].size > LIMITS[cat]) {
    const list = [...values[cat].entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${fmt(v)}×${n}`).join(', ');
    hits.push({ severity: 'info', rule: 'tokens/sprawl', file: '.', line: 0, snippet: list.slice(0, 140), message: `${values[cat].size} distinct literal ${cat === 'font' ? 'font sizes' : cat === 'spacing' ? 'spacing values' : 'radii'}. There is no clear scale, or the code bypasses it.` });
  }
  const record = (m: Map<number, number>) => Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => [fmt(v), n]));
  return { hits, summary: { grid, font: record(values.font), spacing: record(values.spacing), radius: record(values.radius) } };
}
