import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPath, validateScanSettings, formatScan } from '../src/scan/index.js';
import { globToRegExp } from '../src/scan/files.js';

const fixtures = fileURLToPath(new URL('../../test/fixtures/scan/', import.meta.url));
const key = (h: { rule: string; file: string; line: number }) => `${h.rule} ${h.file}:${h.line}`;

// The same hits the original interface-craft Python scanners report on these fixtures,
// except overlay-hit in app.css, which now points at the rule's own line.
const expected = [
  'hit-area/clip-overflow ios/FilterSheet.swift:25',
  'hit-area/overlay-hit web/Panel.tsx:6',
  'hit-area/overlay-hit web/app.css:4',
  'hit-area/small-target android/Screen.kt:5',
  'hit-area/small-target ios/FilterSheet.swift:29',
  'hit-area/tap-catcher ios/FilterSheet.swift:31',
  'theme/android-no-night android/res/values/colors.xml:0',
  'theme/asset-no-dark ios/Assets.xcassets/Brand.colorset:0',
  'theme/fixed-bg ios/FilterSheet.swift:35',
  'theme/fixed-color android/Screen.kt:3',
  'theme/fixed-color android/res/layout/item.xml:1',
  'theme/inline-color web/Panel.tsx:7',
  'theme/mix android/Screen.kt:0',
  'theme/mix ios/FilterSheet.swift:14',
  'theme/scheme-override ios/FilterSheet.swift:16',
  'theme/tw-mix web/Panel.tsx:3',
  'theme/tw-no-dark web/Panel.tsx:5',
  'theme/web-no-color-scheme .:0',
  'tokens/fixed-font ios/FilterSheet.swift:10',
  'tokens/fixed-font ios/FilterSheet.swift:7',
  'tokens/off-grid android/Screen.kt:7',
  'tokens/off-grid ios/FilterSheet.swift:11',
  'tokens/off-grid ios/FilterSheet.swift:5',
  'tokens/off-grid web/Panel.tsx:3',
  'tokens/off-grid web/app.css:3',
  'tokens/off-grid web/app.css:5',
  'tokens/one-off ios/FilterSheet.swift:15',
  'tokens/one-off ios/FilterSheet.swift:7',
  'tokens/one-off web/app.css:2',
  'tokens/one-off web/app.css:5',
];

test('scan finds theme mixes, token drift and hit areas across SwiftUI, Compose, XML, CSS and Tailwind', async () => {
  const report = await scanPath(fixtures);
  assert.equal(report.files, 8);
  const found = report.hits.map(key);
  assert.deepEqual([...new Set(found)].sort(), [...new Set(expected)].sort());
  // Two off-grid values on one CSS line are two hits.
  assert.equal(found.filter(h => h === 'tokens/off-grid web/app.css:3').length, 2);
  assert.deepEqual(report.tokens.font, { 15: 4, 17: 1 });
  assert.deepEqual(report.tokens.radius, { 8: 1, 9: 1, 10: 2, 14: 1 });
  assert.equal(report.counts.high, report.hits.filter(h => h.severity === 'high').length);
  // Severity order: high first.
  assert.equal(report.hits[0].severity, 'high');
  assert.equal(report.failed, true);
});

test('scan honors inline ignores with a reason and config exceptions with a glob', async () => {
  const report = await scanPath(fixtures, {
    exceptions: [{ path: 'android/**', rules: ['theme/mix', 'theme/fixed-color'], reason: 'Legacy screen, tracked in the redesign.' }],
  });
  assert.ok(report.suppressed.some(h => key(h) === 'theme/fixed-bg ios/FilterSheet.swift:43' && h.reason === 'brand banner keeps white text on purpose'));
  assert.ok(report.suppressed.some(h => key(h) === 'theme/mix android/Screen.kt:0' && h.reason.startsWith('Legacy screen')));
  assert.ok(!report.hits.some(h => h.file.startsWith('android/') && (h.rule === 'theme/mix' || h.rule === 'theme/fixed-color')));
  assert.ok(report.hits.some(h => key(h) === 'hit-area/small-target android/Screen.kt:5'), 'other rules still apply');
});

test('scan ignores an inline ignore without a reason', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-scan-'));
  try {
    await writeFile(join(dir, 'a.tsx'), [
      '// krafta-ignore theme/tw-mix',
      'const a = <div className="bg-white text-foreground">A</div>;',
      '// krafta-ignore theme/tw-mix: marketing hero is always light',
      'const b = <div className="bg-white text-foreground">B</div>;',
      ':root { color-scheme: light dark; }',
    ].join('\n'));
    const report = await scanPath(dir, { scanners: ['theme'] });
    assert.deepEqual(report.hits.filter(h => h.rule === 'theme/tw-mix').map(h => h.line), [2]);
    assert.deepEqual(report.suppressed.map(h => [h.line, h.reason]), [[4, 'marketing hero is always light']]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scan fails only at or above the failOn severity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-scan-'));
  try {
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'a.css'), ':root { color-scheme: light dark; }\n.a { padding: 13px; }\n');
    assert.equal((await scanPath(dir)).failed, false, 'off-grid is a warning');
    assert.equal((await scanPath(dir, { failOn: 'warn' })).failed, true);
    assert.equal((await scanPath(dir, { failOn: 'never', paths: ['src'] })).failed, false);
    const clean = await scanPath(dir, { scanners: ['hit-area'] });
    assert.deepEqual(clean.hits, []);
    assert.match(formatScan(clean), /No source findings in 1 files/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scan settings and globs are validated', () => {
  assert.throws(() => validateScanSettings({ scanners: ['lint'] }), /scan\.scanners/);
  assert.throws(() => validateScanSettings({ failOn: 'error' }), /failOn/);
  assert.throws(() => validateScanSettings({ exceptions: [{ path: 'a', rules: ['theme/mix'] }] }), /reason/);
  assert.throws(() => validateScanSettings({ exceptions: [{ path: 'a', rules: ['theme/typo'], reason: 'x' }] }), /Unknown scan rule/);
  assert.throws(() => validateScanSettings({ path: ['.'] }), /Unknown scan field/);
  assert.ok(globToRegExp('src/**').test('src/a/b.swift'));
  assert.ok(globToRegExp('**/*.swift').test('a.swift'));
  assert.ok(globToRegExp('**/*.swift').test('ios/a/b.swift'));
  assert.ok(!globToRegExp('src/*.css').test('src/a/b.css'));
  assert.ok(globToRegExp('web/Panel.tsx').test('web/Panel.tsx'));
  assert.ok(!globToRegExp('web/Panel.tsx').test('web/PanelXtsx'));
});
