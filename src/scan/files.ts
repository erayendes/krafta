import type { SourceFile } from './types.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', '.next', 'DerivedData', 'Pods',
  '.build', 'out', 'coverage', '.gradle', 'vendor', '.turbo', '.svelte-kit', 'krafta-audit']);
const EXTENSIONS = new Set(['.swift', '.kt', '.kts', '.xml', '.css', '.scss', '.sass', '.less',
  '.tsx', '.jsx', '.html', '.vue', '.svelte', '.astro', '.json']);
const MAX_BYTES = 2_000_000;

// Read the UI source files under the paths. Generated and vendored folders are skipped.
export async function collectFiles(root: string, paths: string[]): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  const visit = async (full: string): Promise<void> => {
    const info = await stat(full);
    if (info.isDirectory()) {
      for (const entry of (await readdir(full, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.'))) continue;
        if (entry.isDirectory() || entry.isFile()) await visit(path.join(full, entry.name));
      }
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const name = path.basename(full);
    if (!info.isFile() || !EXTENSIONS.has(ext) || info.size > MAX_BYTES || seen.has(full)) return;
    // Only color set manifests are useful JSON.
    if (ext === '.json' && !(name === 'Contents.json' && path.dirname(full).endsWith('.colorset'))) return;
    seen.add(full);
    const text = await readFile(full, 'utf8');
    files.push({ path: full, rel: path.relative(root, full).split(path.sep).join('/') || name, ext, dir: path.dirname(full), name, lines: text.split(/\r?\n/) });
  };
  for (const p of paths) await visit(path.resolve(root, p));
  return files;
}

export const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|<!--)/.test(line);

// A glob such as src/brand/** or **/*.swift, matched against a path relative to the root.
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      source += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}
