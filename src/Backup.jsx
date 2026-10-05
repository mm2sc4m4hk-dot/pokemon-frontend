// Neu: Lesezugriff per Link (Freigabe), „Hast du schon“-Badge, CSV-Backup (Export/Import)
// und Watchlist-Export im Cardmarket-Wantlist-Format.
// Diese Datei importiert bewusst NICHTS aus App.jsx (sonst Zirkelbezug); Konstanten und
// Rechenfunktionen kommen per Props.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection as fsCollection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { toCsv, parseCsv, downloadText } from './csvTools';

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const plain = (name) => String(name || '').replace(/\s*\[.*\]\s*$/, '');
const gradeText = (c) => (c && c.userGrade && c.userGrade.company && c.userGrade.grade ? `${c.userGrade.company} ${c.userGrade.grade}` : '');
const qtyOf = (it) => Math.max(1, parseInt(it?.userQuantity, 10) || 1);
const isReal = (id) => !!id && !String(id).startsWith('custom-');
const VARIANT_LABEL = { normal: 'Normal', reverse: 'Reverse Holo', holo: 'Holo', firstEdition: '1st Edition' };
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------
// „Hast du schon“-Badge
// ---------------------------------------------------------------------
export function buildOwnedMap(collection) {
  const m = new Map();
  for (const c of collection) {
    if (!c || !c.id) continue;
    const e = m.get(c.id) || { qty: 0, variants: {} };
    const q = qtyOf(c);
    const v = c.userVariant || 'normal';
    e.qty += q;
    e.variants[v] = (e.variants[v] || 0) + q;
    m.set(c.id, e);
  }
  return m;
}

export function OwnedBadge({ info, className = '' }) {
  if (!info) return null;
  const keys = Object.keys(info.variants);
  const detail = keys.map((k) => `${VARIANT_LABEL[k] || k} ×${info.variants[k]}`).join(', ');
  const extra = keys.length === 1 && keys[0] !== 'normal' ? ` · ${VARIANT_LABEL[keys[0]] || keys[0]}` : '';
  return (
    <span
      title={detail}
      className={`inline-block text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/40 rounded px-1.5 py-0.5 ${className}`}
    >
      ✓ Hast du schon{info.qty > 1 ? ` ×${info.qty}` : ''}{extra}
    </span>
  );
}

// ---------------------------------------------------------------------
// Freigabe per Link (nur Lesen)
// ---------------------------------------------------------------------
const PART_SIZE = 300;
const MAX_PARTS = 100;
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const randomToken = () => {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => CHARS[x % CHARS.length]).join('');
};

function buildShareItems(collection, showPrices) {
  const items = collection.filter((c) => c && c.id).map((c) => {
    const img = c.images?.small || '';
    const o = {
      i: c.id,
      n: plain(c.name),
      s: c.set?.name || '',
      no: c.number || '',
      im: /^https?:/.test(img) ? img : '',
      v: c.userVariant || 'normal',
      c: gradeText(c) || c.userCondition || '',
      l: String(c.userLanguage || '').split(' ')[0],
      q: qtyOf(c)
    };
    if (showPrices) o.p = parseFloat(c.userPrice) || 0;
    return o;
  });
  items.sort((a, b) => a.n.localeCompare(b.n) || a.s.localeCompare(b.s) || a.i.localeCompare(b.i) || a.v.localeCompare(b.v) || a.c.localeCompare(b.c));
  return items;
}

const prioOf = (c) => ([1, 2, 3].includes(Number(c?.priority)) ? Number(c.priority) : 2);
const cmUrl = (c, n) => {
  const q = n ? [n.name, ...(n.abilities || []), ...(n.attacks || [])].join(' ') : plain(c.name);
  return `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(q)}`;
};

function buildWishItems(watchlist, showPrices, en = {}) {
  const items = (watchlist || []).filter((c) => c && c.id).map((c) => {
    const img = c.images?.small || '';
    const pr = c.cardmarket?.prices || {};
    const o = { i: c.id, n: plain(c.name), s: c.set?.name || '', no: c.number || '', im: /^https?:/.test(img) ? img : '', pr: prioOf(c), u: cmUrl(c, en[c.id]) };
    if (showPrices) o.p = pr.trendPrice || pr.averageSellPrice || pr.trendPriceHolo || pr.avg1Holo || 0;
    return o;
  });
  items.sort((a, b) => b.pr - a.pr || a.n.localeCompare(b.n) || a.s.localeCompare(b.s) || a.i.localeCompare(b.i));
  return items;
}

