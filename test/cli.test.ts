import type { CliResult } from './types.js';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/krafta.js', import.meta.url));
const fixtures = fileURLToPath(new URL('../../test/fixtures/scan/', import.meta.url));

function krafta(args: string[], cwd = process.cwd()) {
  return new Promise<CliResult>((resolve, reject: (reason?: unknown) => void) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: Buffer) => stdout += chunk);
    child.stderr.on('data', (chunk: Buffer) => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

const good = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html { background: #fafafa; color: #202020; font: 16px/1.5 system-ui; } body { margin: 24px; } h1 { font-size: 24px; }
</style></head><body><h1>Projects</h1><p>Two projects are active.</p></body></html>`;

test('CLI prints help and version, and rejects unknown commands and options', async () => {
  const help = await krafta(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /krafta check \[url\]/);
  assert.match(help.stdout, /krafta audit/);
  assert.match(help.stdout, /krafta scan/);
  const none = await krafta([]);
  assert.equal(none.code, 2);
  const version = await krafta(['--version']);
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string };
  assert.equal(version.stdout.trim(), pkg.version);
  const unknown = await krafta(['lint']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown command: lint/);
  const option = await krafta(['scan', '--stress']);
  assert.equal(option.code, 2);
  assert.match(option.stderr, /Unknown option for krafta scan: --stress/);
  const value = await krafta(['audit', '--out']);
  assert.equal(value.code, 2);
  assert.match(value.stderr, /Missing value for --out/);
});

test('CLI check reads the url from krafta.config.json and audit accepts a file path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-cli-'));
  const server = createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(good); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const missing = await krafta(['check'], dir);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /set "url" in krafta\.config\.json/);
    await writeFile(join(dir, 'krafta.config.json'), JSON.stringify({ url, check: { viewports: [{ width: 390, height: 844 }] }, audit: { viewports: [{ width: 390, height: 844 }], themes: ['light'], wait: 0, tiles: false } }));
    const check = await krafta(['check'], dir);
    assert.equal(check.code, 0, check.stderr);
    assert.match(check.stdout, /Passed: 0 UI findings across 1 page checks/);
    await writeFile(join(dir, 'page.html'), good.replace('font-size: 24px', 'font-size: 27px'));
    const failed = await krafta(['check', 'page.html', '--json'], dir);
    assert.equal(failed.code, 1);
    assert.deepEqual([...new Set((JSON.parse(failed.stdout) as { findings: { rule: string }[] }).findings.map(f => f.rule))], ['font-size']);
    const audit = await krafta(['audit', 'page.html', '--out', 'review'], dir);
    assert.equal(audit.code, 0, audit.stderr);
    assert.match(audit.stdout, /Report: review\/report\.md/);
    assert.match(audit.stdout, /Gate findings: 1\./);
    await access(join(dir, 'review', '390x844-light', 'annotated.png'));
    const json = await krafta(['audit', 'page.html', '--out', 'review2', '--no-gate', '--json'], dir);
    const report = JSON.parse(json.stdout) as { gateFindings: number; runs: { gate: boolean }[] };
    assert.equal(report.gateFindings, 0);
    assert.equal(report.runs[0].gate, false);
    const bad = await krafta(['audit', 'page.html', '--viewports', '390'], dir);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /Bad viewport "390"/);
  } finally {
    await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI scan exits by severity and prints JSON on request', async () => {
  const scan = await krafta(['scan', fixtures]);
  assert.equal(scan.code, 1);
  assert.match(scan.stdout, /\[HIGH\] theme\/mix/);
  assert.match(scan.stdout, /Summary: \d+ high/);
  const never = await krafta(['scan', fixtures, '--fail-on', 'never', '--scanners', 'tokens', '--json']);
  assert.equal(never.code, 0);
  const report = JSON.parse(never.stdout) as { hits: { rule: string }[] };
  assert.ok(report.hits.length && report.hits.every(h => h.rule.startsWith('tokens/')));
  const grid = await krafta(['scan', fixtures, '--fail-on', 'never', '--scanners', 'tokens', '--grid', '2', '--json']);
  assert.ok((JSON.parse(grid.stdout) as { hits: { rule: string }[] }).hits.filter(h => h.rule === 'tokens/off-grid').length < report.hits.filter(h => h.rule === 'tokens/off-grid').length);
  const invalid = await krafta(['scan', fixtures, '--scanners', 'lint']);
  assert.equal(invalid.code, 2);
});

test('CLI init writes the config and scripts once, and copies the skill on request', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-init-'));
  try {
    const noPackage = await krafta(['init'], dir);
    assert.equal(noPackage.code, 2);
    assert.match(noPackage.stderr, /No package\.json in this directory/);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { 'lint:ui': 'custom' } }));
    const init = await krafta(['init', '--skill'], dir);
    assert.equal(init.code, 0, init.stderr);
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    assert.deepEqual(pkg.scripts, { 'lint:ui': 'custom', 'audit:ui': 'krafta audit', 'scan:ui': 'krafta scan' });
    const config = JSON.parse(await readFile(join(dir, 'krafta.config.json'), 'utf8')) as { url: string; check: { fonts: string[] } };
    assert.equal(config.url, 'http://localhost:3000');
    assert.ok(config.check.fonts.length);
    await access(join(dir, '.claude', 'skills', 'krafta', 'SKILL.md'));
    await access(join(dir, '.claude', 'skills', 'krafta', 'references', 'gate.md'));
    await writeFile(join(dir, 'krafta.config.json'), JSON.stringify({ url: 'http://localhost:9000' }));
    const again = await krafta(['init'], dir);
    assert.equal(again.code, 0);
    assert.match(again.stdout, /Kept krafta\.config\.json\. Kept the existing scripts\./);
    assert.equal((JSON.parse(await readFile(join(dir, 'krafta.config.json'), 'utf8')) as { url: string }).url, 'http://localhost:9000');
    const skill = await krafta(['skill'], dir);
    assert.match(skill.stdout, /Kept the existing skill/);
    await writeFile(join(dir, 'krafta.config.json'), JSON.stringify({ typo: true }));
    const invalid = await krafta(['init'], dir);
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /Unknown config field: typo/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI tile cuts an image into zoomed tiles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-tile-'));
  try {
    await mkdir(join(dir, 'shots'));
    // A 1040×960 screenshot from an audit run.
    await writeFile(join(dir, 'shots', 'shot.png'), await readFile(fileURLToPath(new URL('../../test/fixtures/screenshot.png', import.meta.url))));
    const result = await krafta(['tile', 'shots/shot.png', '--out', 'tiles-out'], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^\d+ tiles \(\d+ rows × 2 cols, 2x\) in tiles-out\/tiles/);
    const tiles = JSON.parse(await readFile(join(dir, 'tiles-out', 'tiles.json'), 'utf8')) as { file: string }[];
    assert.ok(tiles.length >= 4);
    await access(join(dir, 'tiles-out', tiles[0].file));
    const wrong = await krafta(['tile', 'notes.txt'], dir);
    assert.equal(wrong.code, 2);
    assert.match(wrong.stderr, /PNG, JPEG, WebP or GIF/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
