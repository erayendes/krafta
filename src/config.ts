import type { Policy } from './check/types.js';
import type { AuditSettings } from './audit/types.js';
import type { ScanSettings } from './scan/types.js';
import type { ThemeToggle } from './theme.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultPolicy, validatePolicy } from './check/engine.js';
import { defaultAuditSettings, validateAuditSettings } from './audit/run.js';
import { defaultScanSettings, validateScanSettings } from './scan/index.js';
import { mediaTheme, validateTheme } from './theme.js';

export const CONFIG_FILE = 'krafta.config.json';
// lintapple's policy file. krafta reads it as the check policy when there is no krafta config.
export const LEGACY_POLICY_FILE = 'ui-policy.json';

export interface Config {
  // The default page for `krafta check` and `krafta audit`.
  url?: string;
  theme: ThemeToggle;
  check: Policy;
  audit: AuditSettings;
  scan: ScanSettings;
}

export interface ConfigInput {
  $schema?: string;
  url?: string;
  theme?: unknown;
  check?: Partial<Policy>;
  audit?: Partial<AuditSettings>;
  scan?: Partial<ScanSettings>;
}

export const defaultConfig: Config = { theme: mediaTheme, check: defaultPolicy, audit: defaultAuditSettings, scan: defaultScanSettings };

export function parseJson(source: string, file: string): unknown {
  try { return JSON.parse(source); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    error.message = `Invalid JSON in ${JSON.stringify(file)}: ${error.message}`;
    throw error;
  }
}

export function validateConfig(input: unknown = {}): Config {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('krafta config must be an object.');
  // A flat lintapple policy has policy fields at the top level. Read it as the check policy.
  const keys = Object.keys(input);
  if (keys.some(key => key in defaultPolicy)) {
    const mixed = keys.filter(key => !(key in defaultPolicy));
    if (mixed.length) throw new Error(`Put policy fields under "check". A config cannot mix them with ${mixed.join(', ')} at the top level.`);
    return { ...structuredClone(defaultConfig), check: validatePolicy(input) };
  }
  const config = input as ConfigInput;
  for (const key of Object.keys(config)) if (!['$schema', 'url', 'theme', 'check', 'audit', 'scan'].includes(key)) throw new Error(`Unknown config field: ${key}. Use url, theme, check, audit, or scan.`);
  if (config.url !== undefined && (typeof config.url !== 'string' || !config.url.trim())) throw new Error('url must be a nonempty string.');
  return {
    ...(config.url ? { url: config.url } : {}),
    theme: validateTheme(config.theme),
    check: validatePolicy(config.check ?? {}),
    audit: validateAuditSettings(config.audit ?? {}),
    scan: validateScanSettings(config.scan ?? {}),
  };
}

const missing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

// Load krafta.config.json from the working directory, or the given file.
// Without it, a lintapple ui-policy.json is used as the check policy. Without either, the defaults apply.
export async function loadConfig(file?: string, cwd = process.cwd()): Promise<Config & { file?: string }> {
  const candidates = file === undefined ? [CONFIG_FILE, LEGACY_POLICY_FILE] : [file];
  for (const name of candidates) {
    const target = path.resolve(cwd, name);
    let source: string;
    try { source = await readFile(target, 'utf8'); }
    catch (error) {
      if (file === undefined && missing(error)) continue;
      throw error;
    }
    return { ...validateConfig(parseJson(source, name)), file: target };
  }
  return structuredClone(defaultConfig);
}