async function pushShare(uid, share, items, wish = []) {
  const capped = items.slice(0, PART_SIZE * MAX_PARTS);
  const parts = [];
  for (let i = 0; i < capped.length; i += PART_SIZE) parts.push(capped.slice(i, i + PART_SIZE));
  const cappedW = wish.slice(0, PART_SIZE * 10);
  const wparts = [];
  for (let i = 0; i < cappedW.length; i += PART_SIZE) wparts.push(cappedW.slice(i, i + PART_SIZE));
  const showPrices = share.showPrices !== false;
  const pieces = capped.reduce((s, it) => s + it.q, 0);
  const value = showPrices ? Math.round(capped.reduce((s, it) => s + (it.p || 0) * it.q, 0) * 100) / 100 : null;
  const meta = {
    uid,
    owner: auth.currentUser?.displayName || 'Trainer',
    showPrices,
    count: capped.length,
    pieces,
    value,
    parts: parts.length,
    showCollection: share.showCollection !== false,
    showWishlist: !!share.showWishlist,
    wishCount: cappedW.length,
    wishParts: wparts.length,
    createdAt: share.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'shares', share.token), meta);
  parts.forEach((p, i) => batch.set(doc(db, 'shares', share.token, 'parts', String(i)), { items: p }));
  wparts.forEach((p, i) => batch.set(doc(db, 'shares', share.token, 'parts', `w${i}`), { items: p }));
  for (let i = parts.length; i < (share.parts || 0); i += 1) batch.delete(doc(db, 'shares', share.token, 'parts', String(i)));
  for (let i = wparts.length; i < (share.wishParts || 0); i += 1) batch.delete(doc(db, 'shares', share.token, 'parts', `w${i}`));
  await batch.commit();
  return meta;
}

