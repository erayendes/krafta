// Adapted from lintapple (https://github.com/gholtzap/lintapple), MIT License,
// Copyright (c) 2026 Gavin Holtzapple. See NOTICE.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let installation: Promise<void> | undefined;

export async function launchBrowser() {
  // CHROME_PATH uses an installed Chrome or Edge instead of the Playwright download.
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH });
  try { return await chromium.launch(); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Executable doesn't exist at")) throw error;
  }
  if (!installation) {
    console.error('Downloading Chromium.');
    installation = new Promise<void>((resolve, reject: (reason?: unknown) => void) => {
      const cli = fileURLToPath(new URL('cli.js', import.meta.resolve('playwright/package.json')));
      const child = spawn(process.execPath, [cli, 'install', 'chromium', '--only-shell'], { stdio: ['ignore', 2, 'pipe'] });
      let stderr = '', noSpace = false;
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk).slice(-8192);
        noSpace ||= stderr.includes('ENOSPC');
      });
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (!noSpace && stderr) process.stderr.write(stderr);
        if (code === 0) return resolve();
        const error: NodeJS.ErrnoException = new Error(`Chromium setup failed (${signal || code}). See the download error above, then run krafta again.`);
        if (noSpace) error.code = 'ENOSPC';
        reject(error);
      });
    }).finally(() => { installation = undefined; });
  }
  await installation;
  return chromium.launch();
}
