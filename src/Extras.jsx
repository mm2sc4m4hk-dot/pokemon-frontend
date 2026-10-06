// Zusatz-Ansichten für die Collection: Artist, Pokédex und virtuelle Binder.
// Die Komponenten bekommen alles Nötige per Props aus App.jsx
// (API-URL, Collection, Watchlist-IDs, Bildkomponente, ...).
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection as fsCollection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  setDoc,
  writeBatch,
  query,
  where,
  onSnapshot
} from 'firebase/firestore';
import { auth, db } from './firebase';

// ---------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------
const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const pad = (n) => String(n).padStart(3, '0');
const plain = (name) => String(name || '').replace(/\s*\[.*\]\s*$/, '');
const spriteUrl = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

// Set-Namen-Normalisierung für Zusatzsuche
const normSetName = (s) => {
  const q = String(s || '').toLowerCase().trim();
  if (!q) return '';
  if (q.includes('30 jahre') || q.includes('30th') || q.includes('30 j') || q === '30') return '30th anniversary';
  if (q.includes('25 jahre') || q.includes('25th') || q.includes('celebrations')) return 'celebrations';
  return q;
};

// Filtertext -> mehrere mögliche Schreibweisen (deutsch/englisch)
function makeMatcher(query) {
  const t = String(query || '').trim().toLowerCase();
  if (!t) return () => true;
  const alts = [t];
  if (/^30(\s|$)/.test(t)) alts.push('30th', '30 jahre', 'anniversary');
  if (/^25\s*(jahre|j\b|th)|^celebrations/.test(t)) alts.push('25th', '25 jahre', 'celebrations');
  return (txt) => {
    const s = String(txt || '').toLowerCase();
    return alts.some((a) => s.includes(a));
  };
}

// Generationen: [Nummer, erste Dex-Nr., letzte Dex-Nr.]
const GENS = [[1, 1, 151], [2, 152, 251], [3, 252, 386], [4, 387, 493], [5, 494, 649], [6, 650, 721], [7, 722, 809], [8, 810, 905], [9, 906, 1025]];
// Binder-Seitenformate: [Label, Reihen, Spalten]
const LAYOUTS = [['2×2', 2, 2], ['3×3', 3, 3], ['3×4', 3, 4], ['4×4', 4, 4]];

// Karte (aus Collection, Suche oder Dex-Liste) -> schlanker Slot-Eintrag für Firestore
const toSlot = (c) => ({
  id: c.id,
  name: plain(c.name),
  image: c.images?.small || c.image || '',
  setName: c.set?.name || c.setName || '',
  localId: String(c.number ?? c.localId ?? '')
});

// Sortierung
export const SORT_OPTIONS = [
  ['name-asc', 'Name (A–Z)'],
  ['name-desc', 'Name (Z–A)'],
  ['price-desc', 'Preis (absteigend)'],
  ['price-asc', 'Preis (aufsteigend)'],
  ['set-asc', 'Set (A–Z)'],
  ['set-desc', 'Set (Z–A)'],
  ['lang-asc', 'Sprache (A–Z)'],
  ['lang-desc', 'Sprache (Z–A)'],
  ['added-desc', 'Zuletzt hinzugefügt'],
  ['added-asc', 'Zuerst hinzugefügt']
];

export function sortCollection(list, sortBy) {
  return list.sort((a, b) => {
    const nameA = a.name || ''; const nameB = b.name || '';
    const setA = a.set?.name || ''; const setB = b.set?.name || '';
    const langA = a.userLanguage || ''; const langB = b.userLanguage || '';

    if (sortBy === 'name-asc') return nameA.localeCompare(nameB);
    if (sortBy === 'name-desc') return nameB.localeCompare(nameA);
    if (sortBy === 'price-desc') return (parseFloat(b.userPrice) || 0) - (parseFloat(a.userPrice) || 0);
    if (sortBy === 'price-asc') return (parseFloat(a.userPrice) || 0) - (parseFloat(b.userPrice) || 0);
    if (sortBy === 'set-asc') return setA.localeCompare(setB);
    if (sortBy === 'set-desc') return setB.localeCompare(setA);
    if (sortBy === 'lang-asc') return langA.localeCompare(langB);
    if (sortBy === 'lang-desc') return langB.localeCompare(langA);
    if (sortBy === 'added-desc') return (b.addedAt || 0) - (a.addedAt || 0);
    if (sortBy === 'added-asc') return (a.addedAt || 0) - (b.addedAt || 0);
    return 0;
  });
}