export function SharePanel({ collection, watchlist = [], ready, api }) {
  const uid = auth.currentUser?.uid;
  const [share, setShare] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const lastSig = useRef(null);

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    getDocs(query(fsCollection(db, 'shares'), where('uid', '==', uid), limit(1)))
      .then((snap) => {
        if (!alive) return;
        if (snap.empty) setShare(null);
        else { const d = snap.docs[0]; setShare({ token: d.id, ...d.data() }); }
      })
      .catch((e) => {
        if (!alive) return;
        setShare(null);
        setMsg(e.code === 'permission-denied'
          ? 'Die Firestore-Regeln für „shares“ fehlen noch – bitte die neuen Regeln in der Firebase Console veröffentlichen.'
          : 'Freigabe konnte nicht geladen werden.');
      });
    return () => { alive = false; };
  }, [uid]);

  const showPrices = share ? share.showPrices !== false : true;
  const showCollection = share ? share.showCollection !== false : true;
  const showWishlist = share ? !!share.showWishlist : false;

  const [en, setEn] = useState({});
  useEffect(() => {
    if (!showWishlist || !api) return undefined;
    const ids = watchlist.map((c) => c.id).filter((id) => isReal(id) && !String(id).startsWith('cm-') && !en[id]).slice(0, 100);
    if (!ids.length) return undefined;
    let alive = true;
    fetch(`${api}/api/wantlist-names`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && d.names) setEn((p) => ({ ...p, ...d.names })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [watchlist, showWishlist, api, Object.keys(en).length]);

  const items = useMemo(() => (showCollection ? buildShareItems(collection, showPrices) : []), [collection, showPrices, showCollection]);
  const wishItems = useMemo(() => (showWishlist ? buildWishItems(watchlist, showPrices, en) : []), [watchlist, showPrices, showWishlist, en]);
  const sig = useMemo(() => JSON.stringify([items, wishItems]), [items, wishItems]);

  useEffect(() => {
    if (!share || !share.token || !ready) return undefined;
    if (lastSig.current === null) { lastSig.current = sig; return undefined; }
    if (lastSig.current === sig) return undefined;
    const t = setTimeout(async () => {
      try {
        const meta = await pushShare(uid, share, items, wishItems);
        lastSig.current = sig;
        setShare((s) => (s ? { ...s, ...meta } : s));
      } catch (e) {
        console.warn('Freigabe aktualisieren fehlgeschlagen:', e.code || e.message);
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [sig, share && share.token, ready]);

  const build = (s) => {
    const sp = s.showPrices !== false;
    return {
      its: s.showCollection !== false ? buildShareItems(collection, sp) : [],
      wish: s.showWishlist ? buildWishItems(watchlist, sp, en) : []
    };
  };

  const link = share ? `${window.location.origin}/?share=${share.token}` : '';

  const create = async () => {
    if (!uid || busy) return;
    setBusy(true); setMsg('');
    try {
      const fresh = { token: randomToken(), showPrices: true, showCollection: true, showWishlist: true, parts: 0, wishParts: 0, createdAt: Date.now() };
      const b = build(fresh);
      const meta = await pushShare(uid, fresh, b.its, b.wish);
      lastSig.current = JSON.stringify([b.its, b.wish]);
      setShare({ ...fresh, ...meta });
      setMsg('Link erstellt. ✓');
    } catch (e) {
      setMsg(e.code === 'permission-denied' ? 'Keine Berechtigung – bitte die Firestore-Regeln für „shares“ veröffentlichen.' : 'Erstellen fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
    } finally { setBusy(false); }
  };

  const refresh = async (next = share) => {
    if (!next || busy) return;
    setBusy(true); setMsg('');
    try {
      const b = build(next);
      const meta = await pushShare(uid, next, b.its, b.wish);
      lastSig.current = JSON.stringify([b.its, b.wish]);
      setShare({ ...next, ...meta });
      setMsg('Freigabe ist aktuell. ✓');
    } catch (e) {
      setMsg('Aktualisieren fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
    } finally { setBusy(false); }
  };

  const togglePrices = () => refresh({ ...share, showPrices: !showPrices });
  const toggleFlag = (key, cur) => refresh({ ...share, [key]: !cur });

  const remove = async () => {
    if (!share || busy) return;
    if (!window.confirm('Link löschen? Danach kann niemand die Sammlung mehr über diesen Link sehen.')) return;
    setBusy(true); setMsg('');
    try {
      const batch = writeBatch(db);
      for (let i = 0; i < (share.parts || 0); i += 1) batch.delete(doc(db, 'shares', share.token, 'parts', String(i)));
      for (let i = 0; i < (share.wishParts || 0); i += 1) batch.delete(doc(db, 'shares', share.token, 'parts', `w${i}`));
      await batch.commit();
      const last = writeBatch(db);
      last.delete(doc(db, 'shares', share.token));
      await last.commit();
      lastSig.current = null;
      setShare(null);
      setMsg('Freigabe gelöscht.');
    } catch (e) {
      setMsg('Löschen fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
    } finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setMsg('Link kopiert. ✓'); }
    catch (e) { window.prompt('Zum Kopieren markieren:', link); }
  };
  const nativeShare = async () => {
    try { await navigator.share({ title: 'Meine Pokémon-Sammlung', url: link }); } catch (e) { /* abgebrochen */ }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
      <h3 className="font-bold text-slate-100 text-sm">🔗 Sammlung teilen (nur Lesen)</h3>
      {share === undefined && <p className="text-xs text-slate-500">Lade …</p>}
      {share === null && (
        <>
          <p className="text-[11px] text-slate-400">Erstellt einen Link, über den andere deine Sammlung ansehen können – ohne Anmeldung, ohne Bearbeiten. Einkaufspreise und eigene Fotos werden nie geteilt.</p>
          <button onClick={create} disabled={busy || !ready} className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black text-sm py-2.5 rounded-xl">{busy ? 'Erstelle …' : 'Link erstellen'}</button>
        </>
      )}
      {share && (
        <>
          <input readOnly value={link} onFocus={(e) => e.target.select()} className="w-full bg-slate-950 border border-slate-800 text-slate-300 rounded-lg px-3 py-2 text-xs outline-none" />
          <div className="flex gap-2">
            <button onClick={copy} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs py-2 rounded-lg">Kopieren</button>
            {typeof navigator !== 'undefined' && navigator.share && (
              <button onClick={nativeShare} className="flex-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 font-bold text-xs py-2 rounded-lg">Teilen …</button>
            )}
          </div>
          {showWishlist && (
            <button onClick={async () => { try { await navigator.clipboard.writeText(link + '&view=wish'); setMsg('Wunschlisten-Link kopiert. ✓'); } catch (e) { window.prompt('Zum Kopieren markieren:', link + '&view=wish'); } }} className="w-full bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-bold text-xs py-2 rounded-lg">🎁 Link nur zur Wunschliste kopieren</button>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={showPrices} disabled={busy} onChange={togglePrices} className="accent-cyan-500" />
            Preise und Gesamtwert im Link anzeigen
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={showCollection} disabled={busy} onChange={() => toggleFlag('showCollection', showCollection)} className="accent-cyan-500" />
            Sammlung zeigen
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={showWishlist} disabled={busy} onChange={() => toggleFlag('showWishlist', showWishlist)} className="accent-cyan-500" />
            🎁 Wunschliste zeigen (Geschenkideen für Freunde, ohne deine Zielpreise)
          </label>
          <p className="text-[10px] text-slate-500">
            {share.count ?? 0} Einträge{share.wishCount ? ` + ${share.wishCount} Wünsche` : ''} geteilt{share.updatedAt ? ` · Stand ${new Date(share.updatedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}. Änderungen werden automatisch übernommen, solange die App offen ist.
          </p>
          <div className="flex gap-4 text-xs">
            <button onClick={() => refresh()} disabled={busy} className="text-cyan-400 font-bold hover:underline disabled:opacity-50">Jetzt aktualisieren</button>
            <button onClick={remove} disabled={busy} className="text-rose-400 font-bold hover:underline disabled:opacity-50">Link löschen</button>
          </div>
        </>
      )}
      {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Ansicht für den Freigabe-Link (/?share=TOKEN) – ohne Anmeldung, nur lesen
// ---------------------------------------------------------------------
export function SharedView({ token, Img }) {
  const [state, setState] = useState({ loading: true, error: '', meta: null, items: [] });
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [limitN, setLimitN] = useState(120);
  const [tab, setTab] = useState('coll');

  const onlyWish = useMemo(() => new URLSearchParams(window.location.search).get('view') === 'wish', []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const metaSnap = await getDoc(doc(db, 'shares', token));
        if (!metaSnap.exists()) throw new Error('missing');
        const meta = metaSnap.data();
        const snaps = await Promise.all(Array.from({ length: meta.parts || 0 }, (_, i) => getDoc(doc(db, 'shares', token, 'parts', String(i)))));
        const items = snaps.flatMap((s) => (s.exists() ? s.data().items || [] : []));
        const wsnaps = await Promise.all(Array.from({ length: meta.wishParts || 0 }, (_, i) => getDoc(doc(db, 'shares', token, 'parts', `w${i}`))));
        const wish = wsnaps.flatMap((s) => (s.exists() ? s.data().items || [] : []));
        if (alive) setState({ loading: false, error: '', meta, items, wish });
      } catch (e) {
        if (alive) setState({ loading: false, meta: null, items: [], error: e.message === 'missing' || e.code === 'permission-denied' ? 'Dieser Link ist ungültig oder wurde deaktiviert.' : 'Die Sammlung konnte nicht geladen werden.' });
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const { meta, items } = state;
  const wish = state.wish || [];
  const hasColl = items.length > 0;
  const hasWish = wish.length > 0;
  const view = (onlyWish || tab === 'wish') && hasWish ? 'wish' : (hasColl ? 'coll' : 'wish');
  const hasPrices = !!meta?.showPrices;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = items.filter((it) => !t || `${it.n} ${it.s} ${it.no}`.toLowerCase().includes(t));
    list.sort((a, b) => {
      if (sortBy === 'price') return ((b.p || 0) * b.q) - ((a.p || 0) * a.q);
      if (sortBy === 'set') return a.s.localeCompare(b.s) || a.n.localeCompare(b.n);
      return a.n.localeCompare(b.n) || a.s.localeCompare(b.s);
    });
    return list;
  }, [items, q, sortBy]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-cyan-500/20 px-4 py-3 flex items-center justify-between">
        <span className="text-cyan-400 text-xl font-black tracking-wider">⚡ PokéTracker</span>
        <a href={window.location.origin} className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-cyan-400">Zur App</a>
      </header>
      <main className="max-w-4xl mx-auto p-4 space-y-4">
        {state.loading && <p className="text-center text-cyan-400 text-sm py-16 animate-pulse">Lade Sammlung …</p>}
        {state.error && <p className="text-center text-rose-400 text-sm py-16">{state.error}</p>}
        {meta && (
          <>
            <div className="bg-slate-900 border border-cyan-500/30 rounded-2xl p-5 shadow-xl">
              <h1 className="text-xl font-black text-white">{onlyWish ? 'Wunschliste' : 'Sammlung'} von {meta.owner || 'Trainer'}</h1>
              <p className="text-xs text-slate-400 mt-1">Nur Ansicht · Stand {meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('de-DE') : '–'}</p>
              <div className={'mt-4 grid grid-cols-2 gap-3 text-center' + (hasColl && !onlyWish ? '' : ' hidden')}>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Karten</p>
                  <p className="text-lg font-black text-cyan-300">{meta.pieces ?? items.length}</p>
                </div>
                {hasPrices && meta.value != null && (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">Gesamtwert</p>
                    <p className="text-lg font-black text-cyan-300">{eur(meta.value)}</p>
                  </div>
                )}
              </div>
            </div>

            {hasColl && hasWish && !onlyWish && (
              <div className="flex gap-2">
                {[['coll', '🎴 Sammlung'], ['wish', '🎁 Wunschliste']].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 rounded-lg text-xs font-bold border ${view === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>{l}</button>
                ))}
              </div>
            )}

            {view === 'wish' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">🎁 Diese Karten fehlen {meta.owner || 'Trainer'} noch – Geschenkideen. Bitte kurz absprechen, damit nichts doppelt gekauft wird.</p>
                {!hasWish && <p className="text-center text-slate-500 text-sm py-10">Die Wunschliste ist leer.</p>}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {wish.map((it, idx) => (
                    <div key={`${it.i}-${idx}`} className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 shadow-lg">
                      <Img src={it.im} alt={it.n} className="w-full rounded-lg mb-2" />
                      <p className="text-xs font-bold text-slate-200 truncate">{it.n}{it.no ? <span className="text-slate-500 font-normal"> #{it.no}</span> : null}</p>
                      <p className="text-[10px] text-slate-400 truncate">{it.s || 'Unbekanntes Set'}</p>
                      {hasPrices && it.p > 0 && <p className="text-xs text-cyan-400 font-bold mt-1">ca. {eur(it.p)}</p>}
                      {it.pr && <p className="text-xs text-amber-300">{'★'.repeat(it.pr)}<span className="text-slate-700">{'★'.repeat(3 - it.pr)}</span></p>}
                      <a href={it.u || `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(it.n)}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 underline">Auf Cardmarket suchen ↗</a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {view === 'coll' && (
            <>
            <div className="grid grid-cols-2 gap-2">
              <input value={q} onChange={(e) => { setQ(e.target.value); setLimitN(120); }} placeholder="Suchen (Name, Set, Nummer)" className="col-span-2 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-2.5 text-sm outline-none" />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="col-span-2 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="name">Name (A–Z)</option>
                <option value="set">Set (A–Z)</option>
                {hasPrices && <option value="price">Wert (absteigend)</option>}
              </select>
            </div>

            {shown.length === 0 && <p className="text-center text-slate-500 text-sm py-10">Keine Karten gefunden.</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {shown.slice(0, limitN).map((it, idx) => (
                <div key={`${it.i}-${it.v}-${it.c}-${idx}`} className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 shadow-lg">
                  <Img src={it.im} alt={it.n} className="w-full rounded-lg mb-2" />
                  <p className="text-xs font-bold text-slate-200 truncate">{it.n}{it.no ? <span className="text-slate-500 font-normal"> #{it.no}</span> : null}</p>
                  <p className="text-[10px] text-slate-400 truncate">{it.s || 'Unbekanntes Set'}{it.l ? ` · ${it.l}` : ''}</p>
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {it.c && <span className="text-[9px] bg-slate-800 px-1 rounded text-slate-300">{it.c}</span>}
                    {it.v !== 'normal' && <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1 rounded">{VARIANT_LABEL[it.v] || it.v}</span>}
                    {it.q > 1 && <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1 rounded">×{it.q}</span>}
                  </div>
                  {hasPrices && it.p != null && <p className="text-xs text-cyan-400 font-bold mt-1">{eur(it.p)}</p>}
                </div>
              ))}
            </div>
            {shown.length > limitN && (
              <button onClick={() => setLimitN((n) => n + 120)} className="w-full text-xs font-bold text-cyan-400 border border-slate-700 rounded-lg py-2 hover:bg-slate-800">Mehr anzeigen ({shown.length - limitN} weitere)</button>
            )}
            </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------
// CSV-Backup: Export + Import
// ---------------------------------------------------------------------
const COLS = ['liste', 'id', 'name', 'nummer', 'set', 'set_id', 'set_gesamt', 'anzahl', 'zustand', 'sprache', 'variante', 'preis', 'preis_manuell', 'einkaufspreis', 'verkauf', 'zielpreis', 'alarm_hoch', 'bewertung', 'bild', 'hinzugefuegt'];

const comma = (n) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const money = (v) => { const n = num(v); return n !== null && n >= 0 ? n.toFixed(2) : null; };
const parseGrade = (v) => {
  const m = String(v || '').trim().match(/^([A-Za-z]+)\s*([0-9]+(?:[.,][0-9])?)$/);
  if (!m) return null;
  const c = m[1].toUpperCase();
  return { company: c === 'ANDERE' ? 'Andere' : c, grade: m[2].replace(',', '.') };
};
const yes = (v) => ['ja', 'yes', 'true', '1', 'x'].includes(String(v || '').trim().toLowerCase());
const normVariant = (v) => {
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '');
  return { normal: 'normal', reverse: 'reverse', reverseholo: 'reverse', holo: 'holo', firstedition: 'firstEdition', '1stedition': 'firstEdition' }[s] || 'normal';
};
const matchName = (val, list, fallback) => {
  const v = String(val || '').trim().toLowerCase();
  if (!v) return fallback;
  const f = list.find((x) => x.name.toLowerCase() === v) || list.find((x) => x.name.split(' ')[0].toLowerCase() === v.split(' ')[0]);
  return f ? f.name : fallback;
};
const itemKey = (id, cond, lang, variant) => `${id}|${cond}|${lang}|${variant}`;

const minimalCard = (r) => {
  const img = /^https?:/.test(r.bild || '') ? r.bild : '';
  const custom = String(r.id).startsWith('custom-');
  return {
    id: r.id,
    name: r.name || r.id,
    number: r.nummer || null,
    images: { small: img, large: img ? img.replace('/low.webp', '/high.webp') : '' },
    set: { id: r.set_id || null, name: r.set || null, total: num(r.set_gesamt) },
    variants: null,
    cardmarket: { url: '', prices: {} },
    ...(custom ? { isCustom: true } : {})
  };
};

export function BackupPanel({ collection, watchlist, api, conditions, languages, calculatePrice, isAutoPrice }) {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);

  const exportCsv = () => {
    const rows = [];
    collection.forEach((it) => {
      const img = it.images?.small || '';
      rows.push({
        liste: 'collection',
        id: it.id,
        name: it.name,
        nummer: it.number || '',
        set: it.set?.name || '',
        set_id: it.set?.id || '',
        set_gesamt: it.set?.total ?? '',
        anzahl: qtyOf(it),
        zustand: it.userCondition || '',
        sprache: it.userLanguage || '',
        variante: it.userVariant || 'normal',
        preis: comma(it.userPrice),
        preis_manuell: !it.isCustom && !isAutoPrice(it) ? 'ja' : '',
        einkaufspreis: comma(it.userPurchasePrice),
        verkauf: it.forSale ? 'ja' : '',
        zielpreis: '',
        alarm_hoch: comma(it.alertHigh),
        bewertung: gradeText(it),
        bild: /^https?:/.test(img) ? img : '',
        hinzugefuegt: it.addedAt || ''
      });
    });
    watchlist.forEach((it) => {
      const img = it.images?.small || '';
      rows.push({
        liste: 'watchlist',
        id: it.id,
        name: it.name,
        nummer: it.number || '',
        set: it.set?.name || '',
        set_id: it.set?.id || '',
        set_gesamt: it.set?.total ?? '',
        zielpreis: comma(it.targetPrice),
        alarm_hoch: comma(it.targetHigh),
        bild: /^https?:/.test(img) ? img : '',
        hinzugefuegt: it.addedAt || ''
      });
    });
    if (rows.length === 0) { setMsg('Es gibt noch nichts zu exportieren.'); return; }
    downloadText(`poketracker-backup-${today()}.csv`, toCsv(rows, COLS));
    setMsg(`${collection.length} Collection-Einträge und ${watchlist.length} Watchlist-Karten exportiert. Eigene Fotos sind nicht enthalten.`);
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setMsg(''); setPlan(null);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0 || !rows.some((r) => r.id)) { setMsg('Die Datei enthält keine lesbaren Karten (Spalte „id“ fehlt).'); return; }
      const have = new Set(collection.map((c) => itemKey(c.id, c.userCondition || 'Near Mint', c.userLanguage || 'Deutsch 🇩🇪', c.userVariant || 'normal')));
      const haveWatch = new Set(watchlist.map((c) => c.id));
      const coll = []; const watch = [];
      let skipped = 0; let invalid = 0;
      rows.forEach((r) => {
        if (!r.id) { invalid += 1; return; }
        const list = String(r.liste || 'collection').toLowerCase();
        if (list.startsWith('watch')) {
          if (!isReal(r.id) || haveWatch.has(r.id)) { skipped += 1; return; }
          haveWatch.add(r.id); watch.push(r);
        } else {
          const cond = matchName(r.zustand, conditions, 'Near Mint');
          const lang = matchName(r.sprache, languages, 'Deutsch 🇩🇪');
          const key = itemKey(r.id, cond, lang, normVariant(r.variante));
          if (have.has(key)) { skipped += 1; return; }
          have.add(key); coll.push(r);
        }
      });
      setPlan({ coll, watch, skipped, invalid });
    } catch (err) {
      setMsg('Datei konnte nicht gelesen werden: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const run = async () => {
    const uid = auth.currentUser?.uid;
    if (!plan || !uid || busy) return;
    setBusy(true); setMsg('');
    try {
      const realIds = [...new Set([...plan.coll, ...plan.watch].map((r) => r.id).filter((id) => isReal(id)))];
      const full = {};
      let loadFailed = 0;
      for (let i = 0; i < realIds.length; i += 30) {
        setProgress(`Lade Kartendaten … ${Math.min(i + 30, realIds.length)} / ${realIds.length}`);
        const ids = realIds.slice(i, i + 30);
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 120000);
          const res = await fetch(`${api}/api/cards/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ids }) });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`Status ${res.status}`);
          ((await res.json()).cards || []).forEach((c) => { full[c.id] = c; });
        } catch (err) { loadFailed += ids.length; }
      }
      const base = (r) => {
        const f = full[r.id];
        if (!f) return minimalCard(r);
        const c = { ...f };
        delete c.docId; delete c.instanceId;
        return c;
      };

      setProgress('Schreibe Karten …');
      let batch = writeBatch(db);
      let ops = 0;
      const flush = async () => { if (ops > 0) { await batch.commit(); batch = writeBatch(db); ops = 0; } };

      for (const r of plan.coll) {
        const card = base(r);
        const cond = matchName(r.zustand, conditions, 'Near Mint');
        const lang = matchName(r.sprache, languages, 'Deutsch 🇩🇪');
        const variant = normVariant(r.variante);
        const grade = parseGrade(r.bewertung);
        const csvPrice = money(r.preis);
        let price;
        if (card.isCustom) price = csvPrice ?? '0.00';
        else if (!yes(r.preis_manuell) && full[r.id]) {
          const calc = calculatePrice(card, cond, lang, variant, grade);
          price = parseFloat(calc) > 0 ? calc : (csvPrice ?? calc);
        } else price = csvPrice ?? calculatePrice(card, cond, lang, variant, grade);
        batch.set(doc(fsCollection(db, 'users', uid, 'collection')), {
          ...card,
          userCondition: cond,
          userLanguage: lang,
          userVariant: variant,
          userPrice: price,
          userQuantity: Math.max(1, parseInt(r.anzahl, 10) || 1),
          userPurchasePrice: money(r.einkaufspreis),
          forSale: yes(r.verkauf),
          userGrade: grade,
          alertHigh: num(r.alarm_hoch) > 0 ? num(r.alarm_hoch) : null,
          customImage: null,
          addedAt: Number(r.hinzugefuegt) || Date.now()
        });
        ops += 1;
        if (ops >= 400) await flush();
      }
      for (const r of plan.watch) {
        const target = num(r.zielpreis);
        batch.set(doc(db, 'users', uid, 'watchlist', r.id), {
          ...base(r),
          ...(target && target > 0 ? { targetPrice: target } : {}),
          ...(num(r.alarm_hoch) > 0 ? { targetHigh: num(r.alarm_hoch) } : {}),
          addedAt: Number(r.hinzugefuegt) || Date.now()
        });
        ops += 1;
        if (ops >= 400) await flush();
      }
      await flush();
      setMsg(`Import fertig: ${plan.coll.length} Collection-Karten und ${plan.watch.length} Watchlist-Karten hinzugefügt. ✓`
        + (loadFailed ? ` Für ${loadFailed} Karten konnten keine aktuellen Daten geladen werden (Server schläft?) – sie wurden mit den Daten aus der CSV angelegt; „Preise aktualisieren“ holt die Preise nach.` : ''));
      setPlan(null);
    } catch (err) {
      console.error(err);
      setMsg('Import fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler') + ' – ein erneuter Import überspringt bereits vorhandene Karten.');
    } finally {
      setBusy(false); setProgress('');
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
      <h3 className="font-bold text-slate-100 text-sm">💾 Backup (CSV)</h3>
      <p className="text-[11px] text-slate-400">Sichert Collection und Watchlist in einer Datei, die sich auch in Excel öffnen lässt. Eigene Fotos sind nicht enthalten. Beim Import werden Karten übersprungen, die es schon gibt (gleiche Karte, Zustand, Sprache und Variante).</p>
      <div className="flex gap-2">
        <button onClick={exportCsv} disabled={busy} className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black text-xs py-2.5 rounded-lg">⬇️ Exportieren</button>
        <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy} className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-300 border border-cyan-500/30 font-bold text-xs py-2.5 rounded-lg">⬆️ Importieren</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onFile} />
      </div>
      {plan && (
        <div className="bg-slate-950 border border-cyan-500/30 rounded-lg p-3 space-y-2 text-xs text-slate-300">
          <p><span className="font-bold text-cyan-300">{plan.coll.length}</span> Collection-Einträge und <span className="font-bold text-cyan-300">{plan.watch.length}</span> Watchlist-Karten werden hinzugefügt.</p>
          {(plan.skipped > 0 || plan.invalid > 0) && <p className="text-slate-500">{plan.skipped} übersprungen (schon vorhanden){plan.invalid > 0 ? `, ${plan.invalid} Zeilen ohne ID ignoriert` : ''}.</p>}
          <div className="flex gap-2">
            <button onClick={() => setPlan(null)} disabled={busy} className="flex-1 bg-slate-800 text-slate-300 font-bold py-2 rounded-lg disabled:opacity-50">Abbrechen</button>
            <button onClick={run} disabled={busy || (plan.coll.length + plan.watch.length === 0)} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black py-2 rounded-lg disabled:opacity-50">{busy ? `⏳ ${progress || 'Läuft …'}` : 'Import starten'}</button>
          </div>
        </div>
      )}
      {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Watchlist als Cardmarket-Wantlist
// ---------------------------------------------------------------------
export function WantlistExport({ watchlist, api }) {
  const [open, setOpen] = useState(false);
  const [withSet, setWithSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState(null);
  const [msg, setMsg] = useState('');

  const lookup = async () => {
    setBusy(true); setMsg('');
    try {
      const ids = watchlist.map((c) => c.id).filter((id) => isReal(id) && !String(id).startsWith('cm-'));
      const out = {};
      for (let i = 0; i < ids.length; i += 100) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 90000);
        const res = await fetch(`${api}/api/wantlist-names`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ids: ids.slice(i, i + 100) }) });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Server antwortet mit Status ${res.status}`);
        Object.assign(out, (await res.json()).names || {});
      }
      setNames(out);
    } catch (e) {
      setNames({});
      setMsg(e.name === 'AbortError'
        ? 'Der Server hat nicht geantwortet – es wurden die gespeicherten (evtl. deutschen) Namen verwendet. Später nochmal versuchen für englische Namen.'
        : 'Englische Namen konnten nicht geladen werden – es wurden die gespeicherten Namen verwendet.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && names === null && watchlist.length > 0) await lookup();
  };

  const text = useMemo(() => {
    if (!names) return '';
    const rows = watchlist.map((c) => {
      const n = names[c.id];
      const isCm = String(c.id).startsWith('cm-');
      let name = n?.name || (isCm ? String(c.name || '') : plain(c.name));
      const extra = n ? [...(n.abilities || []), ...(n.attacks || [])] : [];
      if (extra.length) name = `${name} ${extra.join(' ')}`;
      else if (isCm) { const m = name.match(/^([^\[']*?)\s*\[(.*)\]\s*$/); if (m) name = `${m[1]} ${m[2].split('|').map((a) => a.trim()).join(' ')}`; }
      const rawSet = n?.set || c.set?.name || '';
      const set = /^Cardmarket-Set /.test(rawSet) ? '' : rawSet;
      return { name, set };
    }).filter((r) => r.name);
    rows.sort((a, b) => a.set.localeCompare(b.set) || a.name.localeCompare(b.name));
    return rows.map((r) => `1x ${r.name}${withSet && r.set ? ` (${r.set})` : ''}`).join('\n');
  }, [names, watchlist, withSet]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('Kopiert. ✓ Auf Cardmarket: Wants Lists → Liste öffnen → „Add Deck List“ → einfügen.'); }
    catch (e) { window.prompt('Zum Kopieren markieren:', text); }
  };

  if (watchlist.length === 0) return null;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
      <button onClick={toggle} className="w-full flex items-center justify-between text-left">
        <span className="text-sm font-bold text-slate-100">📤 Als Cardmarket-Wantlist exportieren</span>
        <span className="text-xs text-cyan-400">{open ? 'Schließen' : 'Öffnen'}</span>
      </button>
      {open && (
        <div className="space-y-2">
          {busy && <p className="text-xs text-cyan-400 animate-pulse">Hole englische Namen … (Server braucht evtl. bis zu einer Minute)</p>}
          {!busy && names && (
            <>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={withSet} onChange={(e) => setWithSet(e.target.checked)} className="accent-cyan-500" />
                Set-Name in Klammern anhängen (genauer, aber Cardmarket muss die Schreibweise kennen)
              </label>
              <textarea readOnly value={text} rows={Math.min(12, text.split('\n').length + 1)} className="w-full bg-slate-950 border border-slate-800 text-slate-300 rounded-lg p-2 text-xs font-mono outline-none" />
              <div className="flex gap-2">
                <button onClick={copy} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs py-2 rounded-lg">Kopieren</button>
                <button onClick={() => downloadText(`wantlist-${today()}.txt`, text + '\n', 'text/plain;charset=utf-8')} className="flex-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 font-bold text-xs py-2 rounded-lg">Als .txt speichern</button>
              </div>
              <p className="text-[10px] text-slate-500">Auf Cardmarket meldet der Import Zeilen, die er nicht zuordnen konnte – dann die Option „Set-Name“ ausschalten und erneut einfügen.</p>
            </>
          )}
          {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
        </div>
      )}
    </div>
  );
}