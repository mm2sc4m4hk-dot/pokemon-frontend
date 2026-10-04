import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  collection as fsCollection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { ArtistView, PokedexView, BinderView, HBars, SORT_OPTIONS, sortCollection } from './Extras';
import { fetchPrices } from './priceData';
import { CardHistoryChart, WeeklyMovers, PushToggle } from './Insights';
import { CompletionPanel, BinderCompletion } from './Completion';
import CardScanner from './CardScanner';

// Verbindung zum Backend (nur für die Kartensuche über TCGdex, siehe server.js)
const API_URL = import.meta.env.VITE_API_URL || 'https://pokemon-backend-x7l7.onrender.com';

const LANGUAGES = [
  { name: 'Deutsch 🇩🇪', factor: 1.0 },
  { name: 'Englisch 🇬🇧', factor: 1.1 },
  { name: 'Japanisch 🇯🇵', factor: 0.8 },
  { name: 'Chinesisch 🇨🇳', factor: 0.65 },
  { name: 'Koreanisch 🇰🇷', factor: 0.5 },
  { name: 'Französisch 🇫🇷', factor: 0.9 },
  { name: 'Spanisch 🇪🇸', factor: 0.9 },
  { name: 'Italienisch 🇮🇹', factor: 0.9 }
];

const CONDITIONS = [
  { name: 'Mint', factor: 1.25, label: 'Mint (Makellos, +25%)' },
  { name: 'Near Mint', factor: 1.0, label: 'Near Mint (Standard)' },
  { name: 'Excellent', factor: 0.85, label: 'Excellent (-15%)' },
  { name: 'Good', factor: 0.70, label: 'Good (-30%)' },
  { name: 'Light Played', factor: 0.50, label: 'Light Played (-50%)' },
  { name: 'Played', factor: 0.35, label: 'Played (-65%)' },
  { name: 'Poor', factor: 0.15, label: 'Poor (Beschädigt, -85%)' }
];

const CHEAPEST_LANG = LANGUAGES.reduce((a, b) => (a.factor < b.factor ? a : b));
const PREMIUM_LANG = LANGUAGES.reduce((a, b) => (a.factor > b.factor ? a : b));

const VARIANTS = [
  { key: 'normal', label: 'Normal', holo: false },
  { key: 'reverse', label: 'Reverse Holo', holo: true },
  { key: 'holo', label: 'Holo', holo: true },
  { key: 'firstEdition', label: '1st Edition', holo: false }
];

const getAvailableVariants = (card) => {
  const flags = card?.variants;
  if (!flags) return [VARIANTS[0]];
  const available = VARIANTS.filter((v) => flags[v.key]);
  return available.length > 0 ? available : [VARIANTS[0]];
};

// Varianten für Hinzufügen/Bearbeiten: nur die laut Datenbank vorhandenen (eigene Karten: alle);
// eine bereits gespeicherte Variante bleibt immer wählbar.
const variantChoices = (card, current) => {
  const base = card?.isCustom ? VARIANTS : getAvailableVariants(card);
  if (!current || base.some((v) => v.key === current)) return base;
  const cur = VARIANTS.find((v) => v.key === current);
  return cur ? [...base, cur] : base;
};

const usernameToEmail = (username) => `${username.trim().toLowerCase()}@poketracker.local`;

const authErrorMessage = (code) => {
  switch (code) {
    case 'auth/email-already-in-use': return 'Dieser Benutzername ist bereits vergeben.';
    case 'auth/weak-password': return 'Passwort zu kurz (mindestens 6 Zeichen).';
    case 'auth/invalid-credential':
    case 'auth/wrong-password': return 'Falsches Passwort.';
    case 'auth/user-not-found': return 'Diesen Benutzer gibt es noch nicht. Bitte zuerst registrieren.';
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed': return 'E-Mail/Passwort-Anmeldung ist in Firebase noch nicht aktiviert.';
    case 'auth/too-many-requests': return 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.';
    case 'auth/network-request-failed': return 'Keine Verbindung zu Firebase. Internetverbindung prüfen.';
    default: return 'Etwas ist schiefgelaufen. Bitte erneut versuchen.';
  }
};

const qtyOf = (item) => Math.max(1, parseInt(item?.userQuantity, 10) || 1);
const parseQty = (v) => Math.max(1, parseInt(v, 10) || 1);
const parseMoney = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
};

const plainName = (item) => String(item?.name || '').replace(/\s*\[.*\]\s*$/, '');
const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const loadSetting = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; } };
const saveSetting = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* egal */ } };

// Der eine Preis einer Watchlist-Karte: Cardmarket-Trend (Normal), bei reinen Holo-Karten der Holo-Trend.
// Anzeige und Zielpreis-Alarm nutzen genau diesen Wert.
const watchPrice = (card) => {
  const p = card?.cardmarket?.prices || {};
  return p.trendPrice || p.averageSellPrice || p.trendPriceHolo || p.avg1Holo || 0;
};
const watchUsesHolo = (card) => {
  const p = card?.cardmarket?.prices || {};
  return !(p.trendPrice || p.averageSellPrice) && !!(p.trendPriceHolo || p.avg1Holo);
};

// Heutiges Datum (UTC, wie bei den bereits gespeicherten Snapshots) als "YYYY-MM-DD" (Dokument-ID der Wertverlauf-Snapshots)
const todayKey = () => new Date().toISOString().slice(0, 10);
const daysAgoKey = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// Preisobjekte vergleichen (Firestore sortiert die Schlüssel anders als das Backend)
const samePrices = (a = {}, b = {}) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((Number(a[k]) || 0) !== (Number(b[k]) || 0)) return false;
  return true;
};
const hasPrice = (p = {}) => (p.trendPrice || p.averageSellPrice || p.trendPriceHolo || 0) > 0;

// Watchlist: ist die Karte HEUTE günstiger geworden? Verglichen wird mit dem Preis vor der ersten
// Änderung des heutigen Tages (prevPrice/priceDay werden beim Preis-Update gespeichert).
const dropInfo = (card) => {
  const cur = watchPrice(card);
  const prev = Number(card?.prevPrice) || 0;
  if (!(cur > 0) || !(prev > 0) || card.priceDay !== todayKey()) return null;
  const diff = cur - prev;
  if (diff > -0.005) return null;
  const target = parseFloat(card.targetPrice) || 0;
  return { card, cur, prev, diff, pct: (diff / prev) * 100, target, targetDiff: target > 0 ? cur - target : null };
};