// JSON Fetcher & Hooks
const memo = new Map();
function getJson(api, path) {
  const key = api + path;
  if (memo.has(key)) return memo.get(key);
  const p = fetch(key).then(async (r) => {
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.error || `Fehler ${r.status}`);
    return d;
  });
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}

function useJson(api, path) {
  const [state, setState] = useState({ loading: !!path, data: null, error: '' });
  useEffect(() => {
    if (!path) { setState({ loading: false, data: null, error: '' }); return undefined; }
    let alive = true;
    setState({ loading: true, data: null, error: '' });
    getJson(api, path)
      .then((data) => { if (alive) setState({ loading: false, data, error: '' }); })
      .catch((e) => { if (alive) setState({ loading: false, data: null, error: e.message || 'Fehler beim Laden' }); });
    return () => { alive = false; };
  }, [api, path]);
  return state;
}

function useOwned(collection) {
  return useMemo(() => {
    const ids = new Set();
    const byId = new Map();
    const dexOwned = new Map();
    (collection || []).forEach((c) => {
      const cardId = c.id || c.cardId;
      if (cardId) { ids.add(cardId); if (!byId.has(cardId)) byId.set(cardId, c); }
      (Array.isArray(c.dexId) ? c.dexId : []).forEach((d) => dexOwned.set(d, (dexOwned.get(d) || 0) + 1));
    });
    return { ids, byId, dexOwned };
  }, [collection]);
}

function Sprite({ id, className = 'w-12 h-12' }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [id]);
  if (bad) return <div className={`${className} flex items-center justify-center text-slate-600 text-xs`}>?</div>;
  return (
    <img
      src={spriteUrl(id)} alt="" loading="lazy" onError={() => setBad(true)}
      className={`${className} object-contain`} style={{ imageRendering: 'pixelated' }}
    />
  );
}

function Loading({ text = 'Lade …' }) {
  return <div className="text-center text-cyan-400 text-sm py-10 animate-pulse">{text}<p className="text-[10px] text-slate-500 mt-1">Falls der Server schläft, kann das bis zu einer Minute dauern.</p></div>;
}

function ErrorBox({ text }) {
  return <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-xl p-3">{text}</div>;
}

function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-300 font-bold">{done} / {total}</span>
        <span className="text-cyan-400 font-bold">{pct} %</span>
      </div>
      <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
        <div className="bg-gradient-to-r from-cyan-500 to-teal-400 h-full rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function HBars({ rows, empty = 'Noch keine Daten.' }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max <= 0) return <p className="text-xs text-slate-500">{empty}</p>;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.key ?? i} className="text-[11px]">
          <div className="flex justify-between gap-2 mb-0.5">
            <span className="text-slate-300 truncate">{r.label}</span>
            <span className="text-cyan-300 font-bold whitespace-nowrap">{eur(r.value)}</span>
          </div>
          <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          {r.sub && <p className="text-[9px] text-slate-500 mt-0.5 truncate">{r.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function MetaBanner({ meta }) {
  if (!meta || (!meta.needsMeta && !meta.busy && !meta.msg)) return null;
  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-3 flex items-center gap-3 text-xs">
      <p className="flex-1 text-slate-300">
        {meta.busy || meta.needsMeta === 0
          ? meta.msg
          : `${meta.needsMeta} Karten deiner Collection haben noch keine Pokédex-/Artist-Daten. ${meta.msg || ''}`}
      </p>
      {!meta.busy && meta.needsMeta > 0 && (
        <button onClick={meta.onBackfill} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black px-3 py-1.5 rounded-lg whitespace-nowrap">Daten laden</button>
      )}
    </div>
  );
}

function WishBtn({ card, watchIds, onWish }) {
  const [busy, setBusy] = useState(false);
  const on = watchIds.has(card.id);
  return (
    <button
      disabled={on || busy}
      onClick={async (e) => { e.stopPropagation(); setBusy(true); try { await onWish(card); } finally { setBusy(false); } }}
      className={`w-full text-[10px] font-bold rounded-md py-1 border transition-colors ${on
        ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
        : 'text-amber-300 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500 hover:text-slate-950'} disabled:opacity-70`}
    >
      {on ? '✓ Watchlist' : busy ? '…' : '★ Wunschliste'}
    </button>
  );
}

function CollBtn({ card, onAddColl }) {
  const [busy, setBusy] = useState(false);
  if (!onAddColl) return null;
  return (
    <button
      disabled={busy}
      onClick={async (e) => { e.stopPropagation(); setBusy(true); try { await onAddColl(card); } finally { setBusy(false); } }}
      className="w-full text-[10px] font-bold rounded-md py-1 border transition-colors text-cyan-300 border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500 hover:text-slate-950 disabled:opacity-70"
    >
      {busy ? '…' : '➕ Collection'}
    </button>
  );
}

const MAX_PHOTO_CHARS = 60000;
function shrinkImage(file, maxSide = 420) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Foto konnte nicht gelesen werden.')); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      let side = maxSide;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const scale = Math.min(1, side / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.7, 0.55, 0.4]) {
          const out = canvas.toDataURL('image/jpeg', quality);
          if (out.length <= MAX_PHOTO_CHARS) { resolve(out); return; }
        }
        side = Math.round(side * 0.8);
      }
      reject(new Error('Foto ist zu detailreich – bitte ein anderes versuchen.'));
    };
    img.src = url;
  });
}

