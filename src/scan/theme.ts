// Adapted from interface-craft theme_audit.py (https://github.com/harun-yardimci/interface-craft),
// MIT License, Copyright (c) 2026 Harun Yardimci. See NOTICE.
import type { ScanHit, ScanSeverity, SourceFile } from './types.js';
import path from 'node:path';

type Rule = [rule: string, severity: ScanSeverity, pattern: RegExp, message: string];

const FIXED = String.raw`(?:Color|UIColor|NSColor)\.(?:white|black)\b|Color\(\s*(?:red|white|hex|#colorLiteral)|UIColor\(\s*(?:red|white|hex)|(?<![\w.])\.(?:white|black)\b`;
const SWIFT: Rule[] = [
  ['theme/fixed-bg', 'warn', new RegExp(String.raw`\.(?:background|fill|presentationBackground|listRowBackground|containerBackground|scrollContentBackground)\((?![^)]*opacity)[^)]*(?:${FIXED})`), 'Opaque fixed background. Its foreground must be fixed too, or use an adaptive surface token.'],
  ['theme/fixed-stroke', 'info', /\.(?:stroke|strokeBorder|border|overlay)\((?![^)]*opacity)[^)]*Color\(\s*hex/, 'Fixed border color. Use a separator or outline token with a dark value.'],
  ['theme/scheme-override', 'warn', /\.preferredColorScheme\(\s*\.(?:light|dark)|\.environment\(\s*\\\.colorScheme,\s*\.(?:light|dark)|overrideUserInterfaceStyle/, 'Local color-scheme override. Part of the UI can ignore the system theme.'],
];
// A fixed background is a bug only when the content on it adapts.
const SWIFT_FIXED_BG = new RegExp(String.raw`\.(?:background|fill|presentationBackground|listRowBackground|containerBackground)\((?![^)]*opacity)[^)]*(?:${FIXED})`);
const SWIFT_FG = /\.(?:foregroundStyle|foregroundColor)\(([^)]*)\)/g;
const SWIFT_FIXED_ARG = new RegExp(FIXED);
const WINDOW = 15;

const KOTLIN: Rule[] = [
  ['theme/fixed-color', 'warn', /\bColor\.(?:White|Black)\b|\bColor\(0x[0-9A-Fa-f]{6,8}\)/, 'Hardcoded color. Use MaterialTheme.colorScheme roles.'],
  ['theme/scheme-override', 'warn', /darkTheme\s*=\s*(?:true|false)\b|setDefaultNightMode\(/, 'Forced theme. Make sure it is deliberate and applies to the whole app.'],
];
const KOTLIN_FIXED_BG = /(?:background|containerColor|color)\s*[=(]\s*Color\.(?:White|Black)|Color\(0x/;
const KOTLIN_ADAPTIVE_FG = /MaterialTheme\.colorScheme\.on|LocalContentColor|contentColorFor/;

const XML: Rule[] = [
  ['theme/fixed-color', 'warn', /android:(?:background|textColor|tint|src)\s*=\s*"#[0-9A-Fa-f]{3,8}"/, 'Hex color in a layout. Use a theme attribute or a color resource with a night variant.'],
];
const CSS: Rule[] = [
  ['theme/fixed-color', 'info', /^\s*(?!--)[a-z-]*(?:color|background|border|fill|stroke|shadow)[a-z-]*\s*:\s*[^;]*(?:#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|\bwhite\b|\bblack\b)/, 'Literal color outside a custom property. Prefer a theme token.'],
];
const MARKUP: Rule[] = [
  ['theme/inline-color', 'info', /style=\{?\{?[^}]*(?:color|background)[^}]*(?:#[0-9A-Fa-f]{3,8}|rgba?\()/, 'Inline literal color. Prefer a theme token.'],
  ['theme/class-override', 'info', /className="[^"]*\b(?:light|dark)\b(?!:)/, 'Hardcoded theme class on a subtree.'],
];

const TW_ADAPTIVE_TEXT = /^\btext-(?!(?:white|black|transparent|current|inherit|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|xs|sm|base|lg|xl|[2-9]xl)\b|(?:gray|zinc|slate|neutral|stone|red|blue|green|amber|orange|yellow|indigo|violet|purple|pink|rose|sky|cyan|teal|emerald|lime|fuchsia)-\d|\[)[a-z][a-z-]*/;
const TW_FIXED = /^(bg|text|border|ring|divide|fill|stroke|outline)-(?:white|black|(?:gray|zinc|slate|neutral|stone)-\d{2,3})(?:\/\d+)?$/;
const TW_CLASS_ATTR = /\bclass(?:Name)?\s*=\s*[{(]?\s*[`"']([^`"']*)/g;

const scanLines = (file: SourceFile, rules: Rule[], hits: ScanHit[], skip?: (line: string) => boolean) => {
  file.lines.forEach((line, i) => {
    if (skip?.(line)) return;
    for (const [rule, severity, pattern, message] of rules)
      if (pattern.test(line)) hits.push({ severity, rule, file: file.rel, line: i + 1, snippet: line.trim().slice(0, 140), message });
  });
};

// Judge each class attribute on its own, and each fixed color class against a dark: variant
// for the same utility, instead of skipping any line with dark:.
function scanTailwind(file: SourceFile, hits: ScanHit[]) {
  file.lines.forEach((line, i) => {
    for (const attr of line.matchAll(TW_CLASS_ATTR)) {
      const tokens = attr[1].split(/\s+/).filter(Boolean);
      const base = tokens.filter(c => !c.includes(':'));
      const darkUtils = new Set(tokens.filter(c => c.startsWith('dark:')).map(c => c.split(':').at(-1)!.split('-')[0]));
      const fixed = base.map(c => [c, TW_FIXED.exec(c)?.[1]] as const).filter((x): x is readonly [string, string] => !!x[1]);
      const snippet = attr[0].trim().slice(0, 140);
      for (const [cls, util] of fixed)
        if (!darkUtils.has(util)) hits.push({ severity: 'warn', rule: 'theme/tw-no-dark', file: file.rel, line: i + 1, snippet, message: `\`${cls}\` has no \`dark:${util}-*\` variant on this element.` });
      const bgFixed = fixed.some(([, u]) => u === 'bg') && !darkUtils.has('bg');
      const adaptiveText = base.some(c => TW_ADAPTIVE_TEXT.test(c) && !TW_FIXED.test(c));
      if (bgFixed && adaptiveText)
        hits.push({ severity: 'high', rule: 'theme/tw-mix', file: file.rel, line: i + 1, snippet, message: 'Fixed Tailwind background with a theme text token. Unless contrast is verified in both themes, the text likely vanishes in one.' });
    }
  });
}

function scanSwiftMix(file: SourceFile, hits: ScanHit[]) {
  const { lines } = file;
  let covered = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i <= covered || line.trim().startsWith('//')) continue;
    let stmt = line, joined = false;
    if ((line.match(/\(/g)?.length ?? 0) > (line.match(/\)/g)?.length ?? 0)) {
      // Modifier arguments split across lines: `.background(\n cond ? token : Color.white, ...`
      stmt = lines.slice(i, i + 4).map(l => l.trim()).join(' ');
      joined = true;
    }
    if (!SWIFT_FIXED_BG.test(stmt)) continue;
    if (joined) covered = i + 3;
    // If the statement sets its own foreground, judge by that. Otherwise look nearby.
    const window = [...stmt.matchAll(SWIFT_FG)].length ? [stmt] : lines.slice(Math.max(0, i - WINDOW), i + WINDOW + 1);
    const adaptive: string[] = [];
    for (const w of window) for (const match of w.matchAll(SWIFT_FG)) {
      const arg = match[1];
      // Conditional styles ("a ? .white : token") count if any branch adapts.
      const branches = arg.includes('?') ? arg.split(/[?:]/).slice(-2) : [arg];
      if (branches.some(b => b.trim() && !SWIFT_FIXED_ARG.test(b))) adaptive.push(arg.trim());
    }
    if (adaptive.length)
      hits.push({ severity: 'high', rule: 'theme/mix', file: file.rel, line: i + 1, snippet: stmt.trim().slice(0, 140), message: `Fixed background next to an adaptive foreground (${adaptive[0].slice(0, 50)}). Unless contrast is verified in both themes, the text likely vanishes in one.` });
  }
}

// Static scan for light and dark theme inconsistencies. Hits are leads, not verdicts:
// intentional brand surfaces are fine when their foreground is fixed too.
export function scanTheme(files: SourceFile[]): ScanHit[] {
  const hits: ScanHit[] = [];
  let colorSchemeDecl = false, webFiles = 0, nightValues = false;
  const dayColors: string[] = [];
  for (const file of files) {
    const { ext } = file;
    if (ext === '.swift') {
      scanLines(file, SWIFT, hits, l => l.trim().startsWith('//'));
      scanSwiftMix(file, hits);
    } else if (ext === '.kt' || ext === '.kts') {
      scanLines(file, KOTLIN, hits, l => l.trim().startsWith('//'));
      const text = file.lines.join('\n');
      if (KOTLIN_FIXED_BG.test(text) && KOTLIN_ADAPTIVE_FG.test(text))
        hits.push({ severity: 'high', rule: 'theme/mix', file: file.rel, line: 0, snippet: '', message: "Fixed background and theme 'on' colors in the same file: likely a fixed and adaptive mix." });
    } else if (ext === '.xml') {
      const parent = path.basename(file.dir);
      if (file.dir.split(path.sep).some(part => part.startsWith('layout'))) scanLines(file, XML, hits);
      if (parent.startsWith('values-night')) nightValues = true;
      if (parent === 'values' && file.name === 'colors.xml') dayColors.push(file.rel);
    } else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
      webFiles++;
      scanLines(file, CSS, hits, l => /^\s*(\/\*|\*|\/\/)/.test(l));
      if (file.lines.some(l => l.includes('color-scheme'))) colorSchemeDecl = true;
    } else if (['.tsx', '.jsx', '.html', '.vue', '.svelte', '.astro'].includes(ext)) {
      webFiles++;
      scanLines(file, MARKUP, hits);
      scanTailwind(file, hits);
      if (file.lines.some(l => l.includes('color-scheme'))) colorSchemeDecl = true;
    } else if (file.name === 'Contents.json' && file.dir.endsWith('.colorset')) {
      try {
        const data = JSON.parse(file.lines.join('\n')) as { colors?: { appearances?: { value?: string }[] }[] };
        const hasDark = (data.colors ?? []).some(c => (c.appearances ?? []).some(a => a.value === 'dark'));
        if (!hasDark) hits.push({ severity: 'high', rule: 'theme/asset-no-dark', file: path.dirname(file.rel), line: 0, snippet: '', message: 'Color set has no Dark appearance.' });
      } catch { /* not a color set manifest */ }
    }
  }
  if (dayColors.length && !nightValues)
    hits.push({ severity: 'warn', rule: 'theme/android-no-night', file: dayColors[0], line: 0, snippet: '', message: 'colors.xml found but no values-night/ resources.' });
  if (webFiles && !colorSchemeDecl)
    hits.push({ severity: 'warn', rule: 'theme/web-no-color-scheme', file: '.', line: 0, snippet: '', message: 'No `color-scheme` declaration found. Native inputs and scrollbars can stay light in dark mode.' });
  const mixed = new Set(hits.filter(h => h.rule === 'theme/mix' || h.rule === 'theme/tw-mix').map(h => `${h.file}:${h.line}`));
  return hits.filter(h => !((h.rule === 'theme/fixed-bg' || h.rule === 'theme/tw-no-dark') && mixed.has(`${h.file}:${h.line}`)));
}
