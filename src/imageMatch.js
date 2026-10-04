// Bildvergleich nach der Texterkennung: sortiert Suchtreffer nach Ähnlichkeit zum gescannten Foto.
// Verfahren: beide Bilder auf ein grobes Farbraster (6×8) verkleinern, Helligkeit/Weißabgleich pro
// Farbkanal normalisieren und die Raster vergleichen. Das ist bewusst einfach und läuft komplett im Browser.
// Es unterscheidet gut zwischen verschiedenen Drucken derselben Karte (andere Illustration/Farbgebung),
// ist aber kein Ersatz für die Kartennummer.
import { coverRect } from './scanParse';

const GW = 6;
const GH = 8;
const CELL = 4;
const MAX_DIST = 0.7; // Abstand, ab dem die Ähnlichkeit 0 % ist

function signature(source, w, h) {
  const c = document.createElement('canvas');
  c.width = GW * CELL;
  c.height = GH * CELL;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const r = coverRect(w, h);
  const mx = r.sw * 0.05;
  const my = r.sh * 0.04; // Kartenrand ignorieren
  ctx.drawImage(source, r.sx + mx, r.sy + my, r.sw - 2 * mx, r.sh - 2 * my, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;

  const cells = GW * GH;
  const sum = new Float64Array(cells * 3);
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      const ci = Math.floor(y / CELL) * GW + Math.floor(x / CELL);
      const i = (y * c.width + x) * 4;
      sum[ci * 3] += d[i];
      sum[ci * 3 + 1] += d[i + 1];
      sum[ci * 3 + 2] += d[i + 2];
    }
  }
  const px = CELL * CELL;
  const tot = [0, 0, 0];
  for (let k = 0; k < cells; k += 1) {
    for (let ch = 0; ch < 3; ch += 1) {
      sum[k * 3 + ch] /= px;
      tot[ch] += sum[k * 3 + ch];
    }
  }
  const mean = tot.map((t) => Math.max(8, t / cells));
  const sig = new Float32Array(cells * 3);
  for (let k = 0; k < cells; k += 1) {
    for (let ch = 0; ch < 3; ch += 1) sig[k * 3 + ch] = Math.min(3, sum[k * 3 + ch] / mean[ch]);
  }
  return sig;
}

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

// Bild laden: erst direkt (mit CORS), sonst über den Bild-Proxy des Backends
export function loadImg(api, src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const attempt = (url, next) => {
      const im = new Image();
      if (!url.startsWith('data:')) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => (next ? next() : resolve(null));
      im.src = url;
    };
    attempt(src, () => attempt(`${api}/api/img?u=${encodeURIComponent(src)}`, null));
  });
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const n = i; i += 1; out[n] = await fn(items[n]); }
  }));
  return out;
}

// scanCanvas: das gescannte Kartenbild (Canvas), cards: Suchtreffer.
// Rückgabe: { cards: nach Ähnlichkeit sortiert, scores: { [cardId]: Ähnlichkeit in % } }
export async function rankByImage(scanCanvas, cards, api, limit = 24) {
  const base = signature(scanCanvas, scanCanvas.width, scanCanvas.height);
  const head = cards.slice(0, limit);
  const dists = await pool(head, 6, async (card) => {
    const im = await loadImg(api, card.images && card.images.small);
    if (!im) return null;
    try { return distance(base, signature(im, im.naturalWidth, im.naturalHeight)); } catch (e) { return null; }
  });
  const order = head.map((card, i) => ({ card, i, d: dists[i] }));
  order.sort((a, b) => (a.d == null) - (b.d == null) || (a.d ?? 0) - (b.d ?? 0) || a.i - b.i);
  const scores = {};
  order.forEach((o) => {
    if (o.d != null) scores[o.card.id] = Math.max(0, Math.round((1 - o.d / MAX_DIST) * 100));
  });
  return { cards: [...order.map((o) => o.card), ...cards.slice(limit)], scores };
}
