import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Turn a CLI argument into a page URL.
// A local .html file becomes a file URL. Domains use HTTPS. Localhost and loopback use HTTP.
export function resolveTarget(arg: string | undefined, fallback?: string, cwd = process.cwd()): string {
  const input = arg ?? fallback;
  if (!input) throw new Error('Provide a page URL, or set "url" in krafta.config.json.');
  const local = path.resolve(cwd, input);
  // A host followed by a numeric port is not a URL scheme.
  const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d+(?:[/?#]|$))/i.test(input);
  if (!hasScheme && existsSync(local) && statSync(local).isFile()) return pathToFileURL(local).href;
  if (hasScheme) { new URL(input); return input; }
  const parsed = new URL(`https://${input}`);
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(parsed.hostname);
  if (loopback) parsed.protocol = 'http:';
  if (loopback || parsed.hostname.includes('.')) return parsed.href;
  // Not a file, not a URL: give the same error a bad URL gets.
  return new URL(input).href;
}
