// Komplettierungs-Kosten: "Was kostet es, die fehlenden Karten zu besorgen?"
// + Knopf "Alle in die Wishlist". Wird für Sets (SetsView) und Binder benutzt.
import React, { useState, useEffect, useMemo } from 'react';
import { collection as fsCollection, onSnapshot, writeBatch, doc } from 'firebase/firestore';
import { db } from './firebase';
import { fetchPrices, watchPrice } from './priceData';

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const isReal = (id) => !!id && !String(id).startsWith('custom-');

// Kleiner Preis-Zwischenspeicher: Firestore-/Backend-Preise werden pro Karte 30 Min. gemerkt,
// damit z. B. "alle Binder" und danach ein einzelner Binder nicht noch einmal laden.
const memo = new Map(); // id -> { at, data }
const MEMO_TTL_MS = 30 * 60 * 1000;

async function pricesFor(ids, api, onProgress) {
  const now = Date.now();
  const out = {};
  const need = [];
  ids.forEach((id) => {
    const hit = memo.get(id);
    if (hit && now - hit.at < MEMO_TTL_MS) out[id] = hit.data; else need.push(id);
  });
  const cached = ids.length - need.length;
  if (onProgress) onProgress(cached, ids.length);
  if (need.length > 0) {
    const got = await fetchPrices(need, api, { onProgress: (d) => onProgress && onProgress(cached + d, ids.length) });
    need.forEach((id) => {
      if (got[id]) { memo.set(id, { at: now, data: got[id] }); out[id] = got[id]; }
    });
  }
  return out;
}

