// Preisdaten für die App.
//
// Der Tages-Job auf dem Server legt die aktuellen Preise aller getrackten Karten in Firestore ab
// (cardPrices/{id}) und führt den Verlauf (cardHistory/{id}). Die App liest zuerst dort:
// das geht sofort und klappt auch, wenn der Render-Server gerade schläft.
// Nur Karten ohne (frischen) Eintrag werden beim Backend nachgefragt (/api/prices).
import { collection, doc, getDoc, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from './firebase';

const MAX_AGE_MS = 36 * 60 * 60 * 1000; // ältere Server-Einträge gelten als veraltet -> Backend fragen
const MEM_TTL_MS = 30 * 60 * 1000;
const mem = new Map(); // id -> { at, data|null }

const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Derselbe Preis wie überall in der App (Zielpreis, Watchlist): Trend normal, sonst Holo-Trend.
export const watchPrice = (prices) => {
  const p = prices || {};
  return p.trendPrice || p.averageSellPrice || p.trendPriceHolo || p.avg1Holo || 0;
};

// Aktuelle Preise (+ Vergleichswerte `past`) aus Firestore. Fehlende/veraltete Karten fehlen im Ergebnis.
export async function loadCardPrices(ids) {
  const out = {};
  const need = [];
  const now = Date.now();
  for (const id of ids) {
    const hit = mem.get(id);
    if (hit && now - hit.at < MEM_TTL_MS) { if (hit.data) out[id] = hit.data; } else need.push(id);
  }
  await Promise.all(chunks(need, 30).map(async (part) => {
    try {
      const snap = await getDocs(query(collection(db, 'cardPrices'), where(documentId(), 'in', part)));
      const found = new Set();
      snap.forEach((d) => {
        const v = d.data();
        if (v && v.prices && now - (v.updatedAt || 0) < MAX_AGE_MS) {
          out[d.id] = v; found.add(d.id);
          mem.set(d.id, { at: now, data: v });
        }
      });
      part.forEach((id) => { if (!found.has(id)) mem.set(id, { at: now, data: null }); });
    } catch (e) {
      // Regeln noch nicht freigegeben / offline -> das Backend übernimmt
      console.warn('cardPrices nicht lesbar:', e.code || e.message);
    }
  }));
  return out;
}

// Preise für beliebige Karten: erst Firestore (sofort), dann das Backend für den Rest.
// Rückgabe: { [id]: { prices, productId, priceSource, priceDate, past? } }
export async function fetchPrices(ids, apiUrl, { onProgress } = {}) {
  const prices = await loadCardPrices(ids);
  const rest = ids.filter((id) => !prices[id]);
  if (onProgress) onProgress(ids.length - rest.length, ids.length);
  for (let i = 0; i < rest.length; i += 40) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    const res = await fetch(`${apiUrl}/api/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ ids: rest.slice(i, i + 40) })
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Server antwortet mit Status ${res.status}`);
    const data = await res.json();
    Object.assign(prices, data.prices || {});
    if (onProgress) onProgress(Math.min(ids.length - rest.length + i + 40, ids.length), ids.length);
  }
  return prices;
}

// Verlauf einer Karte: [{ date, t (Trend normal), h (Trend Holo) }] aufsteigend nach Datum
export async function loadHistory(id) {
  const snap = await getDoc(doc(db, 'cardHistory', String(id)));
  const days = snap.exists() ? (snap.data().days || {}) : {};
  return Object.keys(days).sort().map((date) => ({ date, t: Number(days[date][0]) || 0, h: Number(days[date][1]) || 0 }));
}
