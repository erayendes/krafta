#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateInteractions } from '../src/check/interactions.js';
import { checkUrl } from '../src/check/engine.js';
import { auditUrl } from '../src/audit/run.js';
import { tileImage } from '../src/audit/tile.js';
import { scanPath, formatScan, scanners } from '../src/scan/index.js';
import { loadConfig, parseJson } from '../src/config.js';
import { initProject, installSkill } from '../src/project.js';
import { resolveTarget } from '../src/target.js';
import { formatCliError } from '../src/cli-error.js';
import type { Scanner, ScanSeverity } from '../src/scan/types.js';
import type { Scheme } from '../src/theme.js';

const usage = `krafta: check, audit and scan interfaces against explicit design rules.

Usage:
  krafta check [url] [--config path] [--ready selector] [--interactions path] [--storage-state file] [--json]
      The gate. Runs the design rules at each configured viewport and theme.
      Exit 0: passed, 1: UI findings, 2: the check did not finish.

  krafta audit [url | file.html] [--out dir] [--viewports 375x812,1440x900] [--themes light,dark]
               [--stress] [--states empty,error] [--state-param name] [--wait-for selector]
               [--storage-state file] [--max-per-rule n] [--no-gate] [--no-focus] [--no-tiles] [--json]
      The review. Measures the rendered page, runs the gate rules in the same pass, and writes
      report.md, report.json, screenshots, an annotated screenshot and zoomed tiles.
      Exit 0: the audit finished, 2: no run finished.

  krafta scan [path ...] [--scanners theme,tokens,hit-area] [--grid n] [--fail-on high|warn|info|never] [--json]
      Static scan of SwiftUI, Compose, Android XML, CSS and Tailwind source for theme mixes,
      token drift and hit areas. Exit 0: passed, 1: findings at or above --fail-on, 2: error.

  krafta tile <image> [--out dir]     Cut a screenshot into zoomed tiles for a region scan.
  krafta init [--skill]               Create krafta.config.json and npm scripts. --skill copies the agent skill.
  krafta skill [--force]              Copy the agent skill to .claude/skills/krafta.

The url defaults to "url" in krafta.config.json. Domains use HTTPS. Localhost uses HTTP.
Options: --config path  --help  --version`;

interface Parsed { positional: string[]; flags: Map<string, string | true> }
const VALUE_FLAGS = new Set(['--config', '--ready', '--interactions', '--storage-state', '--out', '--viewports', '--themes', '--states', '--state-param', '--wait-for', '--max-per-rule', '--scanners', '--grid', '--fail-on']);
const BOOLEAN_FLAGS: Record<string, string[]> = {
  check: ['--json'],
  audit: ['--json', '--stress', '--no-gate', '--no-focus', '--no-tiles'],
  scan: ['--json'],
  tile: [],
  init: ['--skill'],
  skill: ['--force'],
};
const ALLOWED: Record<string, string[]> = {
  check: ['--config', '--ready', '--interactions', '--storage-state'],
  audit: ['--config', '--out', '--viewports', '--themes', '--states', '--state-param', '--wait-for', '--storage-state', '--max-per-rule'],
  scan: ['--config', '--scanners', '--grid', '--fail-on'],
  tile: ['--out'],
  init: [],
  skill: [],
};

function parse(command: string, args: string[]): Parsed {
  const positional: string[] = [], flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) { positional.push(arg); continue; }
    if (VALUE_FLAGS.has(arg) && ALLOWED[command].includes(arg)) {
      const value = args[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      flags.set(arg, value);
    } else if (BOOLEAN_FLAGS[command].includes(arg)) flags.set(arg, true);
    else throw new Error(`Unknown option for krafta ${command}: ${arg}. Run krafta --help for options.`);
  }
  return { positional, flags };
}