function SlotPhoto({ ui }) {
  if (!ui) return null;
  return (
    <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 rounded-lg p-2">
      {ui.image
        ? <img src={ui.image} alt="Eigenes Foto" className="w-12 h-16 object-cover rounded border border-slate-700" />
        : <div className="w-12 h-16 rounded border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-lg">📷</div>}
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-[11px] text-slate-400">Eigenes Foto für diese Karte, solange du sie noch nicht hast</p>
        <div className="flex gap-2">
          <label className={`cursor-pointer text-[11px] font-bold px-2.5 py-1 rounded-md border text-cyan-300 border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500 hover:text-slate-950 ${ui.busy ? 'opacity-60 pointer-events-none' : ''}`}>
            {ui.busy ? 'Speichere …' : ui.image ? '📷 Ändern' : '📷 Foto hinzufügen'}
            <input type="file" accept="image/*" className="hidden" disabled={ui.busy} onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) ui.onPick(f); }} />
          </label>
          {ui.image && !ui.busy && (
            <button onClick={ui.onRemove} className="text-[11px] font-bold px-2.5 py-1 rounded-md border text-rose-300 border-rose-500/30 hover:bg-rose-500/20">Entfernen</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 w-full sm:max-w-2xl max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <div className="font-bold text-slate-100 min-w-0">{title}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg px-2">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// ARTIST VIEW
// ---------------------------------------------------------------------
export function ArtistView({ api, collection, watchIds, onWish, onAddColl, Img, meta }) {
  const names = useJson(api, '/api/illustrators');
  const [query, setQuery] = useState('');
  const [artist, setArtist] = useState('');
  const [filter, setFilter] = useState('all');
  const data = useJson(api, artist ? `/api/illustrators/${encodeURIComponent(artist)}` : null);
  const { ids: ownedIds } = useOwned(collection);

  const mine = useMemo(() => {
    const m = new Map();
    (collection || []).forEach((c) => { if (c.illustrator) m.set(c.illustrator, (m.get(c.illustrator) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [collection]);

  const q = query.trim().toLowerCase();
  const suggestions = q.length >= 2 && Array.isArray(names.data) && q !== artist.toLowerCase()
    ? names.data.filter((n) => n.toLowerCase().includes(q)).slice(0, 8)
    : [];

  const pick = (n) => { setArtist(n); setQuery(n); setFilter('all'); };

  const cards = data.data?.cards || [];
  const ownedCount = cards.filter((c) => ownedIds.has(c.id)).length;
  const totals = new Map();
  cards.forEach((c) => {
    const t = totals.get(c.setId) || { total: 0, owned: 0 };
    t.total += 1; if (ownedIds.has(c.id)) t.owned += 1;
    totals.set(c.setId, t);
  });
  const shown = cards.filter((c) => filter === 'all' || (filter === 'owned') === ownedIds.has(c.id));
  const groups = [];
  shown.forEach((c) => {
    let g = groups[groups.length - 1];
    if (!g || g.setId !== c.setId) { g = { setId: c.setId, name: c.setName, cards: [] }; groups.push(g); }
    g.cards.push(c);
  });

  return (
    <div className="space-y-4">
      <MetaBanner meta={meta} />
      <div className="relative">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Artist suchen (z. B. Mitsuhiro Arita)"
          className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none text-sm"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shadow-xl">
            {suggestions.map((n) => (
              <button key={n} onClick={() => pick(n)} className="block w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">{n}</button>
            ))}
          </div>
        )}
      </div>
      {names.error && <ErrorBox text={`Artist-Liste nicht verfügbar: ${names.error}`} />}

      {mine.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Deine Artists</p>
          <div className="flex flex-wrap gap-1.5">
            {mine.map(([n, count]) => (
              <button key={n} onClick={() => pick(n)} className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${artist === n ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-500'}`}>
                {n} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!artist && <div className="text-center py-16 text-slate-500 text-sm">Wähle einen Artist, um alle seine Karten zu sehen und welche dir noch fehlen.</div>}
      {artist && data.loading && <Loading text={`Lade Karten von ${artist} …`} />}
      {artist && data.error && <ErrorBox text={`Keine Karten gefunden: ${data.error}`} />}

      {artist && !data.loading && !data.error && (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
            <h3 className="font-bold text-slate-100">🎨 {data.data?.name || artist}</h3>
            <ProgressBar done={ownedCount} total={cards.length} />
            <div className="flex gap-2">
              {[['all', `Alle (${cards.length})`], ['owned', `Vorhanden (${ownedCount})`], ['missing', `Fehlend (${cards.length - ownedCount})`]].map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${filter === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`}>{label}</button>
              ))}
            </div>
          </div>

          {groups.length === 0 && <div className="text-center py-10 text-slate-500 text-sm">Nichts zu zeigen mit diesem Filter.</div>}
          {groups.map((g) => (
            <div key={g.setId} className="space-y-2">
              <div className="flex justify-between items-baseline border-b border-slate-800 pb-1">
                <h4 className="font-bold text-sm text-slate-200">{g.name}</h4>
                <span className="text-[11px] text-cyan-400 font-bold">{totals.get(g.setId)?.owned}/{totals.get(g.setId)?.total}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {g.cards.map((c) => {
                  const have = ownedIds.has(c.id);
                  return (
                    <div key={c.id} className="space-y-1">
                      <div className="relative">
                        <Img src={c.image} alt={c.name} className={`w-full rounded-md ${have ? '' : 'opacity-40 grayscale'}`} />
                        {have && <span className="absolute top-1 right-1 bg-emerald-500 text-slate-950 text-[9px] font-black rounded-full px-1.5">✓</span>}
                      </div>
                      <p className="text-[9px] text-slate-500 truncate">#{c.localId} {c.name}</p>
                      {!have && <CollBtn card={c} onAddColl={onAddColl} />}
                      {!have && <WishBtn card={c} watchIds={watchIds} onWish={onWish} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// POKÉDEX VIEW
// ---------------------------------------------------------------------
function DexDetail({ api, dex, collection, ownedIds, watchIds, onWish, onAddColl, Img, onClose, onPick, currentId, onClear, photoUi }) {
  const res = useJson(api, `/api/dex/${dex.id}`);
  const [filterQ, setFilterQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [extra, setExtra] = useState({ loading: true, cards: [] });

  useEffect(() => {
    let alive = true;
    setExtra({ loading: true, cards: [] });

    async function fetchAllByName() {
      try {
        const params = new URLSearchParams({ name: dex.name });
        const r = await fetch(`${api}/api/cards?${params.toString()}`);
        const d = r.ok ? await r.json() : [];
        const cards = (Array.isArray(d) ? d : [])
          .filter((c) => c.id && !String(c.id).startsWith('cm-'))
          .map((c) => ({
            id: c.id,
            name: c.name,
            image: c.images?.small || c.image || '',
            setName: c.set?.name || c.setName || '',
            localId: c.number || c.localId || ''
          }));
        if (alive) setExtra({ loading: false, cards });
      } catch (e) {
        if (alive) setExtra({ loading: false, cards: [] });
      }
    }

    fetchAllByName();
    return () => { alive = false; };
  }, [api, dex.name]);

  const base = res.data?.cards || [];
  const baseIds = new Set(base.map((c) => c.id));
  const all = [...base, ...extra.cards.filter((c) => !baseIds.has(c.id))];
  const dexCardIds = new Set(all.map((c) => c.id));
  const match = makeMatcher(filterQ);

  const mine = [];
  const seen = new Set();
  (collection || []).forEach((c) => {
    if (!c.id || seen.has(c.id)) return;
    if ((Array.isArray(c.dexId) && c.dexId.includes(dex.id)) || dexCardIds.has(c.id)) {
      seen.add(c.id);
      const setName = c.set?.name || c.setName || '';
      if (match(`${c.name} ${setName}`)) mine.push(c);
    }
  });

  const missingAll = all.filter((c) => !ownedIds.has(c.id) && match(`${c.name} ${c.set?.name || c.setName || ''}`));
  const missing = showAll ? missingAll : missingAll.slice(0, 48);

  const isLoading = res.loading || extra.loading;

  return (
    <Modal
      onClose={onClose}
      title={<div className="flex items-center gap-3"><Sprite id={dex.id} className="w-12 h-12" /><div><p className="text-[10px] text-slate-500">#{pad(dex.id)}</p><p>{dex.name}</p></div></div>}
    >
      {currentId && onClear && (
        <button onClick={onClear} className="w-full text-xs font-bold text-rose-300 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg py-2">Slot leeren</button>
      )}
      <SlotPhoto ui={photoUi} />
      <input value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="Filtern nach Set oder Name …" className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white rounded-lg px-3 py-2 text-xs outline-none" />

      {isLoading && <Loading text="Lade alle Karten …" />}
      {res.error && <ErrorBox text={`Karten konnten nicht geladen werden: ${res.error}`} />}

      {!isLoading && (
        <>
          <div>
            <p className="text-xs font-bold text-emerald-400 mb-2">In deiner Collection ({mine.length})</p>
            {mine.length === 0
              ? <p className="text-xs text-slate-500">Du hast noch keine Karte von {dex.name}{filterQ ? ' (mit diesem Filter)' : ''}.</p>
              : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {mine.map((c) => (
                    <button key={c.id} disabled={!onPick} onClick={() => onPick && onPick(toSlot(c))} className={`text-left space-y-1 ${onPick ? 'hover:opacity-80' : 'cursor-default'}`}>
                      <div className="relative">
                        <Img src={c.customImage || c.images?.small} alt={c.name} className={`w-full rounded-md ${currentId === c.id ? 'ring-2 ring-cyan-400' : ''}`} />
                        {onPick && <span className="absolute bottom-1 left-1 bg-cyan-500 text-slate-950 text-[9px] font-black rounded px-1.5">Wählen</span>}
                      </div>
                      <p className="text-[9px] text-slate-500 truncate">{c.set?.name || c.setName}</p>
                    </button>
                  ))}
                </div>
              )}
          </div>

          <div>
            <p className="text-xs font-bold text-amber-300 mb-2">Zum Kaufen / fehlt ({missingAll.length})</p>
            {missingAll.length === 0 && !res.error && <p className="text-xs text-slate-500">Keine weiteren Karten gefunden.</p>}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {missing.map((c) => (
                <div key={c.id} className="space-y-1">
                  <Img src={c.image} alt={c.name} className="w-full rounded-md opacity-70" />
                  <p className="text-[9px] text-slate-500 truncate">{c.setName} #{c.localId}</p>
                  {onPick && (
                    <button onClick={() => onPick(toSlot(c))} className="w-full text-[10px] font-bold rounded-md py-1 border text-cyan-300 border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500 hover:text-slate-950">📌 In Slot</button>
                  )}
                  <WishBtn card={c} watchIds={watchIds} onWish={onWish} />
                  {!onPick && <CollBtn card={c} onAddColl={onAddColl} />}
                </div>
              ))}
            </div>
            {!showAll && missingAll.length > 48 && (
              <button onClick={() => setShowAll(true)} className="w-full mt-3 text-xs font-bold text-cyan-400 border border-slate-700 rounded-lg py-2 hover:bg-slate-800">Alle {missingAll.length} anzeigen</button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

export function PokedexView({ api, collection, watchIds, onWish, onAddColl, Img, meta }) {
  const dex = useJson(api, '/api/pokedex');
  const [gen, setGen] = useState(0);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const { ids: ownedIds, dexOwned } = useOwned(collection);

  const list = dex.data?.list || [];
  const ownedTotal = list.filter((p) => dexOwned.has(p.id)).length;
  const range = GENS.find((g) => g[0] === gen);
  const t = q.trim().toLowerCase();
  const shown = list.filter((p) => {
    if (range && (p.id < range[1] || p.id > range[2])) return false;
    const has = dexOwned.has(p.id);
    if (status === 'owned' && !has) return false;
    if (status === 'missing' && has) return false;
    if (t && !`${p.name} ${p.nameEn || ''} ${p.id}`.toLowerCase().includes(t)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <MetaBanner meta={meta} />
      {dex.loading && <Loading text="Lade Pokédex …" />}
      {dex.error && <ErrorBox text={`Pokédex konnte nicht geladen werden: ${dex.error}`} />}
      {list.length > 0 && (
        <>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
            <h3 className="font-bold text-slate-100">📖 Pokédex-Fortschritt</h3>
            <ProgressBar done={ownedTotal} total={list.length} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name oder Nummer …" className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white rounded-lg px-3 py-2 text-xs outline-none" />
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[[0, 'Alle'], ...GENS.map((g) => [g[0], `Gen ${g[0]}`])].map(([k, label]) => (
                <button key={k} onClick={() => setGen(k)} className={`whitespace-nowrap text-[11px] font-bold px-2.5 py-1 rounded-full border ${gen === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800'}`}>{label}</button>
              ))}
            </div>
            <div className="flex gap-2">
              {[['all', 'Alle'], ['owned', 'Vorhanden'], ['missing', 'Fehlend']].map(([k, label]) => (
                <button key={k} onClick={() => setStatus(k)} className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border ${status === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800'}`}>{label}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {shown.map((p) => {
              const n = dexOwned.get(p.id);
              return (
                <button key={p.id} onClick={() => setOpen(p)} className={`relative rounded-xl border p-2 flex flex-col items-center transition-colors ${n ? 'bg-slate-900 border-emerald-500/50 hover:border-emerald-400' : 'bg-slate-950 border-slate-800 hover:border-slate-600'}`}>
                  <Sprite id={p.id} className={`w-14 h-14 ${n ? '' : 'opacity-30 grayscale'}`} />
                  <span className="text-[9px] text-slate-500">#{pad(p.id)}</span>
                  <span className={`text-[10px] font-bold truncate max-w-full ${n ? 'text-slate-200' : 'text-slate-500'}`}>{p.name}</span>
                  {n && <span className="absolute top-1 right-1 bg-emerald-500 text-slate-950 text-[9px] font-black rounded-full px-1.5">{n}×</span>}
                </button>
              );
            })}
          </div>
          {shown.length === 0 && <div className="text-center py-10 text-slate-500 text-sm">Keine Pokémon mit diesem Filter.</div>}
        </>
      )}

      {open && (
        <DexDetail api={api} dex={open} collection={collection} ownedIds={ownedIds} watchIds={watchIds} onWish={onWish} onAddColl={onAddColl} Img={Img} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// BINDER VIEW
// ---------------------------------------------------------------------
export function BinderView({ api, collection, watchIds, onWish, onAddColl, onOpenCard, Img, meta }) {
  const uid = auth.currentUser?.uid;
  const [binders, setBinders] = useState(null);
  const [selId, setSelId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'cards', layout: '3×3', pages: 10, startDex: 1, dexCount: 151 });
  const [page, setPage] = useState(0);
  const [slotIdx, setSlotIdx] = useState(null);
  const [error, setError] = useState('');
  const { ids: ownedIds, byId, dexOwned } = useOwned(collection);
  const [photos, setPhotos] = useState([]);
  const [arrange, setArrange] = useState(false);
  const [drag, setDrag] = useState(null);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    setPhotos([]);
    if (!uid || !selId) return undefined;
    return onSnapshot(
      query(fsCollection(db, 'users', uid, 'binderPhotos'), where('binderId', '==', selId)),
      (snap) => setPhotos(snap.docs.map((d) => ({ ...d.data(), docId: d.id }))),
      (err) => console.warn('Binder-Fotos nicht lesbar:', err.code)
    );
  }, [uid, selId]);

  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      fsCollection(db, 'users', uid, 'binders'),
      (snap) => setBinders(snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))),
      (err) => {
        setError('Binder konnten nicht geladen werden.');
        setBinders([]);
      }
    );
  }, [uid]);

  const b = binders?.find((x) => x.id === selId) || null;
  const photoByIdx = useMemo(() => new Map(photos.filter((p) => p.binderId === selId).map((p) => [Number(p.idx), p])), [photos, selId]);
  const photoFor = (idx, cardId) => { const p = photoByIdx.get(idx); return p && p.cardId === cardId ? p.image : null; };

  const usedSlots = (bd) => {
    const total = bd.pages * bd.rows * bd.cols;
    return bd.type === 'pokedex' ? Math.min(bd.dexCount || total, total) : total;
  };

  const statsOf = (bd) => {
    const used = usedSlots(bd);
    const keys = Object.keys(bd.slots || {}).filter((k) => Number(k) < used);
    const owned = keys.filter((k) => ownedIds.has(bd.slots[k].id));
    const value = owned.reduce((s, k) => s + (parseFloat(byId.get(bd.slots[k].id)?.userPrice) || 0), 0);
    return { used, filled: keys.length, owned: owned.length, value };
  };

  const ref = (id) => doc(db, 'users', uid, 'binders', id);
  const guard = async (fn) => { try { setError(''); await fn(); } catch (e) { setError('Speichern fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler')); } };

  const create = () => guard(async () => {
    const lay = LAYOUTS.find((l) => l[0] === form.layout) || LAYOUTS[1];
    const perPage = lay[1] * lay[2];
    const isD = form.type === 'pokedex';
    const startDex = Math.max(1, parseInt(form.startDex, 10) || 1);
    const dexCount = Math.min(2000, Math.max(1, parseInt(form.dexCount, 10) || 1));
    const pages = isD ? Math.ceil(dexCount / perPage) : Math.min(100, Math.max(1, parseInt(form.pages, 10) || 1));
    const name = form.name.trim() || (isD ? 'Pokédex-Binder' : 'Mein Binder');
    const data = { name, type: form.type, rows: lay[1], cols: lay[2], pages: Math.min(pages, 200), slots: {}, createdAt: Date.now() };
    if (isD) { data.startDex = startDex; data.dexCount = dexCount; }
    const created = await addDoc(fsCollection(db, 'users', uid, 'binders'), data);
    setCreating(false); setSelId(created.id); setPage(0);
  });

  const assign = (idx, slot) => guard(async () => { await updateDoc(ref(b.id), { [`slots.${idx}`]: slot }); setSlotIdx(null); });
  const clearSlot = (idx) => guard(async () => { await updateDoc(ref(b.id), { [`slots.${idx}`]: deleteField() }); setSlotIdx(null); });
  const rename = () => { const n = window.prompt('Neuer Name für den Binder:', b.name); if (n && n.trim()) guard(() => updateDoc(ref(b.id), { name: n.trim() })); };
  const addPage = () => guard(async () => { await updateDoc(ref(b.id), { pages: b.pages + 1 }); });
  const remove = () => {
    if (!window.confirm(`Binder „${b.name}“ wirklich löschen?`)) return;
    guard(async () => {
      await deleteDoc(ref(b.id));
      setSelId(null);
    });
  };

  if (!b) {
    return (
      <div className="space-y-4">
        <MetaBanner meta={meta} />
        {error && <ErrorBox text={error} />}
        {binders === null && <Loading text="Lade Binder …" />}

        {creating ? (
          <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-4 space-y-3 shadow-md">
            <h3 className="font-bold text-slate-100">Neuer Binder</h3>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (z. B. Glurak-Sammlung)" className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white rounded-lg px-3 py-2 text-sm outline-none" />
            <div className="flex gap-2">
              {[['cards', '📒 Karten-Binder'], ['pokedex', '📖 Pokédex-Binder']].map(([k, label]) => (
                <button key={k} onClick={() => setForm({ ...form, type: k })} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${form.type === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800'}`}>{label}</button>
              ))}
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-1">Seitenformat</p>
              <div className="flex gap-2">
                {LAYOUTS.map(([label, r, c]) => (
                  <button key={label} onClick={() => setForm({ ...form, layout: label })} className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${form.layout === label ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800'}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setCreating(false)} className="flex-1 py-2 rounded-lg text-sm font-bold text-slate-400 border border-slate-700 hover:bg-slate-800">Abbrechen</button>
              <button onClick={create} className="flex-1 py-2 rounded-lg text-sm font-black bg-cyan-500 hover:bg-cyan-400 text-slate-950">Binder erstellen</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="w-full py-3 rounded-xl border-2 border-dashed border-slate-700 text-cyan-400 font-bold text-sm hover:border-cyan-500">＋ Neuen Binder erstellen</button>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(binders || []).map((bd) => {
            const s = statsOf(bd);
            return (
              <button key={bd.id} onClick={() => { setSelId(bd.id); setPage(0); }} className="text-left bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-4 space-y-2 shadow-md transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-100 truncate">{bd.type === 'pokedex' ? '📖' : '📒'} {bd.name}</h3>
                  <span className="text-[10px] text-slate-500">{bd.pages} Seiten</span>
                </div>
                <ProgressBar done={s.owned} total={s.used} />
                <p className="text-[10px] text-slate-500">{s.filled} Slots belegt · Wert {eur(s.value)}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const per = b.rows * b.cols;
  const startIdx = page * per;
  const currSlots = Array.from({ length: per }, (_, i) => startIdx + i).filter((idx) => idx < usedSlots(b));
  const bStats = statsOf(b);

  return (
    <div className="space-y-4 select-none">
      {error && <ErrorBox text={error} />}

      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelId(null)} className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white text-xs font-bold">← Übersicht</button>
          <h2 className="font-black text-slate-100 text-sm truncate max-w-[180px]">{b.name}</h2>
          <button onClick={rename} className="text-xs text-slate-500 hover:text-cyan-400">✏️</button>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowMissing(true)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-950 text-slate-300 border border-slate-800">📋 Fehlt</button>
          <button onClick={remove} className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-red-400 text-xs">🗑️</button>
        </div>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span>Fortschritt: {bStats.owned} / {bStats.used}</span>
          <span className="font-bold text-cyan-400">Wert: {eur(bStats.value)}</span>
        </div>
        <ProgressBar done={bStats.owned} total={bStats.used} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="flex-1 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 disabled:opacity-30">← Zurück</button>
        <span className="text-xs font-bold text-slate-400">Seite {page + 1} / {b.pages}</span>
        <button disabled={page >= b.pages - 1} onClick={() => setPage((p) => Math.min(b.pages - 1, p + 1))} className="flex-1 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 disabled:opacity-30">Weiter →</button>
      </div>

      <div className="grid gap-2 bg-slate-950 border border-slate-800 p-3 rounded-2xl shadow-inner" style={{ gridTemplateColumns: `repeat(${b.cols}, minmax(0, 1fr))` }}>
        {currSlots.map((idx) => {
          const item = b.slots?.[idx];
          const isOwned = item && ownedIds.has(item.id);
          const customImg = item ? photoFor(idx, item.id) : null;

          return (
            <div
              key={idx}
              onClick={() => { if (item && onOpenCard) onOpenCard(item.id); else setSlotIdx(idx); }}
              className={`aspect-[2.5/3.5] relative rounded-xl border-2 flex flex-col items-center justify-center p-1 transition-all overflow-hidden cursor-pointer ${
                item ? (isOwned ? 'bg-slate-900 border-slate-700' : 'bg-slate-900/40 border-slate-800 grayscale opacity-60') : 'bg-slate-900/20 border-slate-800 border-dashed'
              }`}
            >
              {item ? (
                <div className="w-full h-full relative flex items-center justify-center">
                  {customImg ? <img src={customImg} alt={item.name} className="w-full h-full object-contain rounded" /> : <Img id={item.id} className="w-full h-full object-contain rounded" />}
                </div>
              ) : (
                <span className="text-slate-600 text-sm font-bold">＋</span>
              )}
            </div>
          );
        })}
      </div>

      <button onClick={addPage} className="w-full py-2.5 rounded-xl border border-dashed border-slate-800 text-slate-400 font-bold text-xs hover:text-cyan-400">＋ Neue Seite anhängen</button>

      {slotIdx !== null && (
        <SlotPickerModal idx={slotIdx} onClose={() => setSlotIdx(null)} onAssign={(slot) => assign(slotIdx, slot)} collection={collection} />
      )}

      {showMissing && (
        <MissingListModal b={b} usedSlots={usedSlots(b)} ownedIds={ownedIds} onClose={() => setShowMissing(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// MODALS
// ---------------------------------------------------------------------
function SlotPickerModal({ idx, onClose, onAssign, collection }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    if (!search.trim()) return collection || [];
    const q = search.toLowerCase();
    return (collection || []).filter((c) => (c.name || '').toLowerCase().includes(q) || (c.set || '').toLowerCase().includes(q));
  }, [collection, search]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-4 space-y-3 shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-white text-sm">Karte für Slot #{idx + 1} wählen</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-sm">✕</button>
        </div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Collection durchsuchen …" className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 text-white rounded-lg px-3 py-2 text-xs outline-none" />
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filtered.length === 0 ? (
            <p className="text-center py-6 text-xs text-slate-500">Keine passende Karte gefunden.</p>
          ) : (
            filtered.map((item) => (
              <button key={item.id || item.cardId} onClick={() => onAssign({ id: item.id || item.cardId, name: item.name, set: item.set?.name || item.setName || '' })} className="w-full text-left p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:border-cyan-500 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-200">{item.name}</p>
                  <p className="text-[10px] text-slate-500">{item.set?.name || item.setName}</p>
                </div>
                <span className="text-xs text-cyan-400 font-bold">Wählen ＋</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MissingListModal({ b, usedSlots, ownedIds, onClose }) {
  const missingSlots = useMemo(() => {
    const list = [];
    const slots = b.slots || {};
    for (let i = 0; i < usedSlots; i++) {
      const slot = slots[i];
      if (!slot || !ownedIds.has(slot.id)) {
        list.push({ idx: i, slot });
      }
    }
    return list;
  }, [b, usedSlots, ownedIds]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-4 space-y-3 shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-white text-sm">Fehlende Karten ({missingSlots.length})</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white font-bold text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {missingSlots.length === 0 ? (
            <p className="text-center py-6 text-xs text-emerald-400 font-bold">🎉 Der Binder ist vollständig!</p>
          ) : (
            missingSlots.map(({ idx, slot }) => (
              <div key={idx} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 flex justify-between items-center text-xs">
                <div>
                  <span className="text-slate-500 font-bold mr-2">Slot #{idx + 1}</span>
                  <span className="text-slate-200">{slot ? slot.name : 'Unbelegt'}</span>
                </div>
                {slot && <span className="text-[10px] text-slate-500">{slot.set}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}