import type { Page } from 'playwright';

export type Scheme = 'light' | 'dark';

// How the app switches between light and dark.
// media: the app follows prefers-color-scheme.
// class: the app adds a class (for example "dark") to <html>.
// attribute: the app sets an attribute (for example data-theme="dark") on <html>.
export type ThemeToggle =
  | { strategy: 'media' }
  | { strategy: 'class'; name: string }
  | { strategy: 'attribute'; name: string; dark: string; light?: string };

export const mediaTheme: ThemeToggle = { strategy: 'media' };

export function validateTheme(input: unknown): ThemeToggle {
  if (input === undefined) return mediaTheme;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('theme must be an object.');
  const theme = input as Record<string, unknown>;
  const text = (key: string) => {
    if (typeof theme[key] !== 'string' || !(theme[key] as string).trim()) throw new Error(`theme.${key} must be a nonempty string.`);
    return theme[key] as string;
  };
  const only = (keys: string[]) => {
    for (const key of Object.keys(theme)) if (!keys.includes(key)) throw new Error(`Unknown theme field: ${key}`);
  };
  if (theme.strategy === 'media') { only(['strategy']); return mediaTheme; }
  if (theme.strategy === 'class') { only(['strategy', 'name']); return { strategy: 'class', name: text('name') }; }
  if (theme.strategy === 'attribute') {
    only(['strategy', 'name', 'dark', 'light']);
    const result: ThemeToggle = { strategy: 'attribute', name: text('name'), dark: text('dark') };
    if (theme.light !== undefined) result.light = text('light');
    return result;
  }
  throw new Error('theme.strategy must be media, class, or attribute.');
}

// The browser preference to use for a context. Class and attribute themes start light.
export function contextScheme(scheme: Scheme, toggle: ThemeToggle): Scheme {
  return toggle.strategy === 'media' ? scheme : 'light';
}

// Apply the theme after the page loads. Media themes need no change.
export async function applyTheme(page: Page, scheme: Scheme, toggle: ThemeToggle): Promise<void> {
  if (toggle.strategy === 'media') return;
  await page.evaluate(({ scheme, toggle }) => {
    const root = document.documentElement;
    if (toggle.strategy === 'class') root.classList.toggle(toggle.name, scheme === 'dark');
    else if (toggle.strategy === 'attribute') {
      const value = scheme === 'dark' ? toggle.dark : toggle.light;
      if (value === undefined) root.removeAttribute(toggle.name);
      else root.setAttribute(toggle.name, value);
    }
  }, { scheme, toggle });
  await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