const text = (p: Parsed, flag: string) => { const v = p.flags.get(flag); return typeof v === 'string' ? v : undefined; };
const list = (value: string) => value.split(',').map(s => s.trim()).filter(Boolean);
const integer = (value: string, flag: string) => {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a positive integer.`);
  return Number(value);
};

async function version() {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

const args = process.argv.slice(2);
const command = args[0];
let url: string | undefined;
try {
  if (!command || command === '--help' || command === '-h' || args.includes('--help')) { console.log(usage); process.exit(command ? 0 : 2); }
  if (command === '--version' || command === '-v') { console.log(await version()); process.exit(0); }
  if (!(command in ALLOWED)) throw new Error(`Unknown command: ${command}. Use check, audit, scan, tile, init or skill. Run krafta --help for usage.`);
  const p = parse(command, args.slice(1));

  if (command === 'init') {
    if (p.positional.length) throw new Error('Use krafta init without arguments.');
    await initProject({ skill: p.flags.has('--skill') });
    process.exit(0);
  }
  if (command === 'skill') {
    if (p.positional.length) throw new Error('Use krafta skill without arguments.');
    const result = await installSkill(process.cwd(), { force: p.flags.has('--force') });
    console.log(result.copied ? `Copied the agent skill to ${path.relative(process.cwd(), result.target)}.` : `Kept the existing skill in ${path.relative(process.cwd(), result.target)}. Use --force to replace it.`);
    process.exit(0);
  }
  if (command === 'tile') {
    if (p.positional.length !== 1) throw new Error('Provide one image: krafta tile <image> [--out dir].');
    const result = await tileImage(p.positional[0], text(p, '--out'));
    console.log(`${result.tiles.length} tiles (${result.rows} rows × ${result.cols} cols, ${result.scale}x) in ${result.dir}`);
    process.exit(0);
  }

  const config = await loadConfig(text(p, '--config'));

  if (command === 'scan') {
    const settings = { ...config.scan };
    if (p.positional.length) settings.paths = p.positional;
    const chosen = text(p, '--scanners');
    if (chosen) settings.scanners = list(chosen) as Scanner[];
    const grid = text(p, '--grid');
    if (grid) settings.grid = Number(grid);
    const failOn = text(p, '--fail-on');
    if (failOn) settings.failOn = failOn as ScanSeverity | 'never';
    if (settings.scanners.some(s => !scanners.includes(s))) throw new Error(`--scanners must contain ${scanners.join(', ')}.`);
    // Paths on the command line are relative to the working directory; config paths to the config file.
    const root = p.positional.length || !config.file ? process.cwd() : path.dirname(config.file);
    const report = await scanPath(root, settings);
    console.log(p.flags.has('--json') ? JSON.stringify(report, null, 2) : formatScan(report, settings.maxPerRule));
    process.exitCode = report.failed ? 1 : 0;
  } else if (command === 'check') {
    if (p.positional.length > 1) throw new Error('Provide one URL.');
    url = resolveTarget(p.positional[0], config.url);
    const interactionsPath = text(p, '--interactions');
    const interactions = interactionsPath ? validateInteractions(parseJson(await readFile(interactionsPath, 'utf8'), interactionsPath)) : undefined;
    const storageState = text(p, '--storage-state');
    const report = await checkUrl(url, config.check, { ready: text(p, '--ready'), interactions, theme: config.theme, ...(storageState ? { storageState } : {}) });
    if (p.flags.has('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      const count = report.runs.reduce((sum, run) => sum + run.states.length, 0);
      console.log(`${report.findings.length ? 'Failed' : 'Passed'}: ${report.findings.length} UI findings across ${count} page checks.`);
      for (const f of report.findings) console.log(`\n${f.rule} (${f.viewport.width}px, ${f.colorScheme}, ${f.state || 'interaction'})\n${f.selector}\n${f.message}\nFix: ${f.fix}`);
      const suppressed = report.runs.reduce((sum, run) => sum + run.suppressed.length, 0);
      if (suppressed) console.log(`\n${suppressed} findings excluded by policy. See the JSON report for reasons.`);
    }
    process.exitCode = report.findings.length ? 1 : 0;
  } else {
    if (p.positional.length > 1) throw new Error('Provide one URL or HTML file.');
    url = resolveTarget(p.positional[0], config.url);
    const viewports = text(p, '--viewports');
    const themes = text(p, '--themes');
    const states = text(p, '--states');
    const maxPerRule = text(p, '--max-per-rule');
    const storageState = text(p, '--storage-state');
    const json = p.flags.has('--json');
    const report = await auditUrl(url, {
      ...config.audit,
      ...(viewports ? { viewports: list(viewports).map(v => {
        const m = v.match(/^(\d{2,5})[x×](\d{2,5})$/i);
        if (!m) throw new Error(`Bad viewport "${v}". Use WIDTHxHEIGHT, for example 375x812.`);
        return { width: Number(m[1]), height: Number(m[2]) };
      }) } : {}),
      ...(themes ? { themes: list(themes) as Scheme[] } : {}),
      ...(states ? { states: list(states) } : {}),
      ...(text(p, '--state-param') ? { stateParam: text(p, '--state-param') } : {}),
      ...(maxPerRule ? { maxPerRule: integer(maxPerRule, '--max-per-rule') } : {}),
      ...(p.flags.has('--stress') ? { stress: true } : {}),
      ...(p.flags.has('--no-focus') ? { focus: false } : {}),
      ...(p.flags.has('--no-tiles') ? { tiles: false } : {}),
      out: text(p, '--out') ?? 'krafta-audit',
      ...(text(p, '--wait-for') ? { waitFor: text(p, '--wait-for') } : {}),
      ...(storageState ? { storageState } : {}),
      theme: config.theme,
      policy: p.flags.has('--no-gate') ? false : config.check,
      log: line => console.error(line),
    });
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      const { totals } = report;
      console.log(`Report: ${path.join(report.out, 'report.md')}`);
      console.log(`${report.runs.length} runs finished${report.failedRuns.length ? `, ${report.failedRuns.length} failed` : ''}. Gate findings: ${report.runs.some(r => r.gate) ? report.gateFindings : 'not run'}. Leads: ${totals.error} errors, ${totals.warn} warnings, ${totals.info} info.`);
    }
    process.exitCode = report.runs.length ? 0 : 2;
  }
} catch (error) {
  const message = formatCliError(error, { url, initializing: command === 'init' });
  console.error(`krafta could not finish: ${message}`);
  process.exitCode = 2;
}