// Liniendiagramm für den Wertverlauf der Collection (reines SVG, keine Bibliothek).
function ValueChart({ points }) {
  const [range, setRange] = useState('all');
  if (points.length < 2) {
    return <p className="text-xs text-slate-500 text-center py-4">Der Verlauf entsteht, sobald an mindestens zwei verschiedenen Tagen ein Wert gespeichert wurde – einfach ab und zu die App öffnen.</p>;
  }
  const days = range === 'all' ? null : Number(range);
  let shown = days ? points.filter(p => p.date >= daysAgoKey(days)) : points;
  if (shown.length < 2) shown = points.slice(-2);

  const W = 300, H = 110, PX = 4, PY = 12;
  const vals = shown.map(p => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const xy = shown.map((p, i) => [
    PX + (i / (shown.length - 1)) * (W - 2 * PX),
    PY + (1 - (p.value - min) / span) * (H - 2 * PY)
  ]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${PX},${H - PY} ${line} ${xy[xy.length - 1][0].toFixed(1)},${H - PY}`;
  const first = shown[0], last = shown[shown.length - 1];
  const diff = last.value - first.value;
  const pct = first.value > 0 ? (diff / first.value) * 100 : 0;
  const fmtDate = (d) => { const [, m, dd] = d.split('-'); return `${dd}.${m}.`; };

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <div>
          <p className="text-2xl font-black text-cyan-300">{eur(last.value)}</p>
          <p className={`text-xs font-bold ${diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {diff >= 0 ? '+' : '−'}{eur(Math.abs(diff))} ({diff >= 0 ? '+' : '−'}{Math.abs(pct).toFixed(1).replace('.', ',')} %) seit {fmtDate(first.date)}
          </p>
        </div>
        <div className="flex gap-1">
          {[['7', '7 T'], ['30', '30 T'], ['all', 'Alles']].map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${range === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`}>{label}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-28 bg-slate-950 border border-slate-800 rounded-xl" role="img" aria-label="Wertverlauf der Collection">
        <polygon points={area} fill="rgb(34 211 238)" fillOpacity="0.12" />
        <polyline points={line} fill="none" stroke="rgb(34 211 238)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{fmtDate(first.date)}</span>
        <span>Tief {eur(min)} · Hoch {eur(max)}</span>
        <span>{fmtDate(last.date)}</span>
      </div>
    </div>
  );
}

function SellView({ items }) {
  const [feePct, setFeePct] = useState(() => loadSetting('sellFeePct', '5'));
  const [shipping, setShipping] = useState(() => loadSetting('sellShipping', '1.50'));
  const [withPrice, setWithPrice] = useState(true);
  const [copied, setCopied] = useState(false);
  useEffect(() => { saveSetting('sellFeePct', feePct); }, [feePct]);
  useEffect(() => { saveSetting('sellShipping', shipping); }, [shipping]);

  const fee = Math.min(100, Math.max(0, parseFloat(String(feePct).replace(',', '.')) || 0));
  const ship = Math.max(0, parseFloat(String(shipping).replace(',', '.')) || 0);
  const sorted = [...items].sort((a, b) => (a.set?.name || '').localeCompare(b.set?.name || '') || plainName(a).localeCompare(plainName(b)));

  const gross = sorted.reduce((sum, it) => sum + (parseFloat(it.userPrice) || 0) * qtyOf(it), 0);
  const feeAmount = gross * (fee / 100);
  const net = gross - feeAmount - (sorted.length ? ship : 0);

  const lines = sorted.map(it => {
    const variant = it.userVariant && it.userVariant !== 'normal' ? (VARIANTS.find(v => v.key === it.userVariant)?.label || it.userVariant) : '';
    const parts = [
      `${qtyOf(it)}x ${plainName(it)}`,
      it.set?.name || '',
      it.number ? `#${it.number}` : '',
      variant,
      it.userCondition || '',
      String(it.userLanguage || '').split(' ')[0]
    ].filter(Boolean);
    return parts.join(' | ') + (withPrice ? ` | ${eur(parseFloat(it.userPrice) || 0)}` : '');
  });
  const text = lines.join('\n') + (withPrice && lines.length ? `\n\nSumme: ${eur(gross)} (Richtpreise)` : '');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (err) { /* ignorieren */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (items.length === 0) {
    return <div className="text-center py-20 text-slate-500">Noch keine Karte zum Verkauf markiert.<br /><span className="text-xs">In „Karten“ bei einer Karte auf „🏷️ Tausch/Verkauf“ tippen.</span></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-cyan-500/30 p-4 rounded-xl shadow-md space-y-3">
        <h3 className="font-bold text-slate-100 text-sm">Was bleibt nach dem Verkauf?</h3>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400">Gebühr in %</label>
            <input type="number" min="0" max="100" step="0.1" value={feePct} onChange={e => setFeePct(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
          </div>
          <div>
            <label className="text-xs text-slate-400">Versand (gesamt) €</label>
            <input type="number" min="0" step="0.01" value={shipping} onChange={e => setShipping(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
          </div>
        </div>
        <p className="text-[10px] text-slate-500">Beispielwerte, bitte an deine echten Cardmarket-Gebühren und dein Porto anpassen.</p>
        <div className="text-sm space-y-1 pt-2 border-t border-slate-800">
          <div className="flex justify-between"><span className="text-slate-400">Verkaufswert</span><span className="text-slate-200">{eur(gross)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Gebühr ({fee}%)</span><span className="text-rose-400">−{eur(feeAmount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Versand</span><span className="text-rose-400">−{eur(ship)}</span></div>
          <div className="flex justify-between pt-1 border-t border-slate-800"><span className="font-bold text-slate-200">Bleibt dir</span><span className={`font-black ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{eur(net)}</span></div>
        </div>
      </div>

      <div className="space-y-2">
        {sorted.map(it => {
          const price = parseFloat(it.userPrice) || 0;
          return (
            <div key={it.docId} className="bg-slate-900 border border-slate-800 rounded-lg p-2 flex justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-slate-200 truncate">{qtyOf(it)}x {plainName(it)}</p>
                <p className="text-slate-500 truncate">{it.set?.name || 'Unbekanntes Set'} · {it.userCondition} · {String(it.userLanguage || '').split(' ')[0]}</p>
              </div>
              <div className="text-right whitespace-nowrap">
                <p className="text-cyan-400 font-bold">{eur(price * qtyOf(it))}</p>
                <p className="text-slate-500">netto {eur(price * qtyOf(it) * (1 - fee / 100))}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-md space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-slate-100 text-sm">Textliste zum Kopieren</h3>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={withPrice} onChange={e => setWithPrice(e.target.checked)} className="accent-cyan-500" /> mit Preisen
          </label>
        </div>
        <textarea readOnly value={text} rows={Math.min(14, lines.length + 3)} className="w-full bg-slate-950 border border-slate-800 text-slate-300 rounded-lg p-2 text-xs font-mono outline-none" />
        <button onClick={copy} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-2.5 rounded-xl font-black text-sm transition-colors">{copied ? 'Kopiert ✓' : 'Liste kopieren'}</button>
      </div>
    </div>
  );
}

const setIdOf = (item) => {
  if (item?.set?.id) return item.set.id;
  const id = String(item?.id || '');
  if (!id || id.startsWith('custom-') || id.startsWith('cm-')) return null;
  const i = id.lastIndexOf('-');
  return i > 0 ? id.slice(0, i) : null;
};

function SetsView({ collection, watchIds }) {
  const [open, setOpen] = useState(null);
  const [cache, setCache] = useState({});
  const [noSecret, setNoSecret] = useState({}); // Set-ID -> Secret Rares aus der Kostenrechnung lassen

  const groups = new Map();
  let withoutSet = 0;
  collection.forEach(item => {
    const sid = setIdOf(item);
    if (!sid) { withoutSet += 1; return; }
    const g = groups.get(sid) || { id: sid, name: item.set?.name || sid, total: item.set?.total || null, ids: new Set() };
    g.ids.add(item.id);
    groups.set(sid, g);
  });
  const list = [...groups.values()].sort((a, b) => {
    const pa = a.total ? a.ids.size / a.total : 0; const pb = b.total ? b.ids.size / b.total : 0;
    return pb - pa || a.name.localeCompare(b.name);
  });

  const toggle = async (g) => {
    if (open === g.id) { setOpen(null); return; }
    setOpen(g.id);
    if (cache[g.id]?.cards) return;
    setCache(c => ({ ...c, [g.id]: { loading: true } }));
    try {
      const res = await fetch(`${API_URL}/api/sets/${encodeURIComponent(g.id)}`);
      if (!res.ok) throw new Error('Set nicht gefunden');
      const data = await res.json();
      setCache(c => ({ ...c, [g.id]: { cards: data.cards || [] } }));
    } catch (e) {
      setCache(c => ({ ...c, [g.id]: { error: e.message || 'Fehler beim Laden' } }));
    }
  };

  if (list.length === 0) {
    return <div className="text-center py-20 text-slate-500">Noch keine Karten mit Set-Zuordnung in deiner Collection.</div>;
  }

  return (
    <div className="space-y-3">
      {list.map(g => {
        const owned = g.ids.size;
        const pct = g.total ? Math.min(100, Math.round((owned / g.total) * 100)) : 0;
        const c = cache[g.id];
        const missing = c?.cards ? c.cards.filter(card => !g.ids.has(card.id)) : [];
        // Secret Rares = Kartennummer größer als die offizielle Set-Größe (nur rein numerische Nummern)
        const isSecret = (card) => !!g.total && /^\d+$/.test(String(card.localId)) && parseInt(card.localId, 10) > g.total;
        const hideSecret = !!noSecret[g.id];
        const costCards = (hideSecret ? missing.filter(card => !isSecret(card)) : missing)
          .map(card => ({ id: card.id, name: card.name, image: card.image, localId: card.localId, setName: g.name }));
        return (
          <div key={g.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md">
            <button onClick={() => toggle(g)} className="w-full text-left">
              <div className="flex justify-between items-baseline gap-2">
                <span className="font-bold text-sm text-slate-200 truncate">{g.name}</span>
                <span className="text-xs text-cyan-400 font-bold whitespace-nowrap">{owned}{g.total ? ` / ${g.total}` : ''}{g.total ? ` (${pct}%)` : ''}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </button>
            {open === g.id && (
              <div className="mt-3 pt-3 border-t border-slate-800">
                {c?.loading && <p className="text-xs text-cyan-400">Lade Kartenliste…</p>}
                {c?.error && <p className="text-xs text-rose-400">{c.error}</p>}
                {c?.cards && (missing.length === 0
                  ? <p className="text-xs text-emerald-400">Komplett – dir fehlt keine Karte dieses Sets. 🎉</p>
                  : <>
                      <p className="text-[10px] text-slate-500 mb-2">Fehlend: {missing.length} (inkl. Secret Rares)</p>
                      <CompletionPanel
                        title="💶 Was kostet es, dieses Set zu komplettieren?"
                        cards={costCards}
                        api={API_URL}
                        uid={auth.currentUser?.uid}
                        watchIds={watchIds}
                        Img={CardImage}
                      />
                      {g.total ? (
                        <label className="flex items-center gap-2 text-[11px] text-slate-400 mb-3">
                          <input type="checkbox" checked={hideSecret} onChange={e => setNoSecret(s => ({ ...s, [g.id]: e.target.checked }))} className="accent-cyan-500" />
                          Secret Rares (Nr. über {g.total}) nicht mitrechnen
                        </label>
                      ) : null}
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {missing.map(card => (
                          <div key={card.id} className="text-center">
                            <CardImage src={card.image} alt={card.name} className="w-full rounded-md opacity-70" />
                            <p className="text-[10px] text-slate-400 mt-1 truncate">#{card.localId} {card.name}</p>
                          </div>
                        ))}
                      </div>
                    </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {withoutSet > 0 && <p className="text-[10px] text-slate-500 text-center">{withoutSet} Karten ohne Set-Zuordnung sind hier nicht enthalten.</p>}
    </div>
  );
}

function CardTitle({ card, size = 'sm', truncate = true }) {
  const isCm = card.source === 'cardmarket';
  const m = isCm ? String(card.name).match(/^([^\[]*?)\s*\[(.*)\]\s*$/) : null;
  const title = m ? m[1] : card.name;
  const attacks = m ? m[2] : null;
  const cls = size === 'lg' ? 'font-bold text-lg text-slate-100' : 'font-bold text-sm text-slate-200';
  return (
    <div>
      <h3 className={`${cls} ${truncate ? 'truncate' : ''}`}>
        {title}
        {card.number ? <span className="text-slate-500 font-normal"> #{card.number}{card.set?.total ? `/${card.set.total}` : ''}</span> : null}
      </h3>
      {attacks && <p className={`text-[10px] text-slate-500 ${truncate ? 'truncate' : ''}`} title={attacks}>{attacks}</p>}
      {isCm && (
        <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
          Cardmarket
        </span>
      )}
    </div>
  );
}

function englishImageUrl(url) {
  if (!url || !url.includes('assets.tcgdex.net/')) return null;
  const swapped = url.replace(/assets\.tcgdex\.net\/(?!en\/)[a-z-]+\//, 'assets.tcgdex.net/en/');
  return swapped !== url ? swapped : null;
}

function CardImage({ src, alt, className, onClick }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const [enFailed, setEnFailed] = useState(false);

  useEffect(() => { setFailedSrc(null); setEnFailed(false); }, [src]);

  const en = englishImageUrl(src);
  let shown = src;
  if (failedSrc === src) shown = en && !enFailed ? en : null;

  if (!shown) {
    return (
      <div
        onClick={onClick}
        className={`${className} bg-slate-800 border border-slate-700 flex flex-col items-center justify-center text-center p-2 aspect-[5/7] ${onClick ? 'cursor-pointer' : ''}`}
      >
        <span className="text-2xl mb-1">🃏</span>
        <span className="text-[10px] text-slate-500 line-clamp-2">{alt || 'Kein Bild'}</span>
      </div>
    );
  }
  return (
    <img
      onClick={onClick}
      src={shown}
      alt={alt}
      loading="lazy"
      onError={() => { if (failedSrc === src) setEnFailed(true); else setFailedSrc(src); }}
      className={className}
    />
  );
}

function resizeImageFile(file, maxWidth = 500, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  // --- AUTH (Firebase) ---
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [activeTab, setActiveTab] = useState('profile');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSet, setSearchSet] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchSelections, setSearchSelections] = useState({});

  const [collection, setCollection] = useState([]);
  const [watchlist, setWatchlist] = useState([]);

  const [selectedCard, setSelectedCard] = useState(null);
  const [modalType, setModalType] = useState(null);

  // Schnell-Erfassung: Zuletzt gewählte Werte im localStorage speichern
  const [cardCondition, setCardCondition] = useState(() => loadSetting('lastCondition', '') || 'Near Mint');
  const [cardLanguage, setCardLanguage] = useState(() => loadSetting('lastLang', '') || 'Deutsch 🇩🇪');
  const [cardVariant, setCardVariant] = useState('normal');
  const [detailVariant, setDetailVariant] = useState('normal');
  const [customPrice, setCustomPrice] = useState('');
  const [customImage, setCustomImage] = useState('');

  const [moveFromWatchlistId, setMoveFromWatchlistId] = useState(null);
  const [removeFromWatchlistAfter, setRemoveFromWatchlistAfter] = useState(true);
  const [editOriginalPrice, setEditOriginalPrice] = useState('');

  const [customCardOpen, setCustomCardOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNumber, setCustomNumber] = useState('');
  const [customSetName, setCustomSetName] = useState('');

  const [cardQuantity, setCardQuantity] = useState('1');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [collectionView, setCollectionView] = useState('cards');

  const [filterLang, setFilterLang] = useState('Alle');
  const [filterSet, setFilterSet] = useState('Alle');
  const [sortBy, setSortBy] = useState('name-asc');
  const [collectionSearch, setCollectionSearch] = useState('');

  // Toast-Feedback
  const [toastMsg, setToastMsg] = useState('');

  // Karten-Scanner: null | 'search' | 'collection'
  const [scanOpen, setScanOpen] = useState(null);
  const [scanSeries, setScanSeries] = useState(() => loadSetting('scanSeries', '0') === '1');
  const scanFlowRef = useRef(false); // true, wenn das Hinzufügen-Fenster aus dem Scanner kam

  const unsubscribers = useRef([]);

  // Preis-Aktualisierung & Wertverlauf
  const [collectionReady, setCollectionReady] = useState(false);
  const [watchlistReady, setWatchlistReady] = useState(false);
  const [snapshots, setSnapshots] = useState([]); // [{ date, value, ... }] aufsteigend nach Datum
  const [snapshotsReady, setSnapshotsReady] = useState(false);
  const [snapshotsDenied, setSnapshotsDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const autoRefreshed = useRef(false);
  const refreshRef = useRef(null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaMsg, setMetaMsg] = useState('');
  const metaTried = useRef(false);

  useEffect(() => { if (modalType === 'collection') { setCardQuantity('1'); setPurchasePrice(''); } }, [modalType]);
  useEffect(() => { if (customCardOpen) { setCardQuantity('1'); setPurchasePrice(''); } }, [customCardOpen]);

  // Ping: hält das Render-Backend wach (Gratisplan schläft nach ~15 Min. ohne Anfrage ein).
  // Läuft beim Start (weckt den Server schon während man sich einloggt) und danach alle 9 Minuten,
  // solange die App im Vordergrund geöffnet ist.
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === 'hidden') return;
      fetch(`${API_URL}/api/health`, { cache: 'no-store' }).catch(() => {});
    };
    ping();
    const timer = setInterval(ping, 9 * 60 * 1000);
    document.addEventListener('visibilitychange', ping);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', ping); };
  }, []);

  useEffect(() => {
    setDetailVariant(selectedCard?.userVariant || 'normal');
  }, [selectedCard]);

  // Toast Auto-Clear
  useEffect(() => {
    if (toastMsg) {
      const timer = setTimeout(() => setToastMsg(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMsg]);

  // Klick auf eine Push-Nachricht: Kaltstart über ?tab=watchlist, offene App über Nachricht vom Service Worker
  useEffect(() => {
    const allowed = ['watchlist', 'profile', 'collection'];
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (allowed.includes(fromUrl)) setActiveTab(fromUrl);
    if (!('serviceWorker' in navigator)) return undefined;
    const onMsg = (e) => {
      if (e.data?.type !== 'open-tab') return;
      const t = new URL(e.data.url || '/', window.location.origin).searchParams.get('tab');
      if (allowed.includes(t)) setActiveTab(t);
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, []);

  // Firebase Auth & Firestore Listener
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubscribers.current.forEach((u) => u());
      unsubscribers.current = [];

      if (user) {
        setIsAuthenticated(true);
        setCurrentUser(user.displayName || user.email?.split('@')[0] || 'Trainer');

        setCollectionReady(false);
        setWatchlistReady(false);
        setSnapshotsReady(false);
        setSnapshotsDenied(false);
        autoRefreshed.current = false;
        setLastRefreshAt(Number(loadSetting('lastPriceRefresh:' + user.uid, '0')) || null);

        const collRef = fsCollection(db, 'users', user.uid, 'collection');
        const unsubColl = onSnapshot(collRef, (snap) => {
          setCollection(snap.docs.map((d) => ({ ...d.data(), docId: d.id, instanceId: d.id })));
          setCollectionReady(true);
        });

        const watchRef = fsCollection(db, 'users', user.uid, 'watchlist');
        const unsubWatch = onSnapshot(watchRef, (snap) => {
          setWatchlist(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
          setWatchlistReady(true);
        });

        // Täglicher Wert-Snapshot der Collection (Dokument-ID = Datum)
        const snapRef = fsCollection(db, 'users', user.uid, 'snapshots');
        const unsubSnap = onSnapshot(snapRef, (snap) => {
          setSnapshots(
            snap.docs.map((d) => d.data())
              .filter((s) => s.date && Number.isFinite(s.value))
              .sort((a, b) => a.date.localeCompare(b.date))
          );
          setSnapshotsDenied(false);
          setSnapshotsReady(true);
        }, (err) => {
          console.warn('Wertverlauf nicht lesbar (Firestore-Regeln?):', err.code);
          setSnapshotsDenied(true);
          setSnapshotsReady(true);
        });

        unsubscribers.current.push(unsubColl, unsubWatch, unsubSnap);
      } else {
        setIsAuthenticated(false);
        setCurrentUser('');
        setCollection([]);
        setWatchlist([]);
        setSnapshots([]);
        setCollectionReady(false);
        setWatchlistReady(false);
        setSnapshotsReady(false);
        setLastRefreshAt(null);
        setRefreshMsg('');
        autoRefreshed.current = false;
        metaTried.current = false;
        setMetaMsg('');
      }
      setAuthLoading(false);
    });

    return () => {
      unsubAuth();
      unsubscribers.current.forEach((u) => u());
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const uname = authUsername.trim();
    if (!uname || !authPassword) {
      setAuthError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    setAuthBusy(true);
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(uname), authPassword);
      setActiveTab('profile');
    } catch (err) {
      console.error('Firebase Auth Fehler:', err.code, err.message);
      setAuthError(authErrorMessage(err.code));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError('');
    const uname = authUsername.trim();
    if (!uname || !authPassword || !authPasswordConfirm) {
      setAuthError('Bitte alle Felder ausfüllen.');
      return;
    }
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(uname)) {
      setAuthError('Benutzername: 3–30 Zeichen, nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich.');
      return;
    }
    if (authPassword !== authPasswordConfirm) {
      setAuthError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setAuthBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(uname), authPassword);
      await updateProfile(cred.user, { displayName: uname });
      setActiveTab('profile');
    } catch (err) {
      console.error('Firebase Auth Fehler:', err.code, err.message);
      setAuthError(authErrorMessage(err.code));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    setAuthError('');
    setAuthPassword('');
    setAuthPasswordConfirm('');
  };

  const calculatePrice = (card, conditionName, langName, variantKey = 'normal') => {
    if (!card) return "0.00";
    const isHolo = VARIANTS.find(v => v.key === variantKey)?.holo;
    const prices = card.cardmarket?.prices || {};
    const basePrice = isHolo
      ? (prices.trendPriceHolo || prices.avg1Holo || 0)
      : (prices.trendPrice || prices.averageSellPrice || 0);
    const condFactor = CONDITIONS.find(c => c.name === conditionName)?.factor || 1.0;
    const langFactor = LANGUAGES.find(l => l.name === langName)?.factor || 1.0;
    return (basePrice * condFactor * langFactor).toFixed(2);
  };

  const getTrendIcon = (card, variantKey = 'normal') => {
    if (!card) return null;
    const isHolo = VARIANTS.find(v => v.key === variantKey)?.holo;
    const prices = card.cardmarket?.prices || {};
    const current = (isHolo ? prices.trendPriceHolo : prices.trendPrice) || 0;
    const avg30 = (isHolo ? prices.avg30Holo : prices.avg30) || current;
    const threshold = Math.max(0.05, avg30 * 0.03);
    if (current > avg30 + threshold) return <span className="text-emerald-400 font-bold" title="Preis steigt">▲</span>;
    if (current < avg30 - threshold) return <span className="text-rose-400 font-bold" title="Preis sinkt">▼</span>;
    return <span className="text-slate-400 font-bold" title="Preis stabil">=</span>;
  };

  const getPriceHistoryBars = (card, variantKey = 'normal') => {
    const isHolo = VARIANTS.find(v => v.key === variantKey)?.holo;
    const prices = card?.cardmarket?.prices || {};
    const points = isHolo
      ? [
          { label: '30 T', value: prices.avg30Holo || 0 },
          { label: '7 T', value: prices.avg7Holo || 0 },
          { label: 'Heute', value: prices.trendPriceHolo || prices.avg1Holo || 0 }
        ]
      : [
          { label: '30 T', value: prices.avg30 || 0 },
          { label: '7 T', value: prices.avg7 || 0 },
          { label: 'Heute', value: prices.trendPrice || prices.avg1 || 0 }
        ];
    const max = Math.max(...points.map(p => p.value), 0.01);
    return points.map(p => ({ ...p, pct: Math.max(8, Math.round((p.value / max) * 100)) }));
  };

  const handleSearch = async (e, override) => {
    if (e && e.preventDefault) e.preventDefault();
    const queryText = typeof override === 'string' ? override : searchQuery;
    if (!queryText.trim()) return -1;
    setLoading(true);
    setSearchError('');
    try {
      const params = new URLSearchParams({ name: queryText });
      if (searchSet.trim()) params.set('set', searchSet.trim());

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      const res = await fetch(`${API_URL}/api/cards?${params.toString()}`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        setSearchResults([]);
        setSearchError('Zu viele Anfragen an die Kartendatenbank gerade. Bitte kurz warten.');
        return -1;
      }
      if (!res.ok) throw new Error('API antwortet nicht');
      const data = await res.json();

      if (!Array.isArray(data)) {
        setSearchResults([]);
        setSearchError('Keine Karten gefunden.');
        return 0;
      } else if (data.length === 0) {
        setSearchResults([]);
        setSearchError('Keine Karten mit diesem Namen/Nummer gefunden.');
        return 0;
      } else {
        setSearchResults(data);
        return data.length;
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setSearchError('Server-Zeitüberschreitung. Render-Backend wacht evtl. gerade auf.');
      } else {
        setSearchError('Verbindungsfehler zum Backend.');
      }
      return -1;
    } finally {
      setLoading(false);
    }
  };

  const getSearchSelection = (cardId) =>
    searchSelections[cardId] || { condition: cardCondition, language: cardLanguage, variant: 'normal' };

  const updateSearchSelection = (cardId, patch) => {
    setSearchSelections(prev => ({
      ...prev,
      [cardId]: { ...getSearchSelection(cardId), ...patch }
    }));
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImageFile(file);
      setCustomImage(resized);
    } catch (err) {
      alert('Foto konnte nicht gelesen werden.');
    }
  };

  const addToCollection = async () => {
    if (!auth.currentUser) return;
    const calculatedVal = calculatePrice(selectedCard, cardCondition, cardLanguage, cardVariant);
    const newItem = {
      ...selectedCard,
      userCondition: cardCondition,
      userLanguage: cardLanguage,
      userVariant: cardVariant,
      userPrice: customPrice ? parseFloat(customPrice).toFixed(2) : calculatedVal,
      userQuantity: parseQty(cardQuantity),
      userPurchasePrice: parseMoney(purchasePrice),
      customImage: customImage || null,
      addedAt: Date.now()
    };
    delete newItem.docId;
    delete newItem.instanceId;
    try {
      await addDoc(fsCollection(db, 'users', auth.currentUser.uid, 'collection'), newItem);
      
      // Zustand & Sprache für die Schnell-Erfassung merken
      saveSetting('lastCondition', cardCondition);
      saveSetting('lastLang', cardLanguage);

      if (moveFromWatchlistId && removeFromWatchlistAfter) {
        await removeFromWatchlist(moveFromWatchlistId);
      }
      setModalType(null);
      setMoveFromWatchlistId(null);
      setCustomPrice('');
      setCustomImage('');
      setCardVariant('normal');
      setToastMsg('Karte zur Collection hinzugefügt! ✓');
      const scanAgain = scanFlowRef.current && scanSeries && activeTab === 'collection';
      scanFlowRef.current = false;
      if (scanAgain) setTimeout(() => setScanOpen('collection'), 400);
    } catch (err) {
      alert('Speichern fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  // Ist der gespeicherte Preis automatisch berechnet (und nicht vom Nutzer selbst
  // eingetragen)? Nur dann darf die Aktualisierung ihn überschreiben.
  const isAutoPrice = (item) => {
    if (item.isCustom) return false;
    const calc = parseFloat(calculatePrice(item, item.userCondition, item.userLanguage, item.userVariant || 'normal'));
    return Math.abs(calc - (parseFloat(item.userPrice) || 0)) < 0.011;
  };

  // Holt aktuelle Cardmarket-Preise für alle Karten der Collection und Watchlist
  // und schreibt sie per Batch nach Firestore. Selbst eingetragene Preise bleiben
  // unverändert (nur die Cardmarket-Daten dahinter werden aufgefrischt).
  const refreshPrices = async ({ silent = false } = {}) => {
    if (!auth.currentUser || refreshing) return;
    const uid = auth.currentUser.uid;
    const ids = [...new Set([...collection, ...watchlist]
      .map((c) => c.id)
      .filter((id) => id && !String(id).startsWith('custom-')))];
    if (ids.length === 0) {
      if (!silent) setRefreshMsg('Keine Karten zum Aktualisieren vorhanden.');
      return;
    }

    setRefreshing(true);
    setRefreshMsg('Aktualisiere Preise … (der Server braucht nach Inaktivität evtl. bis zu einer Minute)');
    try {
      // Erst die vom Server-Job vorbereiteten Preise aus Firestore (sofort, auch wenn der Render-Server
      // schläft); nur Karten ohne frischen Eintrag gehen ans Backend.
      const fresh = await fetchPrices(ids, API_URL, {
        onProgress: (done, total) => setRefreshMsg(`Aktualisiere … ${done} / ${total}`)
      });

      let batch = writeBatch(db);
      let ops = 0, changedColl = 0, changedWatch = 0, keptManual = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = writeBatch(db); ops = 0; } };
      const merged = (item, f) => ({
        ...(item.cardmarket || {}),
        prices: f.prices,
        ...(f.productId ? { productId: f.productId } : {}),
        priceSource: f.priceSource || 'tcgdex',
        ...(f.priceDate ? { priceDate: f.priceDate } : {})
      });

      for (const item of collection) {
        const f = fresh[item.id];
        if (!f?.prices || !item.docId) continue;
        // Keine guten alten Preise mit einer leeren Antwort überschreiben
        if (!hasPrice(f.prices) && hasPrice(item.cardmarket?.prices)) continue;
        const auto = isAutoPrice(item);
        const cardmarket = merged(item, f);
        const newPrice = auto
          ? calculatePrice({ ...item, cardmarket }, item.userCondition, item.userLanguage, item.userVariant || 'normal')
          : item.userPrice;
        if (!auto) keptManual += 1;
        if (samePrices(f.prices, item.cardmarket?.prices) && String(newPrice) === String(item.userPrice)) continue;
        batch.update(doc(db, 'users', uid, 'collection', item.docId), { cardmarket, userPrice: newPrice, priceUpdatedAt: Date.now() });
        ops += 1; changedColl += 1;
        if (ops >= 400) await flush();
      }

      for (const card of watchlist) {
        const f = fresh[card.id];
        if (!f?.prices) continue;
        if (!hasPrice(f.prices) && hasPrice(card.cardmarket?.prices)) continue;
        if (samePrices(f.prices, card.cardmarket?.prices)) continue;
        const upd = { cardmarket: merged(card, f), priceUpdatedAt: Date.now() };
        // Preis vor der ersten Änderung des heutigen Tages merken -> „Heute günstiger geworden“
        const today = todayKey();
        if (card.priceDay !== today) {
          const before = watchPrice(card);
          upd.prevPrice = before > 0 ? before : null;
          upd.priceDay = today;
        }
        batch.update(doc(db, 'users', uid, 'watchlist', card.id), upd);
        ops += 1; changedWatch += 1;
        if (ops >= 400) await flush();
      }
      await flush();

      const now = Date.now();
      saveSetting('lastPriceRefresh:' + uid, String(now));
      setLastRefreshAt(now);
      if (!silent) setToastMsg('Preise aktualisiert ✓');
      const parts = [`${changedColl} Collection-Karten`, `${changedWatch} Watchlist-Karten`];
      setRefreshMsg(
        changedColl + changedWatch === 0
          ? 'Alle Preise sind bereits aktuell. ✓'
          : `Aktualisiert: ${parts.join(', ')}. ✓` + (keptManual ? ` ${keptManual} Karten mit eigenem Preis blieben unverändert.` : '')
      );
    } catch (err) {
      console.error('Preis-Refresh fehlgeschlagen:', err);
      if (!silent) {
        setRefreshMsg(err.name === 'AbortError'
          ? 'Der Server hat zu lange nicht geantwortet (Render-Gratisplan schläft nach Inaktivität ein). Bitte in ca. 1 Minute nochmal versuchen.'
          : 'Aktualisierung fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
      } else {
        setRefreshMsg('');
      }
    } finally {
      setRefreshing(false);
    }
  };
  refreshRef.current = refreshPrices;

  const openEditCard = (item) => {
    setSelectedCard(item);
    setCardCondition(item.userCondition || 'Near Mint');
    setCardLanguage(item.userLanguage || 'Deutsch 🇩🇪');
    setCardVariant(item.userVariant || 'normal');
    setCustomPrice(item.userPrice ? String(item.userPrice) : '');
    setEditOriginalPrice(item.userPrice ? String(item.userPrice) : '');
    setCustomImage(item.customImage || '');
    setCardQuantity(String(qtyOf(item)));
    setPurchasePrice(item.userPurchasePrice ? String(item.userPurchasePrice) : '');
    setMoveFromWatchlistId(null);
    setModalType('edit');
  };

  const saveEdit = async () => {
    if (!auth.currentUser || !selectedCard?.docId) return;
    const priceTouched = customPrice !== editOriginalPrice && customPrice !== '';
    let price;
    if (priceTouched) price = parseFloat(customPrice).toFixed(2);
    else if (selectedCard.isCustom) price = selectedCard.userPrice || '0.00';
    else price = calculatePrice(selectedCard, cardCondition, cardLanguage, cardVariant);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'collection', selectedCard.docId), {
        userCondition: cardCondition,
        userLanguage: cardLanguage,
        userVariant: cardVariant,
        userPrice: price,
        userQuantity: parseQty(cardQuantity),
        userPurchasePrice: parseMoney(purchasePrice),
        customImage: customImage || null
      });
      setModalType(null);
      setCustomPrice('');
      setCustomImage('');
      setEditOriginalPrice('');
      setCardVariant('normal');
      setToastMsg('Änderungen gespeichert! ✓');
    } catch (err) {
      alert('Änderung fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const closeCustomCard = () => {
    setCustomCardOpen(false);
    setCustomName(''); setCustomNumber(''); setCustomSetName('');
    setCustomPrice(''); setCustomImage('');
  };

  const saveCustomCard = async () => {
    if (!auth.currentUser) return;
    if (!customName.trim()) {
      alert('Bitte einen Kartennamen eintragen.');
      return;
    }
    const price = customPrice ? parseFloat(customPrice).toFixed(2) : '0.00';
    const newItem = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      number: customNumber.trim() || null,
      images: { small: '', large: '' },
      set: { name: customSetName.trim() || null, total: null },
      variants: null,
      cardmarket: { url: '', prices: {} },
      isCustom: true,
      userCondition: cardCondition,
      userLanguage: cardLanguage,
      userVariant: cardVariant,
      userPrice: price,
      userQuantity: parseQty(cardQuantity),
      userPurchasePrice: parseMoney(purchasePrice),
      customImage: customImage || null,
      addedAt: Date.now()
    };
    try {
      await addDoc(fsCollection(db, 'users', auth.currentUser.uid, 'collection'), newItem);
      closeCustomCard();
      setCardVariant('normal');
      setToastMsg('Eigene Karte gespeichert! ✓');
    } catch (err) {
      alert('Speichern fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const toggleForSale = async (item) => {
    if (!auth.currentUser || !item.docId) return;
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'collection', item.docId), { forSale: !item.forSale });
    } catch (err) {
      alert('Änderung fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const removeFromCollection = async (docId) => {
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'collection', docId));
      setToastMsg('Karte aus Collection entfernt.');
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const addToWatchlistCard = async (card) => {
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'users', auth.currentUser.uid, 'watchlist', card.id), { ...card, addedAt: Date.now() });
      setToastMsg('Zur Watchlist hinzugefügt! ★');
    } catch (err) {
      alert('Fehler beim Hinzufügen zur Watchlist.');
    }
  };

  const removeFromWatchlist = async (cardId) => {
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'watchlist', cardId));
    } catch (err) {
      alert('Entfernen fehlgeschlagen.');
    }
  };

  const updateTargetPrice = async (cardId, price) => {
    if (!auth.currentUser) return;
    try {
      const cleanPrice = parseMoney(price);
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'watchlist', cardId), {
        targetPrice: cleanPrice ? parseFloat(cleanPrice) : null
      });
      setToastMsg('Zielpreis gespeichert! 🎯');
    } catch (err) {
      console.error('Fehler beim Aktualisieren des Zielpreises:', err);
    }
  };

  const watchlistIds = new Set(watchlist.map((c) => c.id));
  const toggleWatchlist = (card) => {
    if (watchlistIds.has(card.id)) removeFromWatchlist(card.id);
    else addToWatchlistCard(card);
  };

  // Karte aus Artist-/Pokédex-/Binder-Ansicht auf die Watchlist: erst die vollständigen
  // Daten (inkl. Cardmarket-Preis) vom Backend holen, dann wie gewohnt speichern.
  const addBriefToWatchlist = async (brief) => {
    if (!brief?.id || watchlistIds.has(brief.id)) return;
    if (brief.cardmarket) { await addToWatchlistCard(brief); return; }
    try {
      const res = await fetch(`${API_URL}/api/card/${encodeURIComponent(brief.id)}`);
      if (!res.ok) throw new Error('Status ' + res.status);
      await addToWatchlistCard(await res.json());
    } catch (err) {
      alert('Karte konnte nicht geladen werden. Läuft der Server?');
    }
  };

  // Kurzform einer Karte (aus Artist-/Binder-Ansicht) -> vollständige Karte inkl. Cardmarket-Preisen
  const loadFullCard = async (brief) => {
    if (brief.cardmarket) return brief;
    if (String(brief.id).startsWith('cm-')) {
      // Treffer, die nur aus der Cardmarket-Datei stammen: Preise über den Preis-Endpunkt holen
      const res = await fetch(`${API_URL}/api/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [brief.id] })
      });
      if (!res.ok) throw new Error('Status ' + res.status);
      const f = (await res.json())?.prices?.[brief.id];
      return {
        ...brief,
        images: brief.images || { small: brief.image || '' },
        set: brief.set || { name: brief.setName || '' },
        number: brief.number ?? brief.localId ?? null,
        cardmarket: f ? { prices: f.prices, productId: f.productId ?? null, priceSource: f.priceSource ?? null, priceDate: f.priceDate ?? null } : { url: '', prices: {} }
      };
    }
    const res = await fetch(`${API_URL}/api/card/${encodeURIComponent(brief.id)}`);
    if (!res.ok) throw new Error('Status ' + res.status);
    return res.json();
  };

  // Öffnet das normale Hinzufügen-Fenster (Zustand, Sprache, Variante, Preis, eigenes Foto ...).
  // Steht die Karte auf der Watchlist, wird sie danach (abwählbar) von dort entfernt.
  const beginAddToCollection = (card) => {
    setSelectedCard(card);
    setCardCondition(loadSetting('lastCondition', '') || 'Near Mint');
    setCardLanguage(loadSetting('lastLang', '') || 'Deutsch 🇩🇪');
    setCardVariant(getAvailableVariants(card)[0].key);
    setCustomImage(card.customImage || ''); // Foto aus dem Binder-Slot vorbelegen
    if (watchlistIds.has(card.id)) {
      setMoveFromWatchlistId(card.id);
      setRemoveFromWatchlistAfter(true);
    } else {
      setMoveFromWatchlistId(null);
    }
    setModalType('collection');
  };

  // Karte aus Artist-/Binder-Ansicht direkt in die Collection
  const addBriefToCollection = async (brief) => {
    if (!brief?.id) return;
    try {
      const full = await loadFullCard(brief);
      beginAddToCollection(brief.customImage ? { ...full, customImage: brief.customImage } : full);
    } catch (err) {
      alert('Karte konnte nicht geladen werden. Läuft der Server?');
    }
  };

  // Karte aus dem Binder (z. B. ausgegrauter „fehlt“-Slot) anzeigen wie beim Anklicken in der Collection:
  // vollständige Daten + Cardmarket-Preise holen und das Detail-Fenster mit Preisverlauf öffnen.
  const openCardDetail = async (brief) => {
    if (!brief?.id) return;
    try {
      const full = await loadFullCard(brief);
      setSelectedCard(brief.customImage ? { ...full, customImage: brief.customImage } : full);
      setMoveFromWatchlistId(null);
      setModalType('detail');
    } catch (err) {
      alert('Karte konnte nicht geladen werden. Läuft der Server?');
    }
  };

  // --- Karten-Scanner ---
  // Suchen-Tab: erkannten Text in die Suche übernehmen und sofort suchen
  // (findet die Nummer nichts, wird nur nach dem Namen gesucht).
  const handleScanForSearch = async ({ query, name, number }) => {
    setScanOpen(null);
    setSearchQuery(query);
    setToastMsg('Gescannt: ' + query);
    const n = await handleSearch(null, query);
    if (n === 0 && number && name) {
      setSearchQuery(name);
      handleSearch(null, name);
    }
  };

  // Collection-Tab: Suche für die Trefferliste im Scanner
  const scanSearch = async (q) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch(`${API_URL}/api/cards?${new URLSearchParams({ name: q }).toString()}`, { signal: controller.signal });
      if (res.status === 429) throw new Error('Zu viele Anfragen, bitte kurz warten.');
      if (!res.ok) throw new Error(`Server antwortet mit Status ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } finally {
      clearTimeout(timer);
    }
  };

  // Treffer im Scanner angetippt -> normales Hinzufügen-Fenster (Zustand, Sprache, Variante ...)
  const handleScanPick = (card) => {
    setScanOpen(null);
    beginAddToCollection(card);
    scanFlowRef.current = true;
  };

  // Ältere Collection-Karten kennen ihre Pokédex-Nummer und ihren Artist noch nicht -> einmal nachladen
  const needsMeta = collection.filter((c) => c.id && c.dexId === undefined
    && !String(c.id).startsWith('custom-') && !String(c.id).startsWith('cm-'));

  const backfillMeta = async () => {
    if (!auth.currentUser || metaBusy || needsMeta.length === 0) return;
    const uid = auth.currentUser.uid;
    const todo = needsMeta;
    setMetaBusy(true);
    try {
      const ids = [...new Set(todo.map((c) => c.id))];
      const meta = {};
      for (let i = 0; i < ids.length; i += 40) {
        setMetaMsg(`Lade Karten-Daten … ${Math.min(i + 40, ids.length)} / ${ids.length}`);
        const res = await fetch(`${API_URL}/api/card-meta`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ids.slice(i, i + 40) })
        });
        if (!res.ok) throw new Error(`Server antwortet mit Status ${res.status}`);
        Object.assign(meta, (await res.json()).meta || {});
      }
      let batch = writeBatch(db);
      let ops = 0;
      for (const item of todo) {
        const m = meta[item.id];
        if (!m || !item.docId) continue;
        batch.update(doc(db, 'users', uid, 'collection', item.docId), { dexId: m.dexId || [], illustrator: m.illustrator || null });
        ops += 1;
        if (ops >= 400) { await batch.commit(); batch = writeBatch(db); ops = 0; }
      }
      if (ops > 0) await batch.commit();
      setMetaMsg('Pokédex- und Artist-Daten sind aktuell. ✓');
    } catch (err) {
      console.error('Karten-Daten nachladen fehlgeschlagen:', err);
      setMetaMsg('Nachladen fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    } finally {
      setMetaBusy(false);
    }
  };

  const formatAdded = (ts) => ts
    ? new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const stats = useMemo(() => {
    if (collection.length === 0) return { min: '0.00', median: '0.00', max: '0.00' };
    let total = 0, totalMin = 0, totalMax = 0;
    collection.forEach(item => {
      const price = (parseFloat(item.userPrice) || 0) * qtyOf(item);
      total += price;
      totalMin += price * 0.85;
      totalMax += price * 1.25;
    });
    return { min: totalMin.toFixed(2), median: total.toFixed(2), max: totalMax.toFixed(2) };
  }, [collection]);

  const totalPieces = collection.reduce((sum, item) => sum + qtyOf(item), 0);
  const invest = useMemo(() => {
    let cost = 0, value = 0, n = 0;
    collection.forEach(item => {
      const buy = parseFloat(item.userPurchasePrice);
      if (!Number.isFinite(buy)) return;
      const q = qtyOf(item);
      cost += buy * q;
      value += (parseFloat(item.userPrice) || 0) * q;
      n += 1;
    });
    return { cost, value, profit: value - cost, n };
  }, [collection]);

  const fmtSigned = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)} €`;

  const filteredCollection = useMemo(() => {
    let list = [...collection];
    const q = collectionSearch.trim().toLowerCase();
    if (q) list = list.filter(i => (i.name || '').toLowerCase().includes(q));
    if (filterLang !== 'Alle') list = list.filter(i => i.userLanguage === filterLang);
    if (filterSet !== 'Alle') list = list.filter(i => i.set?.name === filterSet);

    sortCollection(list, sortBy);
    return list;
  }, [collection, collectionSearch, filterLang, filterSet, sortBy]);

  const availableSets = ['Alle', ...new Set(collection.map(item => item.set?.name).filter(Boolean))];

  // Watchlist: gleiche Regel wie in der Karten-Anzeige (Trend <= Zielpreis)
  const isDealCard = (card) => {
    const target = parseFloat(card.targetPrice) || 0;
    const currentTrend = watchPrice(card);
    return target > 0 && currentTrend > 0 && currentTrend <= target;
  };
  const dealCount = watchlist.filter(isDealCard).length;
  const todaysDrops = useMemo(
    () => watchlist.map(dropInfo).filter(Boolean).sort((a, b) => a.pct - b.pct),
    [watchlist]
  );
  const hasPriceHistory = watchlist.some((c) => c.priceDay);

  // Diagramme im Profil: Top 10 teuerste Karten und Wert pro Set
  const topCards = useMemo(() => [...collection]
    .sort((a, b) => (parseFloat(b.userPrice) || 0) - (parseFloat(a.userPrice) || 0))
    .slice(0, 10)
    .map((c, i) => ({
      key: c.docId || i,
      label: `${i + 1}. ${plainName(c)}`,
      value: parseFloat(c.userPrice) || 0,
      sub: [c.set?.name, qtyOf(c) > 1 ? `×${qtyOf(c)}` : null].filter(Boolean).join(' · ')
    })), [collection]);

  const setValues = useMemo(() => {
    const m = new Map();
    collection.forEach((c) => {
      const name = c.set?.name || 'Ohne Set';
      const g = m.get(name) || { value: 0, cards: 0 };
      g.value += (parseFloat(c.userPrice) || 0) * qtyOf(c);
      g.cards += qtyOf(c);
      m.set(name, g);
    });
    const rows = [...m.entries()]
      .map(([name, g]) => ({ key: name, label: name, value: g.value, sub: `${g.cards} Karten` }))
      .sort((a, b) => b.value - a.value);
    const top = rows.slice(0, 10);
    const rest = rows.slice(10).reduce((sum, r) => sum + r.value, 0);
    if (rest > 0) top.push({ key: '__rest', label: `Weitere ${rows.length - 10} Sets`, value: rest });
    return top;
  }, [collection]);

  // Einmal pro Sitzung automatisch Preise auffrischen (höchstens alle 12 Stunden)
  useEffect(() => {
    if (!isAuthenticated || !collectionReady || !watchlistReady || autoRefreshed.current) return;
    autoRefreshed.current = true;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const last = Number(loadSetting('lastPriceRefresh:' + uid, '0')) || 0;
    if (Date.now() - last < 12 * 60 * 60 * 1000) return;
    setTimeout(() => { refreshRef.current && refreshRef.current({ silent: true }); }, 1500);
  }, [isAuthenticated, collectionReady, watchlistReady]);

  // Täglichen Wert-Snapshot speichern bzw. den heutigen aktualisieren, wenn sich der Wert ändert
  useEffect(() => {
    if (!isAuthenticated || !collectionReady || !snapshotsReady || snapshotsDenied || collection.length === 0) return;
    const date = todayKey();
    const value = Math.round(parseFloat(stats.median) * 100) / 100;
    const existing = snapshots.find((s) => s.date === date);
    if (existing && Math.abs(existing.value - value) < 0.005 && existing.pieces === totalPieces) return;
    const t = setTimeout(() => {
      if (!auth.currentUser) return;
      setDoc(doc(db, 'users', auth.currentUser.uid, 'snapshots', date), {
        date, ts: Date.now(), value, pieces: totalPieces, cards: collection.length, cost: Math.round(invest.cost * 100) / 100
      }).catch((err) => {
        console.warn('Snapshot speichern fehlgeschlagen:', err.code || err.message);
        if (err.code === 'permission-denied') setSnapshotsDenied(true);
      });
    }, 2500);
    return () => clearTimeout(t);
  }, [isAuthenticated, collectionReady, snapshotsReady, snapshotsDenied, stats.median, totalPieces, collection.length, snapshots]);

  // Beim Öffnen von Binder / Pokédex / Artist fehlende Pokédex-/Artist-Daten einmal automatisch nachladen
  useEffect(() => {
    if (!isAuthenticated || !collectionReady || activeTab !== 'collection') return;
    if (!['binder', 'dex', 'artist'].includes(collectionView)) return;
    if (metaTried.current || metaBusy || needsMeta.length === 0) return;
    metaTried.current = true;
    backfillMeta();
  }, [isAuthenticated, collectionReady, activeTab, collectionView, needsMeta.length]);

  const extraProps = {
    api: API_URL,
    collection,
    watchIds: watchlistIds,
    onWish: addBriefToWatchlist,
    onAddColl: addBriefToCollection,
    onOpenCard: openCardDetail,
    Img: CardImage,
    meta: { needsMeta: needsMeta.length, busy: metaBusy, msg: metaMsg, onBackfill: backfillMeta }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Lädt...
      </div>
    );
  }

  if (!isAuthenticated) {
    const isRegister = authMode === 'register';
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-slate-100">
        <div className="bg-slate-900 border border-cyan-500/30 p-8 rounded-2xl w-full max-w-md shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-teal-400 tracking-wider mb-2">PokéTracker</h1>
            <p className="text-slate-400 text-sm">Verwalte deine Sammlung & Werte</p>
          </div>

          <h2 className="text-xl font-bold text-slate-200 mb-4">{isRegister ? 'Sign up' : 'Login'}</h2>

          <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-4">
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Benutzername</label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={e => setAuthUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all"
                placeholder="Dein Benutzername"
              />
            </div>
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Passwort</label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all"
                placeholder="••••••••"
              />
            </div>
            {isRegister && (
              <div>
                <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Passwort bestätigen</label>
                <input
                  type="password"
                  required
                  value={authPasswordConfirm}
                  onChange={e => setAuthPasswordConfirm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all"
                  placeholder="••••••••"
                />
              </div>
            )}

            {authError && <p className="text-rose-400 text-sm text-center">{authError}</p>}

            <button type="submit" disabled={authBusy} className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black text-lg py-3 rounded-xl transition-all shadow-lg mt-4">
              {authBusy ? 'Bitte warten...' : isRegister ? 'Account erstellen' : 'Anmelden'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-400">
            {isRegister ? (
              <p>Bereits einen Account? <button onClick={() => switchAuthMode('login')} className="text-cyan-400 font-bold hover:underline">Hier anmelden</button></p>
            ) : (
              <p>Noch keinen Account? <button onClick={() => switchAuthMode('register')} className="text-cyan-400 font-bold hover:underline">Hier registrieren</button></p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 font-sans">
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-500 text-slate-950 font-bold text-xs px-4 py-2.5 rounded-xl shadow-xl transition-all animate-bounce">
          {toastMsg}
        </div>
      )}

      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-cyan-500/20 px-4 py-3 flex items-center justify-between shadow-md">
        <span className="text-cyan-400 text-xl font-black tracking-wider">⚡ PokéTracker</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 hidden sm:inline">{currentUser}</span>
          <button onClick={handleLogout} className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-rose-400 transition-colors">Abmelden</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'profile' && (
          <div className="space-y-6 fade-in">
            {dealCount > 0 && (
              <button onClick={() => setActiveTab('watchlist')} className="w-full text-left bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-3 text-sm text-emerald-300 hover:bg-emerald-500/20 transition-colors">
                🎯 {dealCount === 1 ? '1 Karte auf deiner Watchlist hat' : `${dealCount} Karten auf deiner Watchlist haben`} ihren Zielpreis erreicht – zur Watchlist
              </button>
            )}
            <div className="bg-slate-900 border border-cyan-500/30 p-6 rounded-2xl shadow-xl">
              <h2 className="text-xl font-black text-white mb-1">Willkommen zurück, {currentUser || 'Trainer'}</h2>
              <p className="text-slate-400 text-sm mb-6">Wert deiner Collection</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                <div className="order-first sm:order-none col-span-2 sm:col-span-1 min-w-0 bg-slate-950 border border-cyan-500/50 p-4 rounded-xl shadow-lg sm:scale-105 z-10 flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-cyan-400 font-black uppercase tracking-widest">Medianwert</p>
                  <p className="text-2xl font-black text-cyan-300 mt-1 break-words">{stats.median} €</p>
                </div>
                <div className="sm:order-first min-w-0 bg-slate-950 border border-slate-800 p-3 sm:p-4 rounded-xl flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider">Minimalwert</p>
                  <p className="text-base sm:text-lg font-bold text-slate-300 mt-1 break-words">{stats.min} €</p>
                </div>
                <div className="min-w-0 bg-slate-950 border border-slate-800 p-3 sm:p-4 rounded-xl flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider">Maximalwert</p>
                  <p className="text-base sm:text-lg font-bold text-emerald-400 mt-1 break-words">{stats.max} €</p>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 flex justify-between text-sm">
                <span className="text-slate-400">Anzahl Karten:</span>
                <span className="font-bold text-cyan-400">{totalPieces} Stück{totalPieces !== collection.length ? ` (${collection.length} verschiedene)` : ''}</span>
              </div>
              {invest.n > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Investiert ({invest.n} Karten):</span><span className="font-bold text-slate-200">{invest.cost.toFixed(2)} €</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Aktueller Wert:</span><span className="font-bold text-slate-200">{invest.value.toFixed(2)} €</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Gewinn / Verlust:</span><span className={`font-black ${invest.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtSigned(invest.profit)}</span></div>
                </div>
              )}
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-slate-400">Karten auf der Watchlist:</span>
                <span className="font-bold text-cyan-400">{watchlist.length} Stück</span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
              <h3 className="font-bold text-slate-100 text-sm mb-3">Wertverlauf deiner Collection</h3>
              {snapshotsDenied ? (
                <p className="text-xs text-amber-300">Der Verlauf kann nicht gespeichert werden. Bitte in der Firebase Console die Firestore-Regeln für {'users/{uid}/snapshots'} freigeben.</p>
              ) : (
                <ValueChart points={snapshots.map((s) => ({ date: s.date, value: s.value }))} />
              )}
            </div>

            {collection.length > 0 && <WeeklyMovers collection={collection} />}

            {collection.length > 0 && (
              <>
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
                  <h3 className="font-bold text-slate-100 text-sm mb-3">🏆 Top 10 – wertvollste Karten</h3>
                  <HBars rows={topCards} />
                </div>
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl">
                  <h3 className="font-bold text-slate-100 text-sm mb-3">📦 Wert pro Set</h3>
                  <HBars rows={setValues} />
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'collection' && (
          <div className="space-y-4 fade-in">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {[['cards', '🎴 Karten'], ['binder', '📒 Binder'], ['sets', '📊 Sets'], ['dex', '📖 Pokédex'], ['artist', '🎨 Artist'], ['sell', `🏷️ Verkauf (${collection.filter(i => i.forSale).length})`]].map(([key, label]) => (
                <button key={key} onClick={() => setCollectionView(key)} className={`flex-1 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${collectionView === key ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'}`}>{label}</button>
              ))}
            </div>
            <button onClick={() => setScanOpen('collection')} className="w-full bg-slate-900 border border-cyan-500/30 text-cyan-300 text-sm font-black py-3 rounded-xl hover:bg-slate-800 transition-colors shadow-md">📷 Karte scannen &amp; hinzufügen</button>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 shadow-md">
              <button onClick={() => refreshPrices()} disabled={refreshing} className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-black px-3 py-2 rounded-lg transition-colors whitespace-nowrap">
                {refreshing ? '⏳ Lädt …' : '🔄 Preise aktualisieren'}
              </button>
              <p className="text-[10px] text-slate-400 flex-1">
                {refreshMsg || (lastRefreshAt ? `Zuletzt aktualisiert: ${formatAdded(lastRefreshAt)}` : 'Preise wurden noch nicht aktualisiert.')}
              </p>
            </div>

            <div className={`bg-slate-900 border border-slate-800 p-3 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-2 shadow-md ${collectionView !== 'cards' ? 'hidden' : ''}`}>
              <div className="relative col-span-2 md:col-span-4">
                <input
                  type="text"
                  value={collectionSearch}
                  onChange={e => setCollectionSearch(e.target.value)}
                  placeholder="In der Collection suchen, z.B. Glumanda"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 text-sm text-slate-200 rounded-lg pl-3 pr-9 py-2 outline-none"
                />
                {collectionSearch && (
                  <button onClick={() => setCollectionSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 text-sm px-1">✕</button>
                )}
              </div>
              <select value={filterLang} onChange={e => setFilterLang(e.target.value)} className="bg-slate-950 text-xs border border-slate-800 rounded-lg p-2 text-slate-300">
                <option value="Alle">Alle Sprachen</option>
                {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
              <select value={filterSet} onChange={e => setFilterSet(e.target.value)} className="bg-slate-950 text-xs border border-slate-800 rounded-lg p-2 text-slate-300">
                {availableSets.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-slate-950 text-xs border border-slate-800 rounded-lg p-2 text-slate-300 md:col-span-2">
                {SORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>

            {collectionView === 'sets' ? (
              <SetsView collection={collection} watchIds={watchlistIds} />
            ) : collectionView === 'binder' ? (
              <>
                <BinderCompletion uid={auth.currentUser?.uid} collection={collection} watchIds={watchlistIds} api={API_URL} Img={CardImage} />
                <BinderView {...extraProps} />
              </>
            ) : collectionView === 'dex' ? (
              <PokedexView {...extraProps} />
            ) : collectionView === 'artist' ? (
              <ArtistView {...extraProps} />
            ) : collectionView === 'sell' ? (
              <SellView items={collection.filter(i => i.forSale)} />
            ) : filteredCollection.length === 0 ? (
              <div className="text-center py-20 text-slate-500">Keine Karten gefunden.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filteredCollection.map((item) => (
                  <div key={item.docId} className="bg-slate-900 border border-slate-800 rounded-xl p-3 relative group shadow-lg">
                    <button onClick={() => openEditCard(item)} title="Bearbeiten" className="absolute top-2 left-2 bg-slate-950/80 text-cyan-400 w-6 h-6 rounded-full text-xs font-bold z-10 border border-cyan-500/30 hover:bg-cyan-500 hover:text-slate-950 transition">✎</button>
                    <button onClick={() => removeFromCollection(item.docId)} className="absolute top-2 right-2 bg-slate-950/80 text-rose-400 w-6 h-6 rounded-full text-xs font-bold z-10 border border-rose-500/30 hover:bg-rose-500 hover:text-white transition">✕</button>
                    <CardImage onClick={() => { setSelectedCard(item); setModalType('detail'); }} src={item.customImage || item.images?.small} alt={item.name} className="w-full rounded-lg mb-2 cursor-pointer hover:scale-105 transition-transform" />
                    <CardTitle card={item} />
                    <p className="text-xs text-slate-400 truncate">{item.set?.name || 'Unbekanntes Set'} • {String(item.userLanguage || '').split(' ')[0]}</p>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-cyan-400 font-bold">{item.userPrice} €</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] bg-slate-800 px-1 rounded text-slate-300">{item.userCondition}</span>
                        {item.userVariant && item.userVariant !== 'normal' && (
                          <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1 rounded">{VARIANTS.find(v => v.key === item.userVariant)?.label || item.userVariant}</span>
                        )}
                        {getTrendIcon(item, item.userVariant)}
                      </div>
                    </div>
                    {qtyOf(item) > 1 && (
                      <p className="text-[11px] text-slate-300 mt-1">×{qtyOf(item)} · zusammen {((parseFloat(item.userPrice) || 0) * qtyOf(item)).toFixed(2)} €</p>
                    )}
                    {Number.isFinite(parseFloat(item.userPurchasePrice)) && (() => {
                      const diff = ((parseFloat(item.userPrice) || 0) - parseFloat(item.userPurchasePrice)) * qtyOf(item);
                      return (
                        <p className="text-[11px] mt-1 text-slate-400">
                          Kauf {parseFloat(item.userPurchasePrice).toFixed(2)} € · <span className={diff >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{fmtSigned(diff)}</span>
                        </p>
                      );
                    })()}
                    <button
                      onClick={() => toggleForSale(item)}
                      className={`mt-2 w-full text-[11px] font-bold py-1 rounded-md border transition-colors ${item.forSale ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-950 text-slate-500 border-slate-800 hover:text-slate-300'}`}
                    >
                      🏷️ Tausch/Verkauf {item.forSale ? '✓' : ''}
                    </button>
                    {item.addedAt && <p className="text-[10px] text-slate-500 mt-1">Hinzugefügt: {formatAdded(item.addedAt)}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'watchlist' && (
          <div className="space-y-4 fade-in">
            <PushToggle apiUrl={API_URL} />
            {todaysDrops.length > 0 && (
              <div className="bg-emerald-500/5 border border-emerald-500/40 rounded-xl p-3 space-y-2 shadow-lg">
                <h3 className="text-sm font-black text-emerald-300">📉 Heute günstiger geworden ({todaysDrops.length})</h3>
                <div className="space-y-2">
                  {todaysDrops.map((d) => (
                    <button
                      key={d.card.id}
                      onClick={() => { setSelectedCard(d.card); setModalType('detail'); }}
                      className="w-full text-left flex items-center gap-3 bg-slate-950 border border-slate-800 hover:border-emerald-500/50 rounded-lg p-2 transition-colors"
                    >
                      <CardImage src={d.card.images?.small} alt={d.card.name} className="w-10 rounded" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-100 truncate">{plainName(d.card)}</p>
                        <p className="text-[10px] text-slate-500 truncate">{d.card.set?.name || 'Unbekannt'}</p>
                        <p className="text-[11px] text-emerald-400 font-bold">{fmtSigned(d.diff)} zum Vortag (−{Math.abs(d.pct).toFixed(1).replace('.', ',')} %)</p>
                        {d.target > 0 ? (
                          <p className={`text-[11px] font-bold ${d.targetDiff <= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                            {d.targetDiff <= 0
                              ? `🎯 ${Math.abs(d.targetDiff).toFixed(2)} € unter dem Zielpreis (${eur(d.target)})`
                              : `noch ${d.targetDiff.toFixed(2)} € über dem Zielpreis (${eur(d.target)})`}
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-500">Kein Zielpreis gesetzt</p>
                        )}
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <p className="text-sm font-black text-cyan-300">{eur(d.cur)}</p>
                        <p className="text-[10px] text-slate-500 line-through">{eur(d.prev)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {todaysDrops.length === 0 && watchlist.length > 0 && !hasPriceHistory && (
              <p className="text-[11px] text-slate-500 text-center">Der Vergleich „Heute günstiger geworden“ startet mit dem nächsten Preis-Update, bei dem sich ein Preis ändert (Cardmarket aktualisiert einmal täglich).</p>
            )}
            {watchlist.length === 0 ? (
              <div className="text-center py-20 text-slate-500">Deine Watchlist ist leer.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...watchlist].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map((card) => {
                  const target = parseFloat(card.targetPrice) || 0;
                  const currentTrend = watchPrice(card);
                  const isDeal = target > 0 && currentTrend > 0 && currentTrend <= target;

                  return (
                    <div key={card.id} className={`bg-slate-900 border ${isDeal ? 'border-emerald-500 shadow-lg shadow-emerald-500/10' : 'border-slate-800 hover:border-cyan-500/50'} rounded-xl p-3 flex gap-4 items-center shadow-lg transition-colors`}>
                      <CardImage onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small} alt={card.name} className="w-16 rounded-md cursor-pointer hover:opacity-80" />
                      <div className="flex-1">
                        <CardTitle card={card} truncate={false} />
                        <p className="text-xs text-slate-400">{card.set?.name || 'Unbekannt'}</p>
                        
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] text-slate-400">Zielpreis:</span>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00 €"
                            defaultValue={card.targetPrice || ''}
                            onBlur={(e) => updateTargetPrice(card.id, e.target.value)}
                            className="w-20 bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1 outline-none focus:border-cyan-500"
                          />
                          <span className="text-xs text-slate-400">€</span>
                          {isDeal && (
                            <span className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded-md animate-pulse">
                              🎯 KAUFEN!
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-sm font-bold text-cyan-400">{eur(currentTrend)}</p>
                          <span className="text-[10px] text-slate-500">Cardmarket-Trend{watchUsesHolo(card) ? ' (Holo)' : ''}</span>
                          {getTrendIcon(card, watchUsesHolo(card) ? 'holo' : 'normal')}
                        </div>
                      </div>
                      <div className="flex flex-col items-stretch gap-2">
                        <button
                          onClick={() => {
                            setSelectedCard(card);
                            setCardCondition(loadSetting('lastCondition', '') || 'Near Mint');
                            setCardLanguage(loadSetting('lastLang', '') || 'Deutsch 🇩🇪');
                            setCardVariant(getAvailableVariants(card)[0].key);
                            setMoveFromWatchlistId(card.id);
                            setRemoveFromWatchlistAfter(true);
                            setModalType('collection');
                          }}
                          title="In die Collection übernehmen"
                          className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500 hover:text-slate-900 text-xs font-bold px-3 py-2 rounded-lg border border-cyan-500/30 transition-colors"
                        >
                          ➕ Coll
                        </button>
                        <button onClick={() => removeFromWatchlist(card.id)} className="text-slate-500 hover:text-rose-400 text-sm font-bold">✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="space-y-6 fade-in">
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Name oder Name + Nummer, z.B. Glumanda 044" className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none" />
              <input type="text" value={searchSet} onChange={e => setSearchSet(e.target.value)} placeholder="Set (optional)" className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none" />
              <button type="button" onClick={() => setScanOpen('search')} title="Karte mit der Kamera scannen" className="bg-slate-900 border border-cyan-500/40 text-cyan-300 font-bold px-4 py-3 rounded-xl hover:bg-slate-800 transition-colors">📷 Scannen</button>
              <button type="submit" disabled={loading} className="bg-cyan-500 text-slate-950 font-bold px-6 py-3 rounded-xl hover:bg-cyan-400 disabled:opacity-50 transition-colors">
                {loading ? 'Sucht...' : 'Suche'}
              </button>
            </form>

            {/* VISUELLER LADEBALKEN WÄHREND DER SUCHE */}
            {loading && (
              <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-xl space-y-3">
                <div className="flex items-center justify-between text-xs text-cyan-400 font-bold">
                  <span className="flex items-center gap-2">
                    <span className="animate-spin text-base">⚡</span>
                    Durchsuche Kartendatenbank & Cardmarket...
                  </span>
                  <span className="animate-pulse text-[10px] text-slate-400">Bitte warten</span>
                </div>
                
                {/* Ladebalken Container */}
                <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800 p-0.5">
                  <div className="bg-gradient-to-r from-cyan-500 via-teal-400 to-cyan-500 h-full rounded-full animate-pulse w-full"></div>
                </div>

                <p className="text-[11px] text-slate-500 text-center">
                  Falls der Server schläft (Render-Gratisplan), kann der erste Aufruf bis zu 30–45 Sekunden dauern.
                </p>
              </div>
            )}

            {searchError && <div className="text-center text-rose-400 py-10">{searchError}</div>}

            <div className="text-center">
              <button onClick={() => setCustomCardOpen(true)} className="text-xs text-cyan-400 hover:underline">
                Karte nicht gefunden? Eigene Karte anlegen
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.isArray(searchResults) && searchResults.map((card) => {
                const sel = getSearchSelection(card.id);
                const livePrice = calculatePrice(card, sel.condition, sel.language, sel.variant);
                const variantOptions = getAvailableVariants(card);
                return (
                  <div key={card.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col relative group shadow-lg">
                    <CardImage onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small} alt={card.name} className="w-full rounded-lg mb-2 cursor-pointer hover:scale-105 transition-transform" />
                    <CardTitle card={card} />
                    <p className="text-xs text-slate-400 truncate">{card.set?.name || 'Unbekannt'}</p>

                    <div className="flex flex-wrap gap-1 mt-2">
                      <select value={sel.condition} onChange={e => updateSearchSelection(card.id, { condition: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                        {CONDITIONS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <select value={sel.language} onChange={e => updateSearchSelection(card.id, { language: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                        {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name.split(' ')[0]}</option>)}
                      </select>
                      {variantOptions.length > 1 && (
                        <select value={sel.variant} onChange={e => updateSearchSelection(card.id, { variant: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                          {variantOptions.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                        </select>
                      )}
                    </div>

                    <div className="mt-auto pt-2 flex items-center justify-between gap-1">
                      <p className="text-cyan-400 font-bold text-xs">~{livePrice} €</p>
                      {card.cardmarket?.url && (
                        <a href={card.cardmarket.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[10px] text-slate-500 hover:text-cyan-400 underline shrink-0">Cardmarket ↗</a>
                      )}
                    </div>
                    <div className="flex gap-1 mt-3">
                      <button
                        onClick={() => {
                          setSelectedCard(card);
                          setCardCondition(sel.condition);
                          setCardLanguage(sel.language);
                          setCardVariant(sel.variant);
                          setModalType('collection');
                        }}
                        className="flex-1 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500 hover:text-slate-900 text-xs font-bold py-2 rounded-lg border border-cyan-500/30 transition-colors"
                      >
                        ➕ Coll
                      </button>
                      {(() => {
                        const inWatchlist = watchlistIds.has(card.id);
                        return (
                          <button
                            onClick={() => toggleWatchlist(card)}
                            aria-pressed={inWatchlist}
                            title={inWatchlist ? 'Von der Watchlist entfernen' : 'Zur Watchlist hinzufügen'}
                            className={`text-xs px-3 rounded-lg border transition-colors ${inWatchlist ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/30' : 'bg-slate-800 text-slate-300 hover:text-cyan-400 border-slate-700'}`}
                          >
                            ★
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-cyan-500/20 px-6 py-2 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'profile' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg">👤</span><span>Profil</span></button>
          <button onClick={() => setActiveTab('collection')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'collection' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg">🎴</span><span>Collection</span></button>
          <button onClick={() => setActiveTab('watchlist')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'watchlist' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg relative">★{dealCount > 0 && <span className="absolute -top-1 -right-3 bg-emerald-500 text-slate-950 text-[9px] font-black rounded-full px-1 leading-4">{dealCount}</span>}</span><span>Watchlist</span></button>
          <button onClick={() => setActiveTab('search')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'search' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg">🔍</span><span>Suchen</span></button>
        </div>
      </nav>

      {scanOpen && (
        <CardScanner
          mode={scanOpen}
          onClose={() => setScanOpen(null)}
          onResult={handleScanForSearch}
          onSearch={scanSearch}
          onPick={handleScanPick}
          Img={CardImage}
          series={scanSeries}
          onSeriesChange={(v) => { setScanSeries(v); saveSetting('scanSeries', v ? '1' : '0'); }}
        />
      )}

      {modalType && selectedCard && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-sm w-full p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex gap-4 mb-4">
              <CardImage src={selectedCard.customImage || selectedCard.images?.small} alt={selectedCard.name} className="w-24 rounded-lg shadow-lg" />
              <div>
                <CardTitle card={selectedCard} size="lg" truncate={false} />
                <p className="text-sm text-slate-400">{selectedCard.set?.name || 'Unbekannt'}</p>
                <div className="mt-2 text-xs text-slate-300">Trend (Basis): <span className="text-cyan-400 font-bold">{selectedCard.cardmarket?.prices?.trendPrice || 0} €</span></div>
                {selectedCard.cardmarket?.url && (
                  <a href={selectedCard.cardmarket.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline mt-1 inline-block">Cardmarket ↗</a>
                )}
              </div>
            </div>

            {modalType === 'detail' && (
              <div className="space-y-4 mb-4 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-cyan-400">Preisverlauf</h4>
                  {getTrendIcon(selectedCard, detailVariant)}
                </div>
                {getAvailableVariants(selectedCard).length > 1 && (
                  <div className="flex gap-1">
                    {getAvailableVariants(selectedCard).map(v => (
                      <button
                        key={v.key}
                        onClick={() => setDetailVariant(v.key)}
                        className={`flex-1 text-[10px] font-bold py-1.5 rounded-lg border transition-colors ${detailVariant === v.key ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'}`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const bars = getPriceHistoryBars(selectedCard, detailVariant);
                  const hasData = bars.some(b => b.value > 0);
                  if (!hasData) {
                    return <p className="text-xs text-slate-500 text-center py-6">Keine Preisdaten von Cardmarket verfügbar.</p>;
                  }
                  return (
                    <div className="flex items-end gap-2 h-24 bg-slate-950 p-3 rounded-xl border border-slate-800">
                      {bars.map((b, idx) => (
                        <div key={b.label} className="flex-1 flex flex-col items-center justify-end gap-1">
                          <span className="text-[10px] text-slate-400">{b.value.toFixed(2)}€</span>
                          <div className={`w-full rounded-t-sm ${idx === bars.length - 1 ? 'bg-cyan-400' : idx === bars.length - 2 ? 'bg-cyan-800' : 'bg-slate-700'}`} style={{ height: `${b.pct}%` }}></div>
                          <span className={`text-[10px] ${idx === bars.length - 1 ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>{b.label}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {selectedCard.id && !String(selectedCard.id).startsWith('custom-') && (
                  <div className="pt-1">
                    <p className="text-[11px] text-slate-400 mb-1">Kurve seit Tracking-Start</p>
                    <CardHistoryChart cardId={selectedCard.id} holo={!!VARIANTS.find(v => v.key === detailVariant)?.holo} />
                  </div>
                )}
              </div>
            )}

            {(modalType === 'collection' || modalType === 'edit') && (
              <div className="space-y-3 mb-4 border-t border-slate-800 pt-3">
                {moveFromWatchlistId && (
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={removeFromWatchlistAfter} onChange={e => setRemoveFromWatchlistAfter(e.target.checked)} className="accent-cyan-500" />
                    Danach von der Watchlist entfernen
                  </label>
                )}
                <div>
                  <label className="text-xs text-slate-400">Zustand (Condition)</label>
                  <select value={cardCondition} onChange={e => setCardCondition(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                    {CONDITIONS.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Sprache der Karte</label>
                  <select value={cardLanguage} onChange={e => setCardLanguage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                    {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Variante</label>
                  <select value={cardVariant} onChange={e => setCardVariant(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                    {variantChoices(selectedCard, cardVariant).map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                  </select>
                </div>
                <div className="bg-slate-950 border border-cyan-500/30 p-3 rounded-lg text-center shadow-inner">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Geschätzter Richtwert</p>
                  <p className="text-xl font-black text-emerald-400">~{calculatePrice(selectedCard, cardCondition, cardLanguage, cardVariant)} €</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Eigenen Preis eintragen (optional)</label>
                  <input type="number" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-400">Anzahl</label>
                    <input type="number" min="1" step="1" value={cardQuantity} onChange={e => setCardQuantity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Einkaufspreis pro Stück €</label>
                    <input type="number" min="0" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="optional" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Eigenes Foto der Karte (optional)</label>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs text-slate-400 mt-1 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-cyan-500/20 file:text-cyan-400 file:text-xs file:font-bold hover:file:bg-cyan-500/30" />
                  {customImage && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={customImage} alt="Eigenes Foto" className="w-12 h-16 object-cover rounded border border-slate-700" />
                      <button onClick={() => setCustomImage('')} className="text-xs text-rose-400 hover:underline">Entfernen</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => { scanFlowRef.current = false; setModalType(null); setMoveFromWatchlistId(null); setEditOriginalPrice(''); setCustomPrice(''); setCustomImage(''); }} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold text-sm transition-colors">Zurück</button>
              {modalType === 'detail' && !selectedCard.docId && selectedCard.id && !String(selectedCard.id).startsWith('custom-') && (
                <button onClick={() => beginAddToCollection(selectedCard)} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg">➕ Collection</button>
              )}
              {modalType === 'edit' && <button onClick={saveEdit} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg">Speichern</button>}
              {modalType === 'collection' && <button onClick={addToCollection} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg">Hinzufügen</button>}
            </div>
          </div>
        </div>
      )}

      {customCardOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-sm w-full p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <h3 className="font-bold text-lg text-slate-100 mb-1">Eigene Karte anlegen</h3>
            <p className="text-[10px] text-slate-500 mb-3">Für Karten außerhalb der Datenbank.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">Name *</label>
                <input type="text" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="z.B. Dedenne GX" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-slate-400">Nummer</label>
                  <input type="text" value={customNumber} onChange={e => setCustomNumber(e.target.value)} placeholder="z.B. 195a" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-400">Set</label>
                  <input type="text" value={customSetName} onChange={e => setCustomSetName(e.target.value)} placeholder="optional" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Sprache der Karte</label>
                <select value={cardLanguage} onChange={e => setCardLanguage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                  {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Zustand (Condition)</label>
                <select value={cardCondition} onChange={e => setCardCondition(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                  {CONDITIONS.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Variante</label>
                <select value={cardVariant} onChange={e => setCardVariant(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                  {VARIANTS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Dein Preis in € (optional)</label>
                <input type="number" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">Anzahl</label>
                  <input type="number" min="1" step="1" value={cardQuantity} onChange={e => setCardQuantity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Einkaufspreis pro Stück €</label>
                  <input type="number" min="0" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="optional" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Foto der Karte (optional)</label>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs text-slate-400 mt-1 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-cyan-500/20 file:text-cyan-400 file:text-xs file:font-bold hover:file:bg-cyan-500/30" />
                {customImage && (
                  <div className="mt-2 flex items-center gap-2">
                    <img src={customImage} alt="Eigenes Foto" className="w-12 h-16 object-cover rounded border border-slate-700" />
                    <button onClick={() => setCustomImage('')} className="text-xs text-rose-400 hover:underline">Entfernen</button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <button onClick={closeCustomCard} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold text-sm transition-colors">Abbrechen</button>
              <button onClick={saveCustomCard} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg">Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}