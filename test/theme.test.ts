import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkUrl } from '../src/check/engine.js';

const page = (selector: string) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html { background: #fff; color: #202020; font: 16px/1.5 system-ui; } body { margin: 24px; } h1 { font-size: 24px; }
${selector} { background: #111; color: #333; }
</style></head><body><h1>Invoices</h1><p>Paid this month.</p></body></html>`;

async function serve(html: string, callback: (url: string) => Promise<void>) {
  const server = createServer((_, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`); }
  finally { await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve())); }
}
const policy = { viewports: [{ width: 390, height: 844 }], colorSchemes: ['light' as const, 'dark' as const] };
const failing = (report: Awaited<ReturnType<typeof checkUrl>>) => [...new Set(report.findings.filter(f => f.rule === 'text-contrast').map(f => f.colorScheme))];

test('check finds dark-only problems with class and attribute themes', async () => {
  await serve(page('html.dark'), async url => {
    assert.deepEqual(failing(await checkUrl(url, policy)), [], 'media strategy cannot see the class theme');
    assert.deepEqual(failing(await checkUrl(url, policy, { theme: { strategy: 'class', name: 'dark' } })), ['dark']);
  });
  await serve(page('html[data-theme="dark"]'), async url => {
    assert.deepEqual(failing(await checkUrl(url, policy, { theme: { strategy: 'attribute', name: 'data-theme', dark: 'dark', light: 'light' } })), ['dark']);
  });
  await serve(page('@media (prefers-color-scheme: dark) { html }').replace('@media (prefers-color-scheme: dark) { html } {', '@media (prefers-color-scheme: dark) { html {').replace('color: #333; }', 'color: #333; } }'), async url => {
    assert.deepEqual(failing(await checkUrl(url, policy)), ['dark']);
  });
});
