import { readFile, writeFile, rename, rm, cp, mkdir, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONFIG_FILE, loadConfig, parseJson } from './config.js';
import { defaultPolicy } from './check/engine.js';

// The config that `krafta init` writes. The full check policy is written so teams can see
// and edit every rule value. Audit and scan settings keep their defaults until changed.
export const starterConfig = {
  $schema: './node_modules/krafta/schema/krafta.config.schema.json',
  url: 'http://localhost:3000',
  theme: { strategy: 'media' },
  check: defaultPolicy,
  audit: { themes: ['light', 'dark'], stress: false, states: [] },
  scan: { paths: ['.'], failOn: 'high', exceptions: [] },
};

const exists = (file: string) => access(file).then(() => true, () => false);

export function skillSource(): string {
  // Built files are in dist/src. The skill is at the package root.
  return fileURLToPath(new URL('../../skills/krafta/', import.meta.url));
}

// Copy the agent skill into the project, so Claude Code (and other agents that read
// .claude/skills) can load it. Existing files are kept unless force is set.
export async function installSkill(cwd = process.cwd(), { force = false } = {}): Promise<{ target: string; copied: boolean }> {
  const target = path.join(cwd, '.claude', 'skills', 'krafta');
  if (!force && await exists(path.join(target, 'SKILL.md'))) return { target, copied: false };
  await mkdir(path.dirname(target), { recursive: true });
  await cp(skillSource(), target, { recursive: true, force: true });
  return { target, copied: true };
}

export async function initProject({ cwd = process.cwd(), skill = false, log = console.log }: { cwd?: string; skill?: boolean; log?: (line: string) => void } = {}): Promise<void> {
  const pkgPath = path.join(cwd, 'package.json');
  const original = await readFile(pkgPath, 'utf8');
  const pkg = parseJson(original, 'package.json') as { [key: string]: unknown; scripts?: Record<string, unknown> };
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package.json must be an object.');
  if (pkg.scripts !== undefined && (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts))) throw new Error('package.json scripts must be an object.');
  // Fail early on an invalid existing config. A valid one is kept as it is.
  await loadConfig(undefined, cwd);
  let created = false;
  try {
    await writeFile(path.join(cwd, CONFIG_FILE), `${JSON.stringify(starterConfig, null, 2)}\n`, { flag: 'wx' });
    created = true;
  } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
  const scripts = { 'lint:ui': 'krafta check', 'audit:ui': 'krafta audit', 'scan:ui': 'krafta scan' };
  const added = Object.entries(scripts).filter(([name]) => !Object.hasOwn(pkg.scripts ?? {}, name));
  if (added.length) {
    pkg.scripts = { ...pkg.scripts, ...Object.fromEntries(added) };
    const temporary = path.join(cwd, `.krafta-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(pkg, null, 2)}\n`, { flag: 'wx' });
      if (await readFile(pkgPath, 'utf8') !== original) throw new Error('package.json changed during setup. Run krafta init again.');
      await rename(temporary, pkgPath);
    } finally { await rm(temporary, { force: true }); }
  }
  log(`${created ? 'Created' : 'Kept'} ${CONFIG_FILE}. ${added.length ? `Added ${added.map(([name]) => name).join(', ')}` : 'Kept the existing scripts'}.`);
  if (skill) {
    const result = await installSkill(cwd);
    log(`${result.copied ? 'Copied' : 'Kept'} the agent skill in ${path.relative(cwd, result.target)}.`);
  }
  log('Next: set the fonts and text sizes in krafta.config.json and the url of your app.');
  log('Start your app, then run npm run lint:ui.');
}