// cards: [{ id, name, image, localId, setName }] – die Karten, die noch fehlen
export function CompletionPanel({ title, hint, cards, api, uid, watchIds, Img }) {
  const list = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const c of cards || []) {
      if (!c || !isReal(c.id) || seen.has(c.id)) continue;
      seen.add(c.id); out.push(c);
    }
    return out;
  }, [cards]);
  const sig = list.map((c) => c.id).join('|');

  const [prices, setPrices] = useState(null);
  const [busy, setBusy] = useState(''); // '' | 'calc' | 'wish'
  const [progress, setProgress] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { setPrices(null); setMsg(''); }, [sig]);

  const rows = useMemo(
    () => (prices ? list.map((c) => ({ ...c, price: watchPrice(prices[c.id]?.prices) })) : []),
    [prices, list]
  );
  const total = rows.reduce((s, r) => s + r.price, 0);
  const unknown = rows.filter((r) => !(r.price > 0)).length;
  const top = [...rows].sort((a, b) => b.price - a.price).slice(0, 10);
  const toAdd = list.filter((c) => !watchIds.has(c.id));

  const calc = async () => {
    if (busy) return;
    setBusy('calc'); setMsg(''); setProgress(`0 / ${list.length}`);
    try {
      const got = await pricesFor(list.map((c) => c.id), api, (d, t) => setProgress(`${d} / ${t}`));
      setPrices(got);
    } catch (e) {
      setMsg(e.name === 'AbortError'
        ? 'Der Server hat zu lange nicht geantwortet (Render schläft evtl.). Bitte in ca. 1 Minute nochmal versuchen.'
        : 'Preise konnten nicht geladen werden: ' + (e.message || 'Unbekannter Fehler'));
    } finally {
      setBusy(''); setProgress('');
    }
  };

  const addAll = async () => {
    if (busy || !uid || toAdd.length === 0) return;
    if (!window.confirm(`${toAdd.length} Karten zur Watchlist hinzufügen?`)) return;
    setBusy('wish'); setMsg('');
    let added = 0; let failed = 0;
    try {
      for (let i = 0; i < toAdd.length; i += 30) {
        setProgress(`Lade Kartendaten … ${Math.min(i + 30, toAdd.length)} / ${toAdd.length}`);
        const ids = toAdd.slice(i, i + 30).map((c) => c.id);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        const res = await fetch(`${api}/api/cards/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ ids })
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Server antwortet mit Status ${res.status}`);
        const full = (await res.json()).cards || [];
        failed += ids.length - full.length;
        const batch = writeBatch(db);
        const now = Date.now();
        full.forEach((card) => batch.set(doc(db, 'users', uid, 'watchlist', card.id), { ...card, addedAt: now }));
        if (full.length > 0) await batch.commit();
        added += full.length;
      }
      setMsg(`${added} Karten stehen jetzt auf der Watchlist. ★` + (failed ? ` ${failed} konnten nicht geladen werden.` : ''));
    } catch (e) {
      const part = added > 0 ? ` (${added} wurden schon hinzugefügt)` : '';
      setMsg('Fehlgeschlagen: ' + (e.name === 'AbortError' ? 'Server hat zu lange nicht geantwortet' : (e.message || 'Unbekannter Fehler')) + part);
    } finally {
      setBusy(''); setProgress('');
    }
  };

  if (list.length === 0) return null;

  return (
    <div className="bg-slate-950 border border-cyan-500/30 rounded-xl p-3 space-y-3 mb-3">
      {title && <h4 className="text-sm font-bold text-slate-100">{title}</h4>}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}

      {prices ? (
        <div className="space-y-2">
          <div className="flex justify-between items-end gap-2">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Kosten bis komplett</p>
              <p className="text-2xl font-black text-cyan-300">{eur(total)}</p>
            </div>
            <p className="text-[11px] text-slate-400 text-right">
              {list.length} Karten (Cardmarket-Trend)
              {unknown > 0 && <><br /><span className="text-amber-300">{unknown} ohne Preis</span></>}
            </p>
          </div>
          {top.length > 0 && top[0].price > 0 && (
            <div className="space-y-1 pt-2 border-t border-slate-800">
              <p className="text-[10px] text-slate-500">Teuerste fehlende Karten</p>
              {top.filter((r) => r.price > 0).map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  {Img && <Img src={r.image} alt={r.name} className="w-7 rounded" />}
                  <span className="flex-1 min-w-0 truncate text-slate-300">
                    {r.name}{r.localId ? <span className="text-slate-500"> #{r.localId}</span> : null}
                    {r.setName ? <span className="text-slate-500"> · {r.setName}</span> : null}
                  </span>
                  <span className="text-cyan-400 font-bold whitespace-nowrap">{eur(r.price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">{list.length} Karten fehlen. Die Kosten werden aus den aktuellen Cardmarket-Trends berechnet.</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={calc}
          disabled={!!busy}
          className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-black py-2.5 rounded-lg transition-colors"
        >
          {busy === 'calc' ? `⏳ ${progress}` : prices ? '🔄 Neu berechnen' : '💶 Kosten berechnen'}
        </button>
        <button
          onClick={addAll}
          disabled={!!busy || toAdd.length === 0}
          className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-cyan-300 border border-cyan-500/30 text-xs font-black py-2.5 rounded-lg transition-colors"
        >
          {busy === 'wish' ? `⏳ ${progress}` : toAdd.length === 0 ? '★ Alle schon auf der Wishlist' : `★ Alle in die Wishlist (${toAdd.length})`}
        </button>
      </div>
      {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
    </div>
  );
}

// Karten, die in Bindern liegen, aber noch nicht in der Collection sind ("noch nicht gekauft").
export function BinderCompletion({ uid, collection, watchIds, api, Img }) {
  const [binders, setBinders] = useState(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      fsCollection(db, 'users', uid, 'binders'),
      (snap) => { setBinders(snap.docs.map((d) => ({ ...d.data(), id: d.id }))); setDenied(false); },
      (err) => { console.warn('Binder nicht lesbar:', err.code); setDenied(true); setBinders([]); }
    );
  }, [uid]);

  const owned = useMemo(() => new Set(collection.map((c) => String(c.id))), [collection]);

  const groups = useMemo(() => (binders || []).map((b, i) => {
    const seen = new Set();
    const cards = [];
    Object.values(b.slots || {}).forEach((s) => {
      const id = s && s.id ? String(s.id) : '';
      if (!isReal(id) || owned.has(id) || seen.has(id)) return;
      seen.add(id);
      cards.push({
        id,
        name: s.name || id,
        image: s.customImage || s.image || (s.images && s.images.small) || '',
        localId: s.localId || s.number || '',
        setName: s.setName || (s.set && s.set.name) || ''
      });
    });
    return { id: b.id, name: b.name || b.title || `Binder ${i + 1}`, cards };
  }).filter((g) => g.cards.length > 0), [binders, owned]);

  const all = useMemo(() => {
    const seen = new Set();
    const out = [];
    groups.forEach((g) => g.cards.forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } }));
    return out;
  }, [groups]);

  if (binders === null) return null;
  if (denied) return null; // ohne Leserechte gar nichts anzeigen
  if (groups.length === 0) return null;

  return (
    <details className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md">
      <summary className="cursor-pointer text-sm font-bold text-slate-200">
        💶 Noch nicht gekaufte Binder-Karten ({all.length}) – Kosten &amp; Wishlist
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[10px] text-slate-500">Karten, die in einem Binder liegen, aber (noch) nicht in deiner Collection sind.</p>
        {groups.length > 1 && (
          <CompletionPanel
            title="Alle Binder zusammen"
            cards={all}
            api={api}
            uid={uid}
            watchIds={watchIds}
            Img={Img}
          />
        )}
        {groups.map((g) => (
          <details key={g.id} className="bg-slate-950 border border-slate-800 rounded-lg p-2">
            <summary className="cursor-pointer text-xs font-bold text-slate-300">
              {g.name} <span className="text-slate-500 font-normal">· {g.cards.length} fehlen</span>
            </summary>
            <div className="mt-2">
              <CompletionPanel cards={g.cards} api={api} uid={uid} watchIds={watchIds} Img={Img} />
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}
