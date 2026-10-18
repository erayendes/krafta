import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, validateConfig, defaultConfig } from '../src/config.js';
import { validateTheme } from '../src/theme.js';
import { resolveTarget } from '../src/target.js';
import { starterConfig } from '../src/project.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('config defaults apply without a file, and sections are validated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-config-'));
  try {
    const config = await loadConfig(undefined, dir);
    assert.deepEqual(config, defaultConfig);
    assert.equal(config.file, undefined);
    assert.throws(() => validateConfig({ checks: {} }), /Unknown config field: checks/);
    assert.throws(() => validateConfig({ check: { fonts: [] } }), /fonts must be a list/);
    assert.throws(() => validateConfig({ audit: { stress: 'yes' } }), /audit\.stress/);
    assert.throws(() => validateConfig({ scan: { grid: 0 } }), /scan\.grid/);
    assert.throws(() => validateConfig({ url: '' }), /url must be/);
    assert.throws(() => validateConfig([]), /must be an object/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('config reads krafta.config.json before a lintapple ui-policy.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-config-'));
  try {
    await writeFile(join(dir, 'ui-policy.json'), JSON.stringify({ fonts: ['Inter'], fontSizes: [14, 16] }));
    const legacy = await loadConfig(undefined, dir);
    assert.deepEqual(legacy.check.fonts, ['Inter']);
    assert.deepEqual(legacy.audit, defaultConfig.audit);
    assert.match(legacy.file ?? '', /ui-policy\.json$/);
    await writeFile(join(dir, 'krafta.config.json'), JSON.stringify({
      $schema: './node_modules/krafta/schema/krafta.config.schema.json',
      url: 'http://localhost:5173', theme: { strategy: 'attribute', name: 'data-theme', dark: 'dark', light: 'light' },
      check: { fonts: ['Geist'] }, audit: { stress: true }, scan: { paths: ['src'] },
    }));
    const config = await loadConfig(undefined, dir);
    assert.equal(config.url, 'http://localhost:5173');
    assert.deepEqual(config.check.fonts, ['Geist']);
    assert.deepEqual(config.check.fontSizes, defaultConfig.check.fontSizes);
    assert.equal(config.audit.stress, true);
    assert.deepEqual(config.scan.paths, ['src']);
    assert.deepEqual(config.theme, { strategy: 'attribute', name: 'data-theme', dark: 'dark', light: 'light' });
    await assert.rejects(loadConfig('missing.json', dir), /ENOENT/);
    await writeFile(join(dir, 'bad.json'), '{');
    await assert.rejects(loadConfig('bad.json', dir), /Invalid JSON in "bad\.json"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a flat lintapple policy cannot be mixed with krafta sections', () => {
  assert.deepEqual(validateConfig({ minControlSize: 24 }).check.minControlSize, 24);
  assert.throws(() => validateConfig({ minControlSize: 24, audit: {} }), /Put policy fields under "check"/);
});

test('themes are validated', () => {
  assert.deepEqual(validateTheme(undefined), { strategy: 'media' });
  assert.deepEqual(validateTheme({ strategy: 'class', name: 'dark' }), { strategy: 'class', name: 'dark' });
  assert.throws(() => validateTheme({ strategy: 'class' }), /theme\.name/);
  assert.throws(() => validateTheme({ strategy: 'attribute', name: 'data-theme' }), /theme\.dark/);
  assert.throws(() => validateTheme({ strategy: 'cookie' }), /media, class, or attribute/);
  assert.throws(() => validateTheme({ strategy: 'media', name: 'x' }), /Unknown theme field: name/);
});

test('targets resolve files, hosts, loopback addresses and the config url', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'krafta-target-'));
  try {
    await writeFile(join(dir, 'page.html'), '<p>Hi</p>');
    assert.match(resolveTarget('page.html', undefined, dir), /^file:\/\/.*\/page\.html$/);
    assert.equal(resolveTarget('localhost:3000', undefined, dir), 'http://localhost:3000/');
    assert.equal(resolveTarget('127.0.0.1:8080/a', undefined, dir), 'http://127.0.0.1:8080/a');
    assert.equal(resolveTarget('example.com/x', undefined, dir), 'https://example.com/x');
    assert.equal(resolveTarget(undefined, 'http://localhost:5173', dir), 'http://localhost:5173');
    assert.equal(resolveTarget('https://a.test', 'http://ignored', dir), 'https://a.test');
    assert.throws(() => resolveTarget(undefined, undefined, dir), /set "url" in krafta\.config\.json/);
    assert.throws(() => resolveTarget('lint', undefined, dir), /Invalid URL/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the JSON schema covers every config field and the starter config is valid', async () => {
  const schema = JSON.parse(await readFile(fileURLToPath(new URL('../../schema/krafta.config.schema.json', import.meta.url)), 'utf8')) as { properties: Record<string, { properties?: Record<string, unknown> }> };
  assert.deepEqual(Object.keys(schema.properties).sort(), ['$schema', 'audit', 'check', 'scan', 'theme', 'url']);
  assert.deepEqual(Object.keys(schema.properties.check.properties ?? {}).sort(), Object.keys(defaultConfig.check).sort());
  assert.deepEqual(Object.keys(schema.properties.audit.properties ?? {}).sort(), Object.keys(defaultConfig.audit).sort());
  assert.deepEqual(Object.keys(schema.properties.scan.properties ?? {}).sort(), Object.keys(defaultConfig.scan).sort());
  const config = validateConfig(starterConfig);
  assert.equal(config.url, 'http://localhost:3000');
  assert.deepEqual(config.audit.themes, ['light', 'dark']);
});
