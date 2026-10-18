// Adapted from interface-craft hit_area_audit.py (https://github.com/harun-yardimci/interface-craft),
// MIT License, Copyright (c) 2026 Harun Yardimci. See NOTICE.
import type { ScanHit, SourceFile } from './types.js';
import { isComment } from './files.js';

const SW_CLIP = /\.(?:clipped\(|clipShape\()/;
// Only content that is larger than its frame: fill-scaled images, scaled or offset layers,
// and image loaders that fill by default.
const SW_FILL = /contentMode:\s*\.fill|\.scaledToFill\(\)|\.scaleEffect\(|\.offset\(\s*x|AsyncImage\(/;
const SW_CONTENT_SHAPE = /\.contentShape\(|\.allowsHitTesting\(false\)/;
const SW_TAPPABLE = /\bButton\s*[({]|NavigationLink\s*[({]|\.onTapGesture|Menu\s*\{/;
const SW_SMALL_FRAME = /\.frame\(\s*width:\s*(\d+(?:\.\d+)?)\s*,\s*height:\s*(\d+(?:\.\d+)?)\s*\)/;
const SW_ENLARGE = /\.frame\([^)]*min(?:Width|Height):\s*(?:4[4-9]|[5-9]\d|\d{3})/;
const SW_PAD_SHAPE = /\.padding\([^)]*\)[\s\S]*\.contentShape\(/;
// Near-zero but nonzero opacity. SwiftUI does not hit-test exactly 0.
const SW_TAP_CATCHER = /\.opacity\(\s*0?\.0\d*[1-9]\d*\s*\)/;
const SW_CLEAR_SHAPE = /^\s*Color\.clear\b[^\n]*(?:\n[^\n]*){0,2}?\.contentShape\(/;
const SW_TAP_HANDLER = /\.onTapGesture|Button\s*[({]|\.gesture\(/;
const KT_SMALL = /Modifier[^\n]*\.size\(\s*(\d+)\.dp\s*\)[^\n]*\.clickable|\.clickable[^\n]*\.size\(\s*(\d+)\.dp\s*\)/;
const KT_MIN = /minimumInteractiveComponentSize/;
const CSS_OVERLAY = /position\s*:\s*(?:absolute|fixed)/;
const CSS_INSET = /inset\s*:\s*0\b|top\s*:\s*0[^;]*;[^}]*left\s*:\s*0/;
const CSS_PE_NONE = /pointer-events\s*:\s*none/;
const TW_OVERLAY = /\b(?:absolute|fixed)\b[^"']*\binset-0\b|\binset-0\b[^"']*\b(?:absolute|fixed)\b/;
const TW_PE_NONE = /\bpointer-events-none\b/;
const LOOKBACK = 10, LOOKAHEAD = 3;

const join = (lines: string[]) => lines.join('\n');

function scanSwift(file: SourceFile, hits: ScanHit[]) {
  const { lines } = file;
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    const hit = (severity: ScanHit['severity'], rule: string, message: string) => hits.push({ severity, rule, file: file.rel, line: i + 1, snippet: line.trim().slice(0, 140), message });
    if (SW_CLIP.test(line)) {
      // The hit shape can be set just before or after the clip in the same chain.
      if (SW_CONTENT_SHAPE.test(join(lines.slice(Math.max(0, i - 3), i + LOOKAHEAD + 1)))) return;
      const before = join(lines.slice(Math.max(0, i - LOOKBACK), i).filter(l => !isComment(l)));
      if (SW_FILL.test(before) || SW_FILL.test(line))
        hit('high', 'hit-area/clip-overflow', 'Clipped fill or offset content without .contentShape. The overflow still takes taps and can cover nearby controls.');
    }
    const m = SW_SMALL_FRAME.exec(line);
    if (m && Math.min(parseFloat(m[1]), parseFloat(m[2])) < 44) {
      const before = join(lines.slice(Math.max(0, i - 6), i));
      const after = join(lines.slice(i + 1, i + 6));
      // contentShape on the small frame does not enlarge the hit area. Padding then contentShape does.
      const enlarged = SW_ENLARGE.test(after) || SW_PAD_SHAPE.test(after);
      if (SW_TAPPABLE.test(before) && !enlarged)
        hit('warn', 'hit-area/small-target', `Tappable label is ${m[1]}x${m[2]} pt. Pad it to 44x44 or add .contentShape on a larger frame.`);
    }
    if (SW_TAP_CATCHER.test(line) || SW_CLEAR_SHAPE.test(join(lines.slice(i, i + 3)))) {
      const around = join(lines.slice(Math.max(0, i - 3), i + 4));
      if (SW_TAP_HANDLER.test(around) && !around.includes('allowsHitTesting(false)'))
        hit('info', 'hit-area/tap-catcher', 'Near-invisible layer with a tap handler. Make sure it is intentional and does not cover other controls.');
    }
  });
}

function scanKotlin(file: SourceFile, hits: ScanHit[]) {
  file.lines.forEach((line, i) => {
    if (isComment(line)) return;
    const m = KT_SMALL.exec(line);
    if (!m) return;
    const size = parseInt(m[1] ?? m[2], 10);
    if (size < 48 && !KT_MIN.test(join(file.lines.slice(Math.max(0, i - 3), i + 4))))
      hits.push({ severity: 'warn', rule: 'hit-area/small-target', file: file.rel, line: i + 1, snippet: line.trim().slice(0, 140), message: `Clickable is ${size}.dp. Use minimumInteractiveComponentSize() or 48.dp.` });
  });
}

function scanCss(file: SourceFile, hits: ScanHit[]) {
  const text = join(file.lines);
  for (const block of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = block[2];
    if (CSS_OVERLAY.test(body) && CSS_INSET.test(body) && !CSS_PE_NONE.test(body)) {
      const start = (block.index ?? 0) + (block[1].length - block[1].trimStart().length);
      hits.push({ severity: 'info', rule: 'hit-area/overlay-hit', file: file.rel, line: text.slice(0, start).split('\n').length, snippet: block[1].trim().slice(0, 140), message: 'Full-cover positioned layer takes pointer events. Add pointer-events: none if it is decorative.' });
    }
  }
}

function scanMarkup(file: SourceFile, hits: ScanHit[]) {
  file.lines.forEach((line, i) => {
    if (TW_OVERLAY.test(line) && !TW_PE_NONE.test(line) && !/<(?:button|a|input|label)\b/.test(line))
      hits.push({ severity: 'info', rule: 'hit-area/overlay-hit', file: file.rel, line: i + 1, snippet: line.trim().slice(0, 140), message: 'absolute inset-0 layer without pointer-events-none. It can take taps meant for what is underneath.' });
  });
}

// Static scan for tap areas that do not match what the user sees.
// Confirm each hit by tapping each control next to media at the widest and narrowest layouts.
export function scanHitAreas(files: SourceFile[]): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const file of files) {
    if (file.ext === '.swift') scanSwift(file, hits);
    else if (file.ext === '.kt' || file.ext === '.kts') scanKotlin(file, hits);
    else if (['.css', '.scss', '.sass', '.less'].includes(file.ext)) scanCss(file, hits);
    else if (['.tsx', '.jsx', '.html', '.vue', '.svelte', '.astro'].includes(file.ext)) scanMarkup(file, hits);
  }
  return hits;
}
