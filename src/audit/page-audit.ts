// Adapted from interface-craft render_audit.mjs (https://github.com/harun-yardimci/interface-craft),
// MIT License, Copyright (c) 2026 Harun Yardimci. See NOTICE.
import type { AuditFinding, Inventory, PageAuditOptions, PageAuditResult, Rect, Severity, TokenBucket, LayoutShift } from './types.js';

type RGBA = [number, number, number, number];
interface Box { left: number; top: number; right: number; bottom: number }
interface Layer { c: RGBA; el: Element }
interface TextRow { el: Element; rs: DOMRect[]; u: Box }
interface Task { el?: Element; kind: 'text' | 'hit' | 'overlap' | 'field'; py: number; done?: boolean; A?: Element; B?: Element }
interface KraftaWindow { __kraftaSel?: (el: Element) => string; __kraftaCLS?: number; __kraftaShifts?: LayoutShift[] }

// Runs in the browser and must stay self-contained: no imports, no outer variables.
// Every hit is a lead measured from the rendered page, not a verdict.
export function pageAudit(opts: PageAuditOptions): PageAuditResult {
  const html = document.documentElement;
  const body = document.body || html;
  const win = window as unknown as KraftaWindow;
  html.style.scrollBehavior = 'auto';
  const vw = html.clientWidth, vh = window.innerHeight;
  const out: AuditFinding[] = [];
  const perRule: Record<string, number> = {};
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BR', 'WBR', 'OPTION']);
  const csCache = new Map<Element, CSSStyleDeclaration>();
  const cs = (el: Element) => { let c = csCache.get(el); if (!c) { c = getComputedStyle(el); csCache.set(el, c); } return c; };
  const textOf = (el: Element | null | undefined) => (el as HTMLElement | null | undefined)?.innerText ?? '';
  const labelsOf = (el: Element): HTMLLabelElement[] => {
    const labels = (el as HTMLInputElement).labels;
    return labels ? [...labels] : [];
  };

  const okId = (s: string) => /^[A-Za-z][\w-]*$/.test(s) && document.querySelectorAll('#' + s).length === 1;
  const selCache = new Map<Element, string>();
  // Short, readable and unique: walk up until the path matches exactly one element.
  const selPath = (el: Element) => {
    if (el.id && okId(el.id)) return '#' + el.id;
    const parts: string[] = [];
    let e: Element | null = el;
    for (let i = 0; e && e.nodeType === 1 && e !== html && i < 12; i++) {
      if (e.id && okId(e.id)) { parts.unshift('#' + e.id); break; }
      let p = e.tagName.toLowerCase();
      const cls = [...e.classList].filter(c => /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
      if (cls.length) p += '.' + cls.join('.');
      const par: Element | null = e.parentElement;
      if (par) {
        const tag = e.tagName;
        const same = [...par.children].filter(c => c.tagName === tag);
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(p);
      e = par;
      if (i >= 3) { try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch { /* keep walking */ } }
    }
    return parts.join(' > ');
  };
  const sel = (el: Element | null) => {
    if (!el || el.nodeType !== 1) return '';
    const cached = selCache.get(el);
    if (cached !== undefined) return cached;
    const result = selPath(el); selCache.set(el, result); return result;
  };
  const pageRect = (r: DOMRect): Rect => ({ x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
  const elRect = (el: Element) => pageRect(el.getBoundingClientRect());
  const snippet = (el: Element) => {
    const input = el as HTMLInputElement;
    const t = (textOf(el) || el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || (typeof input.value === 'string' ? input.value : '') || '').replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  };
  const allKeys = new Set<string>();
  const add = (rule: string, severity: Severity, el: Element | null, message: string, extra: Partial<AuditFinding> = {}) => {
    allKeys.add(rule + '|' + (el ? sel(el) : ''));
    perRule[rule] = (perRule[rule] || 0) + 1;
    if (perRule[rule] > opts.maxPerRule) return;
    out.push({ rule, severity, selector: el ? sel(el) : '', rect: el ? elRect(el) : null, text: el ? snippet(el) : '', message, source: 'audit', ...extra });
  };
  win.__kraftaSel = sel;

  const isVis = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
  };

  // Let the canvas parse any CSS color: rgb, oklch, color(), lab.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  const colCache = new Map<string, RGBA>();
  const rgba = (str: string): RGBA => {
    const cached = colCache.get(str);
    if (cached) return cached;
    let v: RGBA;
    if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') v = [0, 0, 0, 0];
    else {
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data; v = [d[0], d[1], d[2], d[3] / 255];
    }
    colCache.set(str, v); return v;
  };
  const over = (t: RGBA, b: RGBA): RGBA => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1]; };
  const lum = (c: RGBA) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a: RGBA, b: RGBA) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c: RGBA) => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  // Chrome paints a dark canvas when the root opts into dark.
  const scheme = cs(html).colorScheme;
  const darkCanvas = /dark/.test(scheme) && (!/light/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);
  const BASE: RGBA = darkCanvas ? [18, 18, 18, 1] : [255, 255, 255, 1];
  const effOpacity = (el: Element) => { let o = 1; for (let a: Element | null = el; a && a !== html; a = a.parentElement) o *= parseFloat(cs(a).opacity); return o; };
  const disabled = (el: Element) => !!el.closest('[disabled],[aria-disabled="true"],fieldset[disabled]');
  const blended = (el: Element) => { for (let a: Element | null = el; a && a !== html; a = a.parentElement) { const s = cs(a); if (s.mixBlendMode !== 'normal' || (s.filter !== 'none' && s.filter)) return true; } return false; };
  const MEDIA = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED']);

  // The background painted under (x, y) beneath `el`, in the real stacking order.
  const bgUnder = (el: Element, x: number, y: number, includeSelf = true) => {
    let stack = document.elementsFromPoint(x, y);
    let i = stack.indexOf(el);
    let coveredBy: Element | null = null, uncertain: string | null = null;
    if (i < 0) { stack = []; for (let a: Element | null = el; a; a = a.parentElement) stack.push(a); i = 0; }
    else {
      for (let k = 0; k < i; k++) {
        const t = stack[k];
        if (el.contains(t) || t.contains(el)) continue;
        const s = cs(t);
        if (blended(t)) { uncertain = 'a blend-mode layer'; continue; }
        if (rgba(s.backgroundColor)[3] > 0.05 || MEDIA.has(t.tagName) || s.backgroundImage !== 'none') { coveredBy = t; break; }
      }
    }
    if (blended(el)) uncertain = 'a blend-mode layer';
    const layers: Layer[] = [];
    for (let k = includeSelf ? i : i + 1; k < stack.length; k++) {
      const t = stack[k], s = cs(t);
      if (uncertain) break;
      if (MEDIA.has(t.tagName) || (t !== el && t.tagName.toLowerCase() === 'svg')) { uncertain = t.tagName.toLowerCase(); break; }
      if (s.backgroundImage && s.backgroundImage !== 'none') { uncertain = 'background-image/gradient'; break; }
      const c = rgba(s.backgroundColor);
      if (c[3] > 0) { layers.push({ c, el: t }); if (c[3] >= 0.999) break; }
    }
    let base = BASE;
    for (let k = layers.length - 1; k >= 0; k--) base = over(layers[k].c, base);
    return { bg: base, layers, uncertain, coveredBy };
  };
  // Text color as painted. An ancestor with opacity < 1 fades its whole content toward what is behind it.
  const painted = (el: Element, textColor: RGBA, layers: Layer[]) => {
    let o = 1, group: Element | null = null;
    for (let a: Element | null = el; a && a !== html; a = a.parentElement) { const v = parseFloat(cs(a).opacity); if (v < 1) { o *= v; group = a; } }
    const fold = (ls: Layer[], b: RGBA) => { for (let k = ls.length - 1; k >= 0; k--) b = over(ls[k].c, b); return b; };
    if (!group) { const bg = fold(layers, BASE); return { fg: over(textColor, bg), bg }; }
    const g = group;
    const inside = layers.filter(l => g.contains(l.el)), outside = layers.filter(l => !g.contains(l.el));
    const backdrop = fold(outside, BASE), bgIn = fold(inside, backdrop), fgIn = over(textColor, bgIn);
    return { fg: over([fgIn[0], fgIn[1], fgIn[2], o], backdrop), bg: over([bgIn[0], bgIn[1], bgIn[2], o], backdrop) };
  };
  const clippedAway = (el: Element, x: number, y: number, self = false) => {
    for (let a: Element | null = self ? el : el.parentElement; a && a !== document.body && a !== html; a = a.parentElement) {
      const s = cs(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
        const r = a.getBoundingClientRect();
        if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) return true;
      }
    }
    return false;
  };
  const ownTextNodes = (el: Element) => [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent?.trim());
  const lineRects = (el: Element) => {
    const rs: DOMRect[] = [];
    for (const n of ownTextNodes(el)) {
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rs.push(r);
    }
    return rs;
  };
  const union = (rs: DOMRect[]): Box => rs.reduce<Box>((u, r) => ({ left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

  // Fully outside an overflow-clipping ancestor (ticker values, off-screen slides): not visible.
  const clippedOut = (el: Element) => {
    const r = el.getBoundingClientRect();
    for (let a: Element | null = el.parentElement; a && a !== document.body && a !== html; a = a.parentElement) {
      const s = cs(a);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      if (r.right <= ar.left + 0.5 || r.left >= ar.right - 0.5 || r.bottom <= ar.top + 0.5 || r.top >= ar.bottom - 0.5) return true;
    }
    return false;
  };
  const decorative = (el: Element) => !!el.closest('[aria-hidden="true"]');
  const isPinned = (el: Element) => { for (let a: Element | null = el; a && a !== html; a = a.parentElement) { const p = cs(a).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };

  // ---------- collect ----------
  const all: Element[] = [];
  for (const el of body.querySelectorAll('*')) {
    if (SKIP.has(el.tagName)) continue;
    if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') continue;
    if (el.id === '__krafta_annot') continue;
    if (isVis(el) && !clippedOut(el)) all.push(el);
  }
  const visSet = new Set(all);
  const textEls = all.filter(el => !(el instanceof SVGElement) && ownTextNodes(el).length);
  const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[onclick],[tabindex]:not([tabindex="-1"])';
  const inter = all.filter(el => !(el instanceof SVGElement) && el.matches(INTERACTIVE));
  const inScroller = (el: Element) => { for (let a: Element | null = el.parentElement; a && a !== document.body && a !== html; a = a.parentElement) { if (cs(a).overflowX !== 'visible') return true; } return false; };

  // ---------- viewport / overflow ----------
  if (opts.mobile && html.clientWidth > opts.vpWidth + 1)
    add('no-mobile-viewport', 'error', null, `Page lays out at ${html.clientWidth}px on a ${opts.vpWidth}px phone: missing or wrong <meta name="viewport">`);
  const docW = html.scrollWidth;
  const hScroll = docW > vw + 1 && !['hidden', 'clip'].includes(cs(html).overflowX) && !['hidden', 'clip'].includes(cs(body).overflowX);
  if (hScroll) add('horizontal-scroll', 'error', null, `Page scrolls sideways: content is ${docW}px wide in a ${vw}px viewport`);
  const offenders = new Set<Element>();
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right <= vw + 1 && r.left >= -1) continue;
    const fullyOut = r.left >= vw || r.right <= 0;
    if (fullyOut && !hScroll) continue;
    if (inScroller(el)) continue;
    if (!hScroll && !textOf(el).trim() && !el.matches(INTERACTIVE)) continue; // decorative bleed
    offenders.add(el);
  }
  for (const el of offenders) if (!el.parentElement || !offenders.has(el.parentElement)) {
    const r = el.getBoundingClientRect();
    add(hScroll ? 'overflows-viewport' : 'cut-by-viewport', hScroll ? 'error' : 'warn', el,
      `Extends ${Math.round(Math.max(r.right - vw, -r.left))}px past the ${vw}px viewport${hScroll ? '' : ' (hidden by overflow-x, so it is cut off)'}`);
  }

  // ---------- clipping / truncation ----------
  const clipCands: { el: Element; rule: string; dir: string }[] = [];
  for (const el of all) {
    if (el instanceof SVGElement || el === document.body) continue;
    const s = cs(el);
    const clipX = s.overflowX === 'hidden' || s.overflowX === 'clip', clipY = s.overflowY === 'hidden' || s.overflowY === 'clip';
    const nowrapSpill = s.overflowX === 'visible' && s.whiteSpace.includes('nowrap') && ownTextNodes(el).length > 0 && el.scrollWidth > el.clientWidth + 2;
    if (!clipX && !clipY && !nowrapSpill) continue;
    if (!nowrapSpill && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) continue;
    const box = el.getBoundingClientRect();
    const bl = parseFloat(s.borderLeftWidth) || 0, bt = parseFloat(s.borderTopWidth) || 0;
    const inner = { left: box.left + bl, top: box.top + bt, right: box.left + bl + el.clientWidth, bottom: box.top + bt + el.clientHeight };
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null, outside = false, count = 0, dirH = false, dirV = false;
    while ((n = tw.nextNode()) && count++ < 300) {
      if (!n.textContent?.trim()) continue;
      const pe = n.parentElement; if (!pe || !visSet.has(pe)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      let nodeIn = false, nodeOut = false;
      for (const r of rg.getClientRects()) {
        if (r.width < 1) continue;
        const outH = (clipX || nowrapSpill) && (r.right > inner.right + 1.5 || r.left < inner.left - 1.5);
        const outV = clipY && (r.bottom > inner.bottom + 1.5 || r.top < inner.top - 1.5);
        if (!outH && !outV) { nodeIn = true; continue; }
        nodeOut = true;
        // A line cut through by the edge.
        if ((outH && r.left < inner.right - 1 && r.right > inner.left + 1) || (outV && r.top < inner.bottom - 1 && r.bottom > inner.top + 1)) outside = true;
        if (outH) dirH = true;
        if (outV) dirV = true;
      }
      // Whole text nodes parked outside a window (tickers) are intentional. A node split across the edge is not.
      if (nodeIn && nodeOut) outside = true;
      if (outside) break;
    }
    if (!outside) continue;
    const ell = s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none');
    clipCands.push({ el, rule: nowrapSpill ? 'text-spills-box' : ell ? 'text-truncated' : 'text-clipped', dir: [dirH && 'horizontally', dirV && 'vertically'].filter(Boolean).join(' and ') });
  }
  const clipEls = new Set(clipCands.map(c => c.el));
  for (const c of clipCands) {
    if ([...clipEls].some(o => o !== c.el && c.el.contains(o))) continue; // report the innermost
    const full = textOf(c.el).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (c.rule === 'text-truncated') add('text-truncated', 'info', c.el, `Truncated with ellipsis or line-clamp. Is the hidden part needed? Full text: "${full}"`);
    else if (c.rule === 'text-clipped') add('text-clipped', 'warn', c.el, `Text is cut off ${c.dir} with no ellipsis (fixed size + overflow hidden)`);
    else add('text-spills-box', 'warn', c.el, 'Unwrapped (nowrap) text runs outside its box');
  }

  // ---------- overlapping text ----------
  const trs: TextRow[] = [];
  for (const el of textEls) { const rs = lineRects(el); if (rs.length) trs.push({ el, rs, u: union(rs) }); }
  trs.sort((a, b) => a.u.top - b.u.top);
  const overlapSeen = new Set<string>();
  const overlapCands: { A: Element; B: Element; py: number }[] = [];
  const overlapPoint = (as: DOMRect[], bs: DOMRect[]) => {
    let hit: { x: number; y: number } | null = null;
    for (const a of as) for (const b of bs) {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left) - 1, h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) - 1;
      if (w > 1 && h > Math.min(a.height, b.height) * 0.3) hit = { x: (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2, y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 };
    }
    return hit;
  };
  for (let i = 0; i < trs.length; i++) {
    const A = trs[i];
    for (let j = i + 1; j < trs.length && trs[j].u.top < A.u.bottom; j++) {
      const B = trs[j];
      if (B.u.left >= A.u.right || B.u.right <= A.u.left) continue;
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const hit = overlapPoint(A.rs, B.rs);
      if (!hit || clippedAway(A.el, hit.x, hit.y, true) || clippedAway(B.el, hit.x, hit.y, true)) continue;
      const key = sel(A.el) + '|' + sel(B.el); if (overlapSeen.has(key)) continue; overlapSeen.add(key);
      overlapCands.push({ A: A.el, B: B.el, py: hit.y + scrollY });
    }
  }

  // ---------- scroll pass: contrast, covered text, covered controls ----------
  const tasks: Task[] = [];
  for (const t of trs) tasks.push({ el: t.el, kind: 'text', py: (t.rs[0].top + t.rs[0].bottom) / 2 + scrollY });
  for (const el of inter) { const r = el.getBoundingClientRect(); tasks.push({ el, kind: 'hit', py: r.top + r.height / 2 + scrollY }); }
  const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]),select,textarea';
  for (const c of overlapCands) tasks.push({ kind: 'overlap', ...c });
  for (const el of inter) if (el.matches(FIELD)) { const r = el.getBoundingClientRect(); tasks.push({ el, kind: 'field', py: r.top + r.height / 2 + scrollY }); }

  const softBody: { el: Element; ratio: number }[] = [];
  const inView = (x: number, y: number) => x >= 0 && x < vw && y >= 0 && y < vh;
  let atBottom = false;
  const runText = (el: Element) => {
    const r0 = lineRects(el)[0]; if (!r0) return;
    const x = (r0.left + r0.right) / 2, y = (r0.top + r0.bottom) / 2;
    if (!inView(x, y) || clippedAway(el, x, y, true)) return;
    const s = cs(el);
    if (s.webkitTextFillColor && rgba(s.webkitTextFillColor)[3] === 0) return; // gradient or clipped text
    const { layers, uncertain, coveredBy } = bgUnder(el, x, y);
    if (coveredBy) {
      // Under a fixed bar at the end of the page, the user cannot reach this text.
      if (isPinned(coveredBy) && !isPinned(el) && atBottom) add('text-covered', 'warn', el, `Text at the end of the page stays hidden under the fixed ${sel(coveredBy)}. Scrolling cannot reveal it. Add bottom padding equal to the bar.`, { coveredBy: sel(coveredBy) });
      return;
    }
    if (disabled(el) || decorative(el)) return;
    const { fg, bg } = painted(el, rgba(s.color), layers);
    const ratio = contrast(fg, bg);
    const size = parseFloat(s.fontSize), weight = parseInt(s.fontWeight, 10) || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    if (uncertain) { add('contrast-on-image', 'info', el, `Text over ${uncertain}: contrast cannot be measured. Check the tile in both themes.`); return; }
    if (ratio >= need && ratio < 7 && /^(P|LI|DD|BLOCKQUOTE)$/.test(el.tagName) && size <= 18 && new Set(lineRects(el).map(r => Math.round(r.top))).size >= 2) softBody.push({ el, ratio });
    if (ratio < need) add('low-contrast', ratio < need * 0.75 ? 'error' : 'warn', el, `Contrast ${ratio.toFixed(2)}:1, needs ${need}:1 (${hex(fg)} on ${hex(bg)}, ${size}px/${weight})`, { ratio: +ratio.toFixed(2) });
  };
  const runOverlap = (A: Element, B: Element) => {
    const visibleInk = (el: Element) => rgba(cs(el).color)[3] * effOpacity(el) > 0.05;
    if (!visibleInk(A) || !visibleInk(B) || blended(A) || blended(B)) return;
    if ((A.textContent || '').trim() === (B.textContent || '').trim()) return; // stacked copy for an effect
    const pt = overlapPoint(lineRects(A), lineRects(B));
    if (!pt || !inView(pt.x, pt.y)) return;
    if (bgUnder(A, pt.x, pt.y).coveredBy || bgUnder(B, pt.x, pt.y).coveredBy) return; // one of them is under a surface
    add('text-overlap', 'error', A, `Text overlaps "${snippet(B)}" (${sel(B)})`);
  };
  const runHit = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!inView(x, y) || clippedAway(el, x, y)) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === el || el.contains(hit)) return;
    if (labelsOf(el).some(l => l.contains(hit) || hit.contains(l))) return;
    if (hit.contains(el)) { if (cs(el).pointerEvents === 'none') add('hit-blocked', 'warn', el, 'Control has pointer-events: none. Clicks fall through to its parent.'); return; }
    const hs = cs(hit);
    const visible = rgba(hs.backgroundColor)[3] > 0.05 || MEDIA.has(hit.tagName) || hs.backgroundImage !== 'none' || ownTextNodes(hit).length > 0 || hit.tagName.toLowerCase() === 'svg';
    if (!visible) add('hit-covered', 'error', el, `An invisible layer (${sel(hit)}) sits over the center of this control. Clicks go to it instead.`, { coveredBy: sel(hit) });
    else if (isPinned(hit) && !isPinned(el) && atBottom) add('hit-covered', 'warn', el, `Control is under the fixed or sticky ${sel(hit)} at this scroll position`, { coveredBy: sel(hit) });
  };
  const runField = (el: Element) => {
    if (disabled(el)) return;
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(6, r.width / 4), y = r.top + r.height / 2;
    if (!inView(x, y) || clippedAway(el, x, y)) return;
    const s = cs(el);
    const around = bgUnder(el, x, y, false);
    const own = bgUnder(el, x, y, true);
    if (around.uncertain || own.uncertain) return;
    const input = el as HTMLInputElement;
    if (input.placeholder && !input.value) {
      const pc = rgba(getComputedStyle(el, '::placeholder').color);
      const pr = contrast(over(pc, own.bg), own.bg);
      if (pr < 4.5) add('low-contrast-placeholder', pr < 3 ? 'warn' : 'info', el, `Placeholder contrast ${pr.toFixed(2)}:1 (needs 4.5:1 if it carries information)`);
    }
    const bw = Math.max(parseFloat(s.borderTopWidth), parseFloat(s.borderBottomWidth), parseFloat(s.borderLeftWidth));
    const bc = bw > 0 ? contrast(over(rgba(s.borderBottomColor), around.bg), around.bg) : 1;
    const fillC = contrast(own.bg, around.bg);
    if (Math.max(bc, fillC) < 3 && s.boxShadow === 'none')
      add('weak-field-boundary', 'warn', el, `Field edge is hard to see: border ${bc.toFixed(2)}:1, fill ${fillC.toFixed(2)}:1 against the surface (needs 3:1, WCAG 1.4.11)`);
  };
  const docH = Math.max(html.scrollHeight, body.scrollHeight);
  const step = Math.max(200, Math.floor(vh * 0.7)), maxY = Math.max(0, docH - vh);
  const positions: number[] = [];
  for (let y = 0; positions.length < 80; y += step) { const yy = Math.min(y, maxY); positions.push(yy); if (yy >= maxY) break; }
  positions.forEach((y, pi) => {
    window.scrollTo(0, y);
    atBottom = pi === positions.length - 1;
    const lo = pi === 0 ? -Infinity : y + vh * 0.15, hi = pi === positions.length - 1 ? Infinity : y + vh * 0.85;
    for (const t of tasks) {
      if (t.done || t.py < lo || t.py >= hi) continue;
      t.done = true;
      try {
        if (t.kind === 'overlap') runOverlap(t.A!, t.B!);
        else if (t.kind === 'text') runText(t.el!);
        else if (t.kind === 'hit') runHit(t.el!);
        else runField(t.el!);
      } catch { /* keep going */ }
    }
  });
  window.scrollTo(0, 0);

  // ---------- targets and names ----------
  const iRects = inter.map(el => ({ el, r: el.getBoundingClientRect() })).filter(x => x.r.width >= 2 && x.r.height >= 2);
  const grow = (r: DOMRect): Box => { const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2, w = Math.max(24, r.width) / 2, h = Math.max(24, r.height) / 2; return { left: x - w, right: x + w, top: y - h, bottom: y + h }; };
  const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  // WCAG 2.5.8 spacing exception: an undersized target passes if a 24px box around it touches no other target.
  const spaced = (el: Element, r: DOMRect) => !iRects.some(o => o.el !== el && !o.el.contains(el) && !el.contains(o.el) && meets(grow(r), grow(o.r)));
  for (const el of inter) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (decorative(el)) { if ((el as HTMLElement).tabIndex >= 0) add('focusable-in-aria-hidden', 'warn', el, 'Focusable control inside aria-hidden="true". The keyboard reaches it, but screen readers do not announce it. Add tabindex="-1" or inert.'); continue; }
    const s = cs(el);
    const inlineLink = el.tagName === 'A' && s.display === 'inline' && textOf(el.parentElement).trim().length > textOf(el).trim().length + 10;
    const labelled = labelsOf(el).some(l => { const lr = l.getBoundingClientRect(); return lr.width >= 24 && lr.height >= 24; });
    const m = Math.min(r.width, r.height);
    if (!inlineLink && !labelled) {
      if (m < 24 && !spaced(el, r)) add('target-too-small', 'warn', el, `${Math.round(r.width)}×${Math.round(r.height)}px and crowded by neighboring targets. Below the 24×24 minimum (WCAG 2.5.8).`);
      else if (opts.touch && m < 44) add('target-under-44', 'info', el, `${Math.round(r.width)}×${Math.round(r.height)}px. Under 44×44 on a touch layout.`);
    }
    const input = el as HTMLInputElement;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || textOf(el).trim() ||
      [...el.querySelectorAll('img[alt]')].map(i => (i as HTMLImageElement).alt).join('') || (el.getAttribute('aria-labelledby') ? 'x' : '') ||
      [...el.querySelectorAll('svg')].map(v => v.getAttribute('aria-label') || v.querySelector('title')?.textContent || '').join('') || (el.textContent || '').trim() ||
      (labelsOf(el).length ? 'x' : '') || el.getAttribute('placeholder') || (el.matches('input[type=submit],input[type=button]') ? input.value : '') || '').trim();
    if (!name && !el.matches('input[type=checkbox],input[type=radio]')) add('no-accessible-name', 'error', el, 'Control has no accessible name. If it is icon-only, add aria-label or visible text.');
  }

  // ---------- media ----------
  const dpr = window.devicePixelRatio || 1;
  for (const img of document.images) {
    if (!visSet.has(img)) continue;
    const r = img.getBoundingClientRect();
    if (!img.hasAttribute('alt') && !decorative(img)) add('img-missing-alt', 'warn', img, 'Image has no alt attribute. Use alt="" if it is decorative.');
    if (img.complete && img.naturalWidth === 0) { add('broken-image', 'error', img, `Image failed to load: ${(img.currentSrc || img.src).slice(0, 100)}`); continue; }
    if (!img.naturalWidth) continue;
    const fit = cs(img).objectFit;
    const nat = img.naturalWidth / img.naturalHeight, ren = r.width / r.height;
    if (fit === 'fill' && Math.abs(ren - nat) / nat > 0.03 && !/\.svg/i.test(img.currentSrc)) add('distorted-image', 'warn', img, `Image is stretched: natural ratio ${nat.toFixed(2)}, shown at ${ren.toFixed(2)}. Use object-fit: cover or contain, or a matching aspect-ratio.`);
    if (r.width > 64 && r.width * dpr > img.naturalWidth * 1.5 && !/\.svg/i.test(img.currentSrc)) add('blurry-image', 'info', img, `Upscaled: ${img.naturalWidth}px source shown at ${Math.round(r.width * dpr)} device px`);
  }

  // ---------- typography ----------
  for (const t of trs) {
    const s = cs(t.el); const fs = parseFloat(s.fontSize);
    if (fs < 12 && !t.el.closest('sup,sub') && !decorative(t.el)) add('tiny-text', 'warn', t.el, `${fs}px text is hard to read (12px minimum, 14-16px for body)`);
    const lh = s.lineHeight === 'normal' ? fs * 1.2 : parseFloat(s.lineHeight);
    const lines = new Set(t.rs.map(r => Math.round(r.top))).size;
    // Body sizes need room between lines. Heading sizes (20px or more) are fine at 1.1-1.3.
    if (fs < 20 && fs >= 11 && ((lines >= 3 && lh / fs < 1.4) || (lines >= 2 && lh / fs < 1.2))) add('tight-line-height', lh / fs < 1.2 ? 'warn' : 'info', t.el, `Line height ${(lh / fs).toFixed(2)} on ${lines}-line ${fs}px text (wrapping body text needs 1.4 or more; 1.5-1.6 is comfortable)`);
    else if (fs >= 20 && lines >= 2 && lh / fs < 1.05) add('tight-line-height', 'info', t.el, `Line height ${(lh / fs).toFixed(2)} on a ${lines}-line ${fs}px heading. Ascenders and descenders can collide.`);
    if (fs >= 24 && lines >= 2 && lh / fs > 1.5) add('loose-heading-leading', 'info', t.el, `Heading line height ${(lh / fs).toFixed(2)} at ${fs}px. Multi-line headings read best at 1.1-1.3.`);
    const cpl = (t.u.right - t.u.left) / (fs * 0.5);
    if (lines >= 3 && cpl > 95) add('long-lines', 'info', t.el, `About ${Math.round(cpl)} characters per line (comfortable: 45-75)`);
  }

  // ---------- alignment: near-miss left edges across the page ----------
  const edges = new Map<number, { el: Element; y: number }[]>();
  const pushEdge = (x: number, el: Element, y: number) => { const k = Math.round(x); const list = edges.get(k) ?? []; list.push({ el, y }); edges.set(k, list); };
  for (const t of trs) { const ta = cs(t.el).textAlign; if (ta === 'center' || ta === 'right' || ta === 'end') continue; pushEdge(t.rs[0].left + scrollX, t.el, t.u.top + scrollY); }
  for (const el of inter) { const r = el.getBoundingClientRect(); pushEdge(r.left + scrollX, el, r.top + scrollY); }
  const reportedEdge = new Set<Element>();
  for (const [x, items] of edges) {
    for (let d = -4; d <= 4; d++) {
      if (Math.abs(d) < 2) continue; // 1px is usually subpixel rounding or glyph side bearing
      const maj = edges.get(x + d);
      if (!maj || maj.length < 3 || maj.length < items.length * 2) continue;
      for (const it of items) {
        if (reportedEdge.has(it.el)) continue;
        if (!maj.some(m => Math.abs(m.y - it.y) < 400 && !m.el.contains(it.el) && !it.el.contains(m.el))) continue;
        reportedEdge.add(it.el);
        add('near-miss-align', 'warn', it.el, `Left edge at x=${x}px, ${Math.abs(d)}px off the common edge x=${x + d}px used by ${maj.length} nearby elements`);
      }
    }
  }

  // ---------- sibling groups: rows, gaps, repeated items ----------
  const parents = new Set(all.map(e => e.parentElement).filter((e): e is HTMLElement => !!e));
  const signature = (el: Element) => el.tagName + '.' + [...el.classList].filter(c => !/active|selected|current|open|hover|focus|first|last|odd|even|is-|has-/i.test(c)).sort().join('.');
  const hasBox = (el: Element) => { const s = cs(el); return rgba(s.backgroundColor)[3] > 0.05 || parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none'; };
  const mode = <T>(arr: T[]): [T, number] => { const m = new Map<T, number>(); arr.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]; };
  const floating = (el: Element) => ['absolute', 'fixed'].includes(cs(el).position);
  for (const p of parents) {
    if (p === html) continue;
    const kids = [...p.children].filter(k => visSet.has(k) && !floating(k) && k.id !== '__krafta_annot');
    if (kids.length < 2) continue;
    const ps = cs(p);
    const flexy = /flex|grid/.test(ps.display);
    const R = kids.map(k => ({ k, r: k.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    const rows: (typeof R)[] = [];
    for (const it of R) {
      const row = rows.find(rw => { const a = rw[0].r; const ov = Math.min(a.bottom, it.r.bottom) - Math.max(a.top, it.r.top); return ov > Math.min(a.height, it.r.height) * 0.5; });
      if (row) row.push(it); else rows.push([it]);
    }
    for (const row of rows) {
      if (row.length < 2) continue;
      row.sort((a, b) => a.r.left - b.r.left);
      if (flexy && ps.alignItems !== 'baseline') {
        const spread = (f: (r: DOMRect) => number) => { const v = row.map(it => f(it.r)); return Math.max(...v) - Math.min(...v); };
        const m = Math.min(spread(r => r.top), spread(r => r.top + r.height / 2), spread(r => r.bottom));
        if (m > 1 && m <= 4) add('row-misaligned', 'warn', p, `${row.length} items in a row are almost aligned but off by ${m.toFixed(1)}px (top, center and bottom all differ)`);
      }
      const sigs = row.map(it => signature(it.k));
      if (sigs.every(s => s === sigs[0]) && row.some(it => hasBox(it.k) || (it.k.children.length === 1 && hasBox(it.k.children[0])))) {
        const hs = row.map(it => it.r.height);
        if (Math.max(...hs) - Math.min(...hs) > 2) add('unequal-height', 'warn', p, `Repeated cards in one row have different heights: ${hs.map(h => Math.round(h)).join(' / ')}px`);
      }
      if (row.length >= 3) {
        const gaps = row.slice(1).map((it, i) => Math.round(it.r.left - row[i].r.right));
        const spread = Math.max(...gaps) - Math.min(...gaps);
        if (spread >= 1 && spread <= 12 && Math.min(...gaps) >= 0) add('uneven-gap', 'warn', p, `Horizontal gaps between siblings differ: ${gaps.join(' / ')}px`);
      }
    }
    const stacked = rows.filter(rw => rw.length === 1).map(rw => rw[0]);
    if (stacked.length >= 3 && rows.length === stacked.length) {
      const gaps = stacked.slice(1).map((it, i) => Math.round(it.r.top - stacked[i].r.bottom));
      const [mg, mc] = mode(gaps);
      const odd = gaps.filter(g => g !== mg && Math.abs(g - mg) >= 1 && Math.abs(g - mg) <= 12);
      if (mc >= 2 && odd.length && odd.length <= gaps.length / 2 && gaps.every(g => g >= 0)) add('uneven-gap', 'warn', p, `Vertical gaps between stacked siblings: mostly ${mg}px, but ${odd.join(', ')}px`);
      const lefts = stacked.map(it => Math.round(it.r.left));
      const [ml, lc] = mode(lefts);
      const centres = stacked.map(it => it.r.left + it.r.width / 2);
      const centred = Math.max(...centres) - Math.min(...centres) <= 1;
      if (lc >= 2 && !centred) stacked.forEach(it => { const d = Math.abs(it.r.left - ml); if (d >= 1.5 && d <= 4) add('near-miss-align', 'warn', it.k, `Stacked sibling starts ${d.toFixed(1)}px off the left edge of its siblings (${ml}px)`); });
    }
    // Repeated items anywhere in the parent: same signature, different internals.
    const groups = new Map<string, Element[]>();
    kids.forEach(k => { const s = signature(k); const list = groups.get(s) ?? []; list.push(k); groups.set(s, list); });
    for (const g of groups.values()) {
      if (g.length < 2 || !g.some(hasBox)) continue;
      const pad = g.map(k => { const s = cs(k); return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].join(' '); });
      if (new Set(pad).size > 1) { const mp = mode(pad)[0]; const i = pad.findIndex(v => v !== mp); add('inconsistent-repeated-item', 'warn', g[i], `Repeated item padding differs from its siblings: ${pad[i]} vs ${mp}`); }
      const icon = g.map(k => { const i = [...k.querySelectorAll('svg,img')].find(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.width <= 64 && r.height <= 64; }); if (!i) return null; const r = i.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; });
      const iv = icon.filter((v): v is string => !!v);
      if (iv.length >= 2 && new Set(iv).size > 1) add('inconsistent-repeated-item', 'warn', p, `Icons in repeated items have different sizes: ${[...new Set(iv)].join(', ')}`);
      const fsz = g.map(k => { const t = trs.find(tr => k.contains(tr.el)); return t ? cs(t.el).fontSize : null; }).filter((v): v is string => !!v);
      if (fsz.length >= 2 && new Set(fsz).size > 1) add('inconsistent-repeated-item', 'warn', p, `First text in repeated items has different sizes: ${[...new Set(fsz)].join(', ')}`);
    }
  }

  // ---------- rhythm: headings and grouping ----------
  const prevVis = (el: Element) => { let e = el.previousElementSibling; while (e && (!visSet.has(e) || floating(e))) e = e.previousElementSibling; return e; };
  const nextVis = (el: Element) => { let e = el.nextElementSibling; while (e && (!visSet.has(e) || floating(e))) e = e.nextElementSibling; return e; };
  for (const h of all.filter(e => /^H[1-6]$/.test(e.tagName))) {
    const pv = prevVis(h), nx = nextVis(h);
    if (!pv || !nx) continue;
    const hr = h.getBoundingClientRect(), pr = pv.getBoundingClientRect(), nr = nx.getBoundingClientRect();
    const above = Math.round(hr.top - pr.bottom), below = Math.round(nr.top - hr.bottom);
    if (above >= 0 && below >= 0 && pr.bottom <= hr.top + 1 && nr.top >= hr.bottom - 1 && above + 2 < below)
      add('heading-spacing-inverted', 'warn', h, `${above}px above vs ${below}px below. The heading drifts away from the content it introduces (use more space above than below).`);
  }
  const stackedKids = (el: Element) => [...el.children].filter(k => visSet.has(k) && !floating(k)).map(k => ({ k, r: k.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
  const innerGaps = (el: Element) => { const ks = stackedKids(el); const g: number[] = []; for (let i = 1; i < ks.length; i++) if (ks[i].r.top >= ks[i - 1].r.bottom - 1) g.push(ks[i].r.top - ks[i - 1].r.bottom); return g; };
  for (const p of parents) {
    if (p === html) continue;
    const ks = stackedKids(p);
    if (ks.length < 2 || ks.some(x => hasBox(x.k) || parseFloat(cs(x.k).paddingTop) + parseFloat(cs(x.k).paddingBottom) > 0)) continue;
    if (ks.some((x, i) => i && x.r.top < ks[i - 1].r.bottom - 1)) continue; // not a vertical stack
    const groupsInner = ks.map(x => innerGaps(x.k)).filter(g => g.length >= 1);
    if (groupsInner.length < 2) continue;
    const inner = Math.max(...groupsInner.flat()), outer = Math.min(...ks.slice(1).map((x, i) => x.r.top - ks[i].r.bottom));
    if (inner >= 4 && outer > 0 && outer < inner * 1.5) add('weak-grouping', 'info', p, `Gap between groups (${Math.round(outer)}px) is not clearly larger than gaps inside them (${Math.round(inner)}px). Aim for 2× or more.`);
  }

  // ---------- forms on phones ----------
  if (opts.mobile) for (const el of inter) if (el.matches(FIELD) && parseFloat(cs(el).fontSize) < 16)
    add('input-zoom-ios', 'warn', el, `Input text is ${cs(el).fontSize}: iOS Safari zooms the page on focus below 16px`);

  // ---------- emphasis: primary actions and accent spread ----------
  const sat = (c: RGBA) => { const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]); return (mx - mn) / 255; };
  const hue = (c: RGBA) => { const [r, g, b] = c.slice(0, 3).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const filled = inter.filter(el => { const c = rgba(cs(el).backgroundColor); return c[3] > 0.9 && sat(c) > 0.25; });
  const firstView = filled.filter(el => { const r = el.getBoundingClientRect(); return r.top < vh && r.bottom > 0 && r.width >= 40; });
  const labels = [...new Set(firstView.map(el => snippet(el)).filter(Boolean))];
  if (labels.length >= 3) add('competing-primaries', 'info', null, `${labels.length} filled accent buttons in the first screen (${labels.slice(0, 4).map(l => `"${l}"`).join(', ')}). Use one primary action per view and demote the rest.`);
  const hueBuckets = new Map<number, Element[]>();
  for (const el of all) { if (el instanceof SVGElement) continue; const c = rgba(cs(el).backgroundColor); if (c[3] > 0.9 && sat(c) > 0.3) { const b = Math.round(hue(c) / 30) % 12; const list = hueBuckets.get(b) ?? []; list.push(el); hueBuckets.set(b, list); } }
  const accentHues = [...hueBuckets.entries()].map(([b, v]) => ({ hue: b * 30, n: v.length, ex: sel(v[0]), c: hex(rgba(cs(v[0]).backgroundColor)) }));
  if (accentHues.length >= 4) add('accent-sprawl', 'info', null, `Saturated fills in ${accentHues.length} hue families (${accentHues.map(a => a.c).join(', ')}). One accent plus status colors is usually enough.`);

  // ---------- generic-look tells (judge against the surface type) ----------
  const tell = (rule: string, el: Element, message: string) => add(rule, 'info', el, message, { tell: true });
  const shadowBlur = (sh: string) => { if (!sh || sh === 'none') return 0; return Math.max(0, ...sh.split(/,(?![^(]*\))/).map(x => { const n = (x.replace(/rgba?\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]+/gi, '').match(/-?[\d.]+px/g) || []).map(parseFloat); return n.length >= 3 ? n[2] : 0; })); };
  const isCard = (el: Element) => { if (/^(INPUT|BUTTON|SELECT|TEXTAREA|A|IMG|svg)$/.test(el.tagName)) return false; const s = cs(el); return parseFloat(s.borderTopLeftRadius) >= 8 && parseFloat(s.paddingTop) >= 12 && (parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== 'none') && el.getBoundingClientRect().width >= 120; };
  const cards = new Set(all.filter(isCard));
  const EMOJI = /\p{Emoji_Presentation}|️/u; // not ©, ®, ™ or arrows
  for (const el of all) {
    if (el instanceof SVGElement) continue;
    const s = cs(el);
    if ((s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text') && /gradient/.test(s.backgroundImage)) tell('gradient-text', el, 'Gradient-filled text is a common generated-UI tell. Solid ink reads better.');
    const bl = parseFloat(s.borderLeftWidth), br = parseFloat(s.borderRightWidth), bt = parseFloat(s.borderTopWidth);
    if ((bl >= 2 || br >= 2) && bt === 0 && sat(rgba(bl >= 2 ? s.borderLeftColor : s.borderRightColor)) > 0.25 && el.getBoundingClientRect().height > 24) tell('side-stripe-accent', el, `Colored ${Math.max(bl, br)}px side stripe on a box is a common generated-UI tell. Use a tone step or an icon.`);
    if (bt >= 1 && s.borderTopStyle !== 'none' && rgba(s.borderTopColor)[3] >= 0.1 && shadowBlur(s.boxShadow) >= 12) tell('border-plus-shadow', el, `A 1px border and a ${shadowBlur(s.boxShadow)}px-blur shadow on one element. Pick one: a line for a boundary, a shadow for elevation.`);
    if (cards.has(el)) { let a = el.parentElement; while (a && !cards.has(a)) a = a.parentElement; if (a) tell('nested-card', el, `Card inside a card (${sel(a)}). Flatten one level and use spacing or a divider inside.`); }
    if (/all/.test(s.transitionProperty) && parseFloat(s.transitionDuration) > 0) add('transition-all', 'info', el, '`transition: all` animates layout changes too. Name the properties (transform, opacity, color).');
    if (/(^|[ ,])ease-in($|[ ,])/.test(s.transitionTimingFunction) && parseFloat(s.transitionDuration) > 0) add('ease-in-transition', 'info', el, '`ease-in` makes UI feel late (slow start). Use a strong ease-out for enter and exit.');
  }
  for (const t of trs) {
    const s = cs(t.el), txt = (t.el.textContent || '').trim();
    const fs = parseFloat(s.fontSize);
    if (fs <= 14 && txt.length >= 3 && txt.length <= 40 && (s.textTransform === 'uppercase' || (/[A-ZÇĞİÖŞÜ]/.test(txt) && txt === txt.toLocaleUpperCase('tr-TR'))) && parseFloat(s.letterSpacing) >= fs * 0.05) {
      const nx = nextVis(t.el) || (t.el.parentElement && nextVis(t.el.parentElement));
      if (nx && (/^H[1-3]$/.test(nx.tagName) || parseFloat(cs(nx).fontSize) >= fs * 1.8)) tell('eyebrow-label', t.el, `Small tracked uppercase label above a heading ("${txt}") is the most common generated-page tell. Drop it unless it carries real navigation.`);
    }
    if (EMOJI.test(txt) && (t.el.closest('button,a,h1,h2,h3,h4,li') || txt.length <= 3)) tell('emoji-as-icon', t.el, 'Emoji used as an icon or decoration. Use the icon set.');
  }
  const famCount: Record<string, number> = {};
  for (const t of trs) { if (t.el.closest('code,pre,kbd,samp')) continue; const n = cs(t.el).fontFamily.split(',')[0].replace(/["']/g, '').trim(); famCount[n] = (famCount[n] || 0) + 1; }
  const fams = Object.entries(famCount);
  if (fams.length > 2) add('too-many-typefaces', 'info', null, `${fams.length} typefaces outside code: ${fams.map(([n, c]) => `${n} ×${c}`).join(', ')}. Two is plenty.`);
  if (softBody.length >= 3) add('soft-body-text', 'info', softBody[0].el, `${softBody.length} body paragraphs in light gray ink (for example ${softBody[0].ratio.toFixed(1)}:1). This passes AA, but running text reads better in full ink (7:1 or more).`);

  // ---------- token inventory ----------
  const inv: Inventory = { fontSize: {}, fontWeight: {}, fontFamily: {}, textColor: {}, radius: {}, shadow: {}, spacing: {} };
  const bump = (bucket: TokenBucket, v: string, el: Element) => { if (!bucket[v]) bucket[v] = { n: 0, ex: [] }; bucket[v].n++; if (bucket[v].ex.length < 3) bucket[v].ex.push(sel(el)); };
  for (const t of trs) {
    const s = cs(t.el);
    bump(inv.fontSize, s.fontSize, t.el); bump(inv.fontWeight, s.fontWeight, t.el);
    bump(inv.fontFamily, s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), t.el);
    const color = rgba(s.color);
    bump(inv.textColor, hex(color) + (color[3] < 1 ? `@${color[3].toFixed(2)}` : ''), t.el);
  }
  const spacingProps = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'rowGap', 'columnGap'] as const;
  for (const el of all) {
    if (el instanceof SVGElement) continue;
    const s = cs(el);
    if (hasBox(el) && s.borderTopLeftRadius !== '0px') bump(inv.radius, s.borderTopLeftRadius, el);
    if (s.boxShadow !== 'none') bump(inv.shadow, s.boxShadow.length > 80 ? s.boxShadow.slice(0, 77) + '…' : s.boxShadow, el);
    for (const prop of spacingProps) {
      const v = parseFloat(s[prop]); if (v > 0 && v < 200) bump(inv.spacing, Math.round(v * 10) / 10 + 'px', el);
    }
  }
  const offGrid = Object.entries(inv.spacing).filter(([v]) => { const n = parseFloat(v); return n >= 3 && (n % 2 !== 0 || (n > 16 && n % 4 !== 0)); }).map(([v, d]) => ({ v, ...d }));
  for (const [k, bucket] of [['fontSize', inv.fontSize], ['radius', inv.radius]] as const) {
    const vals = Object.entries(bucket);
    const label = k === 'fontSize' ? 'font sizes' : 'radii';
    if (vals.length > (k === 'fontSize' ? 6 : 4)) for (const [v, d] of vals) if (d.n === 1) add(k === 'fontSize' ? 'one-off-font-size' : 'one-off-radius', 'info', null, `${v} is used once (${d.ex[0]}) among ${vals.length} distinct ${label}. Map it to the scale?`, { selector: d.ex[0] });
  }
  const sizeCount = Object.keys(inv.fontSize).length;
  if (sizeCount > 8) add('type-scale-sprawl', 'info', null, `${sizeCount} distinct font sizes. A screen usually needs 5-7 on one ratio.`);
  const leftEdges = [...edges.entries()].map(([x, v]) => ({ x, n: v.length })).filter(e => e.n >= 2).sort((a, b) => b.n - a.n);
  return { findings: out, allKeys: [...allKeys], perRule, inventory: inv, offGrid, leftEdges, accentHues, docH, docW, vw, vh, cls: win.__kraftaCLS || 0, shifts: (win.__kraftaShifts || []).slice(0, 8), darkCanvas };
}
