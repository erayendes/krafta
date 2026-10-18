// Adapted from interface-craft render_audit.mjs (https://github.com/harun-yardimci/interface-craft),
// MIT License, Copyright (c) 2026 Harun Yardimci. See NOTICE.
import type { Tile } from './types.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from '../check/browser.js';

const types: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', gif: 'gif' };

// Cut an existing screenshot (for example one a user sent) into zoomed tiles for a region scan.
// This measures nothing: it only makes small regions easy to read.
export async function tileImage(image: string, out = 'krafta-tiles'): Promise<{ tiles: Tile[]; rows: number; cols: number; scale: number; dir: string }> {
  const type = types[path.extname(image).slice(1).toLowerCase()];
  if (!type) throw new Error('Use a PNG, JPEG, WebP or GIF image.');
  const data = `data:image/${type};base64,${(await readFile(image)).toString('base64')}`;
  const browser = await launchBrowser();
  try {
    const probe = await browser.newPage();
    await probe.setContent(`<img id=i src="${data}">`);
    const { w, h } = await probe.evaluate(async () => { const i = document.getElementById('i') as HTMLImageElement; await i.decode(); return { w: i.naturalWidth, h: i.naturalHeight }; });
    await probe.close();
    // Retina-sized sources are already detailed: about 960px tiles at 1x. Smaller sources: about 480px tiles at 2x.
    const hiRes = w >= 1600, cols = Math.max(1, Math.round(w / (hiRes ? 960 : 480)));
    const tw = Math.ceil(w / cols), th = Math.round(tw * 0.85), ov = Math.round(tw * 0.04), scale = hiRes ? 1 : 2;
    const page = await browser.newPage({ viewport: { width: w, height: Math.min(h, 4000) }, deviceScaleFactor: scale });
    await page.setContent(`<style>html,body{margin:0;background:#888}</style><img src="${data}" style="display:block">`);
    await page.waitForTimeout(100);
    const dir = path.join(out, 'tiles');
    await mkdir(dir, { recursive: true });
    const tiles: Tile[] = [];
    const rows = Math.ceil(h / th);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = Math.max(0, c * tw - ov), y = Math.max(0, r * th - ov);
      const cw = Math.min(w - x, tw + 2 * ov), ch = Math.min(h - y, th + 2 * ov);
      if (cw < 8 || ch < 8) continue;
      const file = `tiles/r${String(r + 1).padStart(2, '0')}c${c + 1}.png`;
      await page.screenshot({ path: path.join(out, file), fullPage: true, clip: { x, y, width: cw, height: ch } });
      tiles.push({ file, x, y, w: cw, h: ch });
    }
    await writeFile(path.join(out, 'tiles.json'), JSON.stringify(tiles, null, 2));
    return { tiles, rows, cols, scale, dir };
  } finally { await browser.close(); }
}
