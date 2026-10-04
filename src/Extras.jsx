// Zusatz-Ansichten für die Collection: Artist, Pokédex und virtuelle Binder.
// Die Komponenten bekommen alles Nötige per Props aus App.jsx
// (API-URL, Collection, Watchlist-IDs, Bildkomponente, ...).
import React, { useState, useEffect, useMemo } from 'react';
import {
  collection as fsCollection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
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

// Sortierung: wird von der Collection UND vom Binder-Kartenwähler genutzt, damit beide exakt gleich sortieren
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

// Einfacher JSON-Abruf mit Zwischenspeicher (gleiche Anfrage nur einmal pro Sitzung)
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
    const dexOwned = new Map(); // Dex-Nr. -> Anzahl Karten
    collection.forEach((c) => {
      if (c.id) { ids.add(c.id); if (!byId.has(c.id)) byId.set(c.id, c); }
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

// Hinweis + Knopf, solange Karten noch keine Pokédex-/Artist-Daten haben
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
// ARTIST: alle Karten eines Zeichners, nach Sets gruppiert, mit Fehlend-Filter
// ---------------------------------------------------------------------
export function ArtistView({ api, collection, watchIds, onWish, onAddColl, Img, meta }) {
  const names = useJson(api, '/api/illustrators');
  const [query, setQuery] = useState('');
  const [artist, setArtist] = useState('');
  const [filter, setFilter] = useState('all'); // all | owned | missing
  const data = useJson(api, artist ? `/api/illustrators/${encodeURIComponent(artist)}` : null);
  const { ids: ownedIds } = useOwned(collection);

  const mine = useMemo(() => {
    const m = new Map();
    collection.forEach((c) => { if (c.illustrator) m.set(c.illustrator, (m.get(c.illustrator) || 0) + 1); });
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
// Detailfenster zu einem Pokémon: Karten aus der Collection + Karten zum Kaufen.
// Wird vom Pokédex und vom Pokédex-Binder genutzt (onPick = Karte in Slot legen).
// ---------------------------------------------------------------------
function DexDetail({ api, dex, collection, ownedIds, watchIds, onWish, Img, onClose, onPick, currentId, onClear }) {
  const res = useJson(api, `/api/dex/${dex.id}`);
  const [filterQ, setFilterQ] = useState('');
  const [showAll, setShowAll] = useState(false);

  const all = res.data?.cards || [];
  const dexCardIds = new Set(all.map((c) => c.id));
  const t = filterQ.trim().toLowerCase();
  const match = (txt) => !t || txt.toLowerCase().includes(t);

  const mine = [];
  const seen = new Set();
  collection.forEach((c) => {
    if (!c.id || seen.has(c.id)) return;
    if ((Array.isArray(c.dexId) && c.dexId.includes(dex.id)) || dexCardIds.has(c.id)) {
      seen.add(c.id);
      if (match(`${c.name} ${c.set?.name || ''}`)) mine.push(c);
    }
  });
  const missingAll = all.filter((c) => !ownedIds.has(c.id) && match(`${c.name} ${c.setName || ''}`));
  const missing = showAll ? missingAll : missingAll.slice(0, 48);

  return (
    <Modal
      onClose={onClose}
      title={<div className="flex items-center gap-3"><Sprite id={dex.id} className="w-12 h-12" /><div><p className="text-[10px] text-slate-500">#{pad(dex.id)}</p><p>{dex.name}</p></div></div>}
    >
      {currentId && onClear && (
        <button onClick={onClear} className="w-full text-xs font-bold text-rose-300 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg py-2">Slot leeren</button>
      )}
      <input value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="Filtern nach Set oder Name …" className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white rounded-lg px-3 py-2 text-xs outline-none" />
      {res.loading && <Loading text="Lade Karten …" />}
      {res.error && <ErrorBox text={`Karten konnten nicht geladen werden: ${res.error}`} />}

      {!res.loading && (
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
                      <p className="text-[9px] text-slate-500 truncate">{c.set?.name}</p>
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

// ---------------------------------------------------------------------
// POKÉDEX: welche Pokémon sind (mit mindestens einer Karte) in der Collection?
// ---------------------------------------------------------------------
export function PokedexView({ api, collection, watchIds, onWish, Img, meta }) {
  const dex = useJson(api, '/api/pokedex');
  const [gen, setGen] = useState(0);
  const [status, setStatus] = useState('all'); // all | owned | missing
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
        <DexDetail api={api} dex={open} collection={collection} ownedIds={ownedIds} watchIds={watchIds} onWish={onWish} Img={Img} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Karten-Auswahl für normale Binder-Slots (Collection oder beliebige Karte)
// ---------------------------------------------------------------------
function CardPicker({ api, collection, ownedIds, watchIds, onWish, Img, current, onPick, onClear, onClose }) {
  const [tab, setTab] = useState('mine');
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('name-asc');
  const [sq, setSq] = useState('');
  const [res, setRes] = useState({ loading: false, error: '', cards: null });

  const mine = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = collection
      .filter((c) => c.id)
      .filter((c) => !t || `${c.name} ${c.set?.name || ''} ${c.number || ''}`.toLowerCase().includes(t));
    // erst sortieren, dann doppelte Karten-IDs entfernen -> es bleibt jeweils die Kopie, die in der Sortierung vorne steht
    const seen = new Set();
    return sortCollection(filtered, sortBy).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [collection, q, sortBy]);

  // kleine Zusatzzeile unter der Karte passend zur gewählten Sortierung
  const sortInfo = (c) => {
    if (sortBy.startsWith('price')) return eur(c.userPrice);
    if (sortBy.startsWith('added')) return c.addedAt ? new Date(c.addedAt).toLocaleDateString('de-DE') : '–';
    if (sortBy.startsWith('lang')) return String(c.userLanguage || '–').split(' ')[0];
    if (sortBy.startsWith('set')) return c.set?.name || '–';
    return '';
  };

  const search = async (e) => {
    e.preventDefault();
    if (!sq.trim()) return;
    setRes({ loading: true, error: '', cards: null });
    try {
      const r = await fetch(`${api}/api/cards?name=${encodeURIComponent(sq.trim())}`);
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || `Fehler ${r.status}`);
      setRes({ loading: false, error: '', cards: Array.isArray(d) ? d : [] });
    } catch (err) {
      setRes({ loading: false, error: err.message || 'Suche fehlgeschlagen', cards: null });
    }
  };

  return (
    <Modal onClose={onClose} title="Karte für diesen Slot wählen">
      {current && (
        <button onClick={onClear} className="w-full text-xs font-bold text-rose-300 border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 rounded-lg py-2">Slot leeren ({current.name})</button>
      )}
      <div className="flex gap-2">
        {[['mine', '🎴 Meine Collection'], ['all', '🔍 Alle Karten']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${tab === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800'}`}>{label}</button>
        ))}
      </div>

      {tab === 'mine' ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtern nach Name, Set oder Nummer …" className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white rounded-lg px-3 py-2 text-xs outline-none" />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-full bg-slate-950 text-xs border border-slate-700 rounded-lg p-2 text-slate-300">
            {SORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          {mine.length === 0 && <p className="text-xs text-slate-500">Keine Karten gefunden.</p>}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {mine.slice(0, 120).map((c) => (
              <button key={c.id} onClick={() => onPick(toSlot(c))} className="text-left space-y-1 hover:opacity-80">
                <Img src={c.customImage || c.images?.small} alt={c.name} className={`w-full rounded-md ${current?.id === c.id ? 'ring-2 ring-cyan-400' : ''}`} />
                <p className="text-[9px] text-slate-500 truncate">{plain(c.name)}</p>
                {sortInfo(c) && <p className="text-[9px] text-cyan-400 font-bold truncate">{sortInfo(c)}</p>}
              </button>
            ))}
          </div>
          {mine.length > 120 && <p className="text-[10px] text-slate-500 text-center">Nur die ersten 120 – bitte weiter filtern.</p>}
        </>
      ) : (
        <>
          <form onSubmit={search} className="flex gap-2">
            <input value={sq} onChange={(e) => setSq(e.target.value)} placeholder='Kartenname, z. B. "Glumanda 044"' className="flex-1 bg-slate-950 border border-slate-700 focus:border-cyan-400 text-white rounded-lg px-3 py-2 text-xs outline-none" />
            <button type="submit" className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs px-4 rounded-lg">Suche</button>
          </form>
          {res.loading && <Loading text="Suche läuft …" />}
          {res.error && <ErrorBox text={res.error} />}
          {res.cards && res.cards.length === 0 && <p className="text-xs text-slate-500">Keine Karten gefunden.</p>}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {(res.cards || []).map((c) => {
              const have = ownedIds.has(c.id);
              return (
                <div key={c.id} className="space-y-1">
                  <button onClick={() => onPick(toSlot(c))} className="block w-full relative hover:opacity-80">
                    <Img src={c.images?.small} alt={c.name} className={`w-full rounded-md ${have ? '' : 'opacity-70'}`} />
                    {have && <span className="absolute top-1 right-1 bg-emerald-500 text-slate-950 text-[9px] font-black rounded-full px-1.5">✓</span>}
                  </button>
                  <p className="text-[9px] text-slate-500 truncate">{plain(c.name)} · {c.set?.name}</p>
                  {!have && !String(c.id).startsWith('cm-') && <WishBtn card={c} watchIds={watchIds} onWish={onWish} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------
// BINDER: virtuelle Sammelalben (normal oder als Pokédex-Binder)
// ---------------------------------------------------------------------
export function BinderView({ api, collection, watchIds, onWish, Img, meta }) {
  const uid = auth.currentUser?.uid;
  const [binders, setBinders] = useState(null); // null = lädt
  const [selId, setSelId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'cards', layout: '3×3', pages: 10, startDex: 1, dexCount: 151 });
  const [page, setPage] = useState(0);
  const [slotIdx, setSlotIdx] = useState(null);
  const [error, setError] = useState('');
  const { ids: ownedIds, byId, dexOwned } = useOwned(collection);

  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      fsCollection(db, 'users', uid, 'binders'),
      (snap) => setBinders(snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))),
      (err) => {
        console.warn('Binder nicht lesbar:', err.code);
        setError(err.code === 'permission-denied' ? 'Keine Berechtigung für Binder – bitte die Firestore-Regeln für users/{uid}/binders freigeben.' : 'Binder konnten nicht geladen werden.');
        setBinders([]);
      }
    );
  }, [uid]);

  const b = binders?.find((x) => x.id === selId) || null;
  const per = b ? b.rows * b.cols : 0;
  const slots = b?.slots || {};
  const isDex = b?.type === 'pokedex';
  const dexRes = useJson(api, isDex ? '/api/pokedex' : null);
  const dexMap = useMemo(() => new Map((dexRes.data?.list || []).map((p) => [p.id, p])), [dexRes.data]);

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

  const dexOf = (idx) => (b?.startDex || 1) + idx;
  const ref = (id) => doc(db, 'users', uid, 'binders', id);
  const guard = async (fn) => { try { setError(''); await fn(); } catch (e) { console.error(e); setError('Speichern fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler')); } };

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
  const addPage = () => guard(async () => {
    await updateDoc(ref(b.id), isDex ? { pages: b.pages + 1, dexCount: (b.dexCount || usedSlots(b)) + per } : { pages: b.pages + 1 });
  });
  const remove = () => {
    if (!window.confirm(`Binder „${b.name}“ wirklich löschen? Deine Collection bleibt unberührt.`)) return;
    guard(async () => { await deleteDoc(ref(b.id)); setSelId(null); });
  };

  // ---------- Binder-Liste ----------
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
              <p className="text-[10px] text-slate-500 mb-1">Seitenformat (Taschen pro Seite)</p>
              <div className="flex gap-2">
                {LAYOUTS.map(([label, r, c]) => (
                  <button key={label} onClick={() => setForm({ ...form, layout: label })} className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${form.layout === label ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800'}`}>{label} <span className="opacity-60">({r * c})</span></button>
                ))}
              </div>
            </div>
            {form.type === 'cards' ? (
              <label className="block text-xs text-slate-400">Seiten
                <input type="number" min="1" max="100" value={form.pages} onChange={(e) => setForm({ ...form, pages: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-400" />
              </label>
            ) : (
              <>
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Schnellauswahl</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {GENS.map((g) => (
                      <button key={g[0]} onClick={() => setForm({ ...form, startDex: g[1], dexCount: g[2] - g[1] + 1 })} className="whitespace-nowrap text-[11px] font-bold px-2.5 py-1 rounded-full border bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-500">Gen {g[0]}</button>
                    ))}
                    <button onClick={() => setForm({ ...form, startDex: 1, dexCount: 1025 })} className="whitespace-nowrap text-[11px] font-bold px-2.5 py-1 rounded-full border bg-slate-950 text-slate-300 border-slate-700 hover:border-cyan-500">Alle</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-slate-400">Start bei Pokédex-Nr.
                    <input type="number" min="1" value={form.startDex} onChange={(e) => setForm({ ...form, startDex: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-400" />
                  </label>
                  <label className="block text-xs text-slate-400">Anzahl Pokémon
                    <input type="number" min="1" value={form.dexCount} onChange={(e) => setForm({ ...form, dexCount: e.target.value })} className="mt-1 w-full bg-slate-950 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-400" />
                  </label>
                </div>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setCreating(false)} className="flex-1 py-2 rounded-lg text-sm font-bold text-slate-400 border border-slate-700 hover:bg-slate-800">Abbrechen</button>
              <button onClick={create} className="flex-1 py-2 rounded-lg text-sm font-black bg-cyan-500 hover:bg-cyan-400 text-slate-950">Binder erstellen</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className="w-full py-3 rounded-xl border-2 border-dashed border-slate-700 text-cyan-400 font-bold text-sm hover:border-cyan-500">＋ Neuen Binder erstellen</button>
        )}

        {binders && binders.length === 0 && !creating && <div className="text-center py-12 text-slate-500 text-sm">Noch kein Binder. Erstelle einen Karten-Binder oder einen Pokédex-Binder.</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(binders || []).map((bd) => {
            const s = statsOf(bd);
            return (
              <button key={bd.id} onClick={() => { setSelId(bd.id); setPage(0); }} className="text-left bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-4 space-y-2 shadow-md transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-slate-100 truncate">{bd.type === 'pokedex' ? '📖' : '📒'} {bd.name}</h3>
                  <span className="text-[10px] text-slate-500 whitespace-nowrap">{bd.pages} Seiten · {bd.rows}×{bd.cols}</span>
                </div>
                <ProgressBar done={s.owned} total={s.used} />
                <p className="text-[10px] text-slate-500">{s.filled} Slots belegt · {s.owned} davon in deiner Collection · Wert {eur(s.value)}</p>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- Einzelner Binder ----------
  const s = statsOf(b);
  const lastPage = b.pages - 1;
  const curPage = Math.min(page, lastPage);
  const current = slotIdx !== null ? slots[slotIdx] : null;

  return (
    <div className="space-y-4">
      {error && <ErrorBox text={error} />}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => { setSelId(null); setSlotIdx(null); }} className="text-xs text-cyan-400 font-bold hover:underline">← Alle Binder</button>
          <div className="flex gap-3 text-xs">
            <button onClick={rename} className="text-slate-400 hover:text-cyan-400">✏️ Umbenennen</button>
            <button onClick={addPage} className="text-slate-400 hover:text-cyan-400">＋ Seite</button>
            <button onClick={remove} className="text-slate-400 hover:text-rose-400">🗑️</button>
          </div>
        </div>
        <h3 className="font-bold text-slate-100">{isDex ? '📖' : '📒'} {b.name}</h3>
        <ProgressBar done={s.owned} total={s.used} />
        <p className="text-[10px] text-slate-500">{s.filled} von {s.used} Slots belegt · {s.owned} in deiner Collection · Wert {eur(s.value)}</p>
      </div>
      <MetaBanner meta={isDex ? meta : null} />

      <div className="flex items-center justify-between">
        <button disabled={curPage === 0} onClick={() => setPage(curPage - 1)} className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm font-bold text-slate-300 disabled:opacity-30">‹</button>
        <div className="text-xs font-bold text-slate-300">
          Seite{' '}
          <select value={curPage} onChange={(e) => setPage(Number(e.target.value))} className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs outline-none">
            {Array.from({ length: b.pages }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
          </select>{' '}
          / {b.pages}
        </div>
        <button disabled={curPage === lastPage} onClick={() => setPage(curPage + 1)} className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm font-bold text-slate-300 disabled:opacity-30">›</button>
      </div>

      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${b.cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: per }, (_, i) => {
          const idx = curPage * per + i;
          if (idx >= s.used) return <div key={i} className="aspect-[5/7]" />;
          const slot = slots[idx];
          const dexNo = dexOf(idx);
          if (slot) {
            const have = ownedIds.has(slot.id);
            const item = byId.get(slot.id);
            return (
              <button key={i} onClick={() => setSlotIdx(idx)} className="relative block w-full aspect-[5/7] rounded-md overflow-hidden bg-slate-800 border border-slate-700 hover:border-cyan-500 transition-colors">
                <Img src={(have && item?.customImage) || (have && item?.images?.small) || slot.image} alt={slot.name} className={`w-full h-full object-cover ${have ? '' : 'opacity-40 grayscale'}`} />
                <span className={`absolute bottom-1 left-1 text-[9px] font-black px-1.5 py-0.5 rounded ${have ? 'bg-emerald-500 text-slate-950' : 'bg-slate-950/80 text-amber-300 border border-amber-500/40'}`}>{have ? '✓' : 'fehlt'}</span>
                {isDex && <span className="absolute top-1 left-1 text-[9px] font-bold bg-slate-950/80 text-slate-300 rounded px-1">#{pad(dexNo)}</span>}
              </button>
            );
          }
          const dexInfo = isDex ? dexMap.get(dexNo) : null;
          const canFill = isDex && dexOwned.has(dexNo);
          return (
            <button key={i} onClick={() => setSlotIdx(idx)} className={`w-full aspect-[5/7] rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-0.5 transition-colors ${canFill ? 'border-emerald-500/60 text-emerald-400' : 'border-slate-700 text-slate-600 hover:border-cyan-500 hover:text-cyan-400'}`}>
              {isDex ? (
                <>
                  <Sprite id={dexNo} className="w-10 h-10" />
                  <span className="text-[9px]">#{pad(dexNo)}</span>
                  <span className="text-[10px] text-slate-400 truncate max-w-full px-1">{dexInfo?.name || ''}</span>
                </>
              ) : <span className="text-2xl">＋</span>}
            </button>
          );
        })}
      </div>
      {isDex && <p className="text-[10px] text-slate-500 text-center">Grün umrandete Slots: Du hast bereits eine Karte dieses Pokémon – tippe auf den Slot, um sie einzusortieren.</p>}

      {slotIdx !== null && (isDex ? (
        <DexDetail
          api={api} dex={{ id: dexOf(slotIdx), name: dexMap.get(dexOf(slotIdx))?.name || `#${dexOf(slotIdx)}` }}
          collection={collection} ownedIds={ownedIds} watchIds={watchIds} onWish={onWish} Img={Img}
          onClose={() => setSlotIdx(null)} onPick={(card) => assign(slotIdx, card)}
          currentId={current?.id} onClear={() => clearSlot(slotIdx)}
        />
      ) : (
        <CardPicker
          api={api} collection={collection} ownedIds={ownedIds} watchIds={watchIds} onWish={onWish} Img={Img}
          current={current} onClose={() => setSlotIdx(null)} onPick={(card) => assign(slotIdx, card)} onClear={() => clearSlot(slotIdx)}
        />
      ))}
    </div>
  );
}
