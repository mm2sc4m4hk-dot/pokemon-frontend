// Zwei Werkzeuge:
//  - BudgetPlanner: „Ich habe X € – welche Wunschlisten-Karten kaufe ich zuerst?“ (Watchlist-Tab)
//  - DataQualityCheck: findet Karten ohne Preis/Bild, Ausreißer, Dubletten, Alarm-Reste ... (Profil-Tab)
// Eigene Datei, damit App.jsx nicht noch größer wird. Importiert nichts aus App.jsx (kein Zirkelbezug).
import React, { useState, useEffect, useMemo } from 'react';
import { doc, updateDoc, deleteDoc, writeBatch, deleteField } from 'firebase/firestore';
import { db } from './firebase';
import { watchPrice, outlierOf } from './priceData';
import { OutlierBadge } from './Insights';

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const plain = (name) => String(name || '').replace(/\s*\[.*\]\s*$/, '');
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const qtyOf = (it) => Math.max(1, parseInt(it?.userQuantity, 10) || 1);
const loadSetting = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; } };
const saveSetting = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* egal */ } };
const hasPrice = (p = {}) => (p.trendPrice || p.averageSellPrice || p.trendPriceHolo || p.avg1Holo || 0) > 0;
const isHoloVariant = (v) => v === 'reverse' || v === 'holo';

const inputCls = 'bg-slate-950 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-md px-2 py-1.5 text-xs outline-none';
const pill = (active) => `text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`;

// ---------------------------------------------------------------------
// Budget-Modus
// ---------------------------------------------------------------------
const STRATEGIES = [
  ['priority', 'Wichtigste zuerst', 'Nach deinen Sternen, bei Gleichstand die günstigere Karte.'],
  ['cheap', 'Möglichst viele', 'Günstigste zuerst – so kommen die meisten Karten zusammen.'],
  ['deals', 'Zielpreis erreicht zuerst', 'Karten unter deinem Zielpreis zuerst, dann nach Sternen.']
];

function Stars({ value, onSet }) {
  return (
    <span className="inline-flex" role="group" aria-label="Priorität">
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          onClick={() => onSet(n)}
          title={`Priorität ${n}`}
          className={`text-sm leading-none px-0.5 ${n <= value ? 'text-amber-300' : 'text-slate-700 hover:text-slate-500'}`}
        >★</button>
      ))}
    </span>
  );
}

export function BudgetPlanner({ watchlist, uid, Img }) {
  const [open, setOpen] = useState(false);
  const [budget, setBudget] = useState(() => loadSetting('wishBudget', '50'));
  const [strat, setStrat] = useState(() => loadSetting('wishBudgetStrat', 'priority'));
  const [skip, setSkip] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { saveSetting('wishBudget', budget); }, [budget]);
  useEffect(() => { saveSetting('wishBudgetStrat', strat); }, [strat]);

  const rows = useMemo(() => watchlist.map((c) => ({
    c,
    price: watchPrice(c.cardmarket && c.cardmarket.prices),
    prio: [1, 2, 3].includes(Number(c.priority)) ? Number(c.priority) : 2,
    target: parseFloat(c.targetPrice) || 0
  })), [watchlist]);

  const result = useMemo(() => {
    const total = Math.max(0, num(budget) || 0);
    const priced = rows.filter((r) => r.price > 0 && !skip.has(r.c.id));
    const dealOf = (r) => r.target > 0 && r.price <= r.target;
    const order = {
      priority: (a, b) => b.prio - a.prio || a.price - b.price,
      cheap: (a, b) => a.price - b.price,
      deals: (a, b) => (dealOf(b) ? 1 : 0) - (dealOf(a) ? 1 : 0) || b.prio - a.prio || a.price - b.price
    }[strat];
    const sorted = [...priced].sort(order);
    let left = total;
    const picked = []; const rest = [];
    for (const r of sorted) {
      if (r.price <= left + 1e-9) { picked.push(r); left -= r.price; } else rest.push(r);
    }
    return {
      total, picked, rest, left: Math.max(0, left),
      spent: picked.reduce((s, r) => s + r.price, 0),
      unpriced: rows.filter((r) => !(r.price > 0)),
      excluded: rows.filter((r) => skip.has(r.c.id))
    };
  }, [rows, budget, strat, skip]);

  const setPrio = async (card, n) => {
    if (!uid) return;
    try { await updateDoc(doc(db, 'users', uid, 'watchlist', card.id), { priority: n }); }
    catch (e) { setMsg('Priorität konnte nicht gespeichert werden.'); }
  };

  const toggleSkip = (id) => setSkip((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const copy = async () => {
    const text = `Einkaufsliste (Budget ${eur(result.total)})\n`
      + result.picked.map((r) => `1x ${plain(r.c.name)}${r.c.set && r.c.set.name ? ` (${r.c.set.name})` : ''} – ${eur(r.price)}`).join('\n')
      + `\nSumme: ${eur(result.spent)} (ohne Porto)`;
    try { await navigator.clipboard.writeText(text); setMsg('Liste kopiert. ✓'); }
    catch (e) { window.prompt('Zum Kopieren markieren:', text); }
  };

  if (watchlist.length === 0) return null;

  const next = result.rest[0];
  const shown = showAll ? result.picked : result.picked.slice(0, 15);
  const strategyHint = (STRATEGIES.find((s) => s[0] === strat) || [])[2];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-sm font-bold text-slate-100">💰 Budget-Modus: Was kaufe ich zuerst?</span>
        <span className="text-xs text-cyan-400">{open ? 'Schließen' : 'Öffnen'}</span>
      </button>

      {open && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 items-end">
            <label className="block text-[11px] text-slate-400">
              Mein Budget
              <div className="flex items-center gap-1 mt-1">
                <input type="number" min="0" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} className={`w-full ${inputCls}`} />
                <span className="text-xs text-slate-500">€</span>
              </div>
            </label>
            <p className="text-[10px] text-slate-500">Grundlage ist der Cardmarket-Trend. Porto ist nicht eingerechnet, plane dafür etwas Luft ein.</p>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {STRATEGIES.map(([k, l]) => <button key={k} onClick={() => setStrat(k)} className={pill(strat === k)}>{l}</button>)}
          </div>
          <p className="text-[10px] text-slate-500">{strategyHint}</p>

          <div className="bg-slate-950 border border-cyan-500/30 rounded-lg px-3 py-2 flex items-baseline justify-between gap-3">
            <span className="text-xs text-slate-400">{result.picked.length} {result.picked.length === 1 ? 'Karte' : 'Karten'} im Budget</span>
            <span className="text-right">
              <span className="text-lg font-black text-cyan-300">{eur(result.spent)}</span>
              <span className="block text-[10px] text-slate-500">{eur(result.left)} übrig</span>
            </span>
          </div>

          {result.picked.length === 0 && (
            <p className="text-xs text-slate-500">Mit {eur(result.total)} passt keine Karte. Die günstigste kostet {result.rest.length ? eur(Math.min(...result.rest.map((r) => r.price))) : '–'}.</p>
          )}

          <div className="space-y-1.5">
            {shown.map((r) => (
              <div key={r.c.id} className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-1.5">
                {Img && <Img src={r.c.images && r.c.images.small} alt={r.c.name} className="w-8 rounded shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-200 truncate">{plain(r.c.name)}</p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {(r.c.set && r.c.set.name) || 'Unbekannt'}
                    {r.target > 0 && r.price <= r.target ? <span className="text-emerald-400 font-bold"> · unter Zielpreis</span> : null}
                  </p>
                  <OutlierBadge prices={r.c.cardmarket && r.c.cardmarket.prices} holo={false} />
                </div>
                <Stars value={r.prio} onSet={(n) => setPrio(r.c, n)} />
                <span className="text-xs font-bold text-cyan-300 w-14 text-right">{eur(r.price)}</span>
                <button onClick={() => toggleSkip(r.c.id)} title="Aus dem Plan nehmen" className="text-slate-600 hover:text-rose-400 px-1">✕</button>
              </div>
            ))}
          </div>
          {!showAll && result.picked.length > 15 && (
            <button onClick={() => setShowAll(true)} className="w-full text-xs font-bold text-cyan-400 border border-slate-700 rounded-lg py-1.5 hover:bg-slate-800">Alle {result.picked.length} anzeigen</button>
          )}

          {result.picked.length > 0 && (
            <button onClick={copy} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs py-2 rounded-lg">Einkaufsliste kopieren</button>
          )}

          {next && (
            <p className="text-[11px] text-slate-400">
              Nächste Karte wäre <span className="text-slate-200 font-bold">{plain(next.c.name)}</span> ({eur(next.price)}) – dafür fehlen {eur(next.price - result.left)}.
            </p>
          )}

          {result.rest.length > 1 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-400 hover:text-cyan-400 font-bold">Nicht im Budget ({result.rest.length})</summary>
              <ul className="mt-2 space-y-1">
                {result.rest.slice(0, 40).map((r) => (
                  <li key={r.c.id} className="flex items-center justify-between gap-2 text-slate-400">
                    <span className="truncate">{plain(r.c.name)} <span className="text-slate-600">· {(r.c.set && r.c.set.name) || '?'}</span></span>
                    <span className="whitespace-nowrap">{eur(r.price)} <span className="text-slate-600">(+{eur(r.price - result.left)})</span></span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {result.excluded.length > 0 && (
            <p className="text-[11px] text-slate-500">
              {result.excluded.length} aus dem Plan genommen:{' '}
              {result.excluded.map((r) => (
                <button key={r.c.id} onClick={() => toggleSkip(r.c.id)} className="underline hover:text-cyan-400 mr-1.5">{plain(r.c.name)} ↩</button>
              ))}
            </p>
          )}
          {result.unpriced.length > 0 && (
            <p className="text-[11px] text-amber-300">{result.unpriced.length} Karten ohne Cardmarket-Preis sind nicht im Plan (siehe Datenqualitäts-Check im Profil).</p>
          )}
          {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Datenqualitäts-Check
// ---------------------------------------------------------------------
const LEVEL = {
  error: { dot: 'bg-rose-500', text: 'text-rose-300', border: 'border-rose-500/40' },
  warn: { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-500/40' },
  info: { dot: 'bg-sky-400', text: 'text-sky-300', border: 'border-sky-500/30' }
};
const ROW_LIMIT = 25;

const label = (it) => {
  const g = it.userGrade && it.userGrade.company ? `${it.userGrade.company} ${it.userGrade.grade}` : it.userCondition;
  return {
    title: `${qtyOf(it) > 1 ? `${qtyOf(it)}× ` : ''}${plain(it.name)}`,
    sub: [it.set && it.set.name, it.number ? `#${it.number}` : null, g].filter(Boolean).join(' · ')
  };
};

export function DataQualityCheck({ collection, watchlist, uid, calculatePrice, isAutoPrice, onEdit }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [expanded, setExpanded] = useState({});

  const issues = useMemo(() => {
    const out = [];
    const add = (key, level, title, hint, rows) => { if (rows.length) out.push({ key, level, title, hint, rows }); };
    const coll = collection.filter((c) => c && c.docId);
    const real = coll.filter((c) => !c.isCustom);

    // --- Collection ---
    add('noValue', 'error', 'Karten ohne Wert (0 €)',
      'Zählen mit 0 € in deinen Collection-Wert. Preise aktualisieren oder einen eigenen Preis eintragen.',
      coll.filter((c) => !(num(c.userPrice) > 0)).map((c) => ({ id: c.docId, ...label(c), act: 'edit', item: c, btn: 'Bearbeiten' })));

    add('noMarket', 'warn', 'Kein Cardmarket-Preis gefunden',
      'Der Preis wird nicht automatisch aktualisiert. Trage selbst einen Preis ein oder prüfe, ob es die richtige Karte ist.',
      real.filter((c) => num(c.userPrice) > 0 && !hasPrice(c.cardmarket && c.cardmarket.prices))
        .map((c) => ({ id: c.docId, ...label(c), act: 'edit', item: c, btn: 'Bearbeiten' })));

    add('outlier', 'warn', 'Auffällige Preise (Ausreißer-Verdacht)',
      'Der Trend weicht stark vom 30-Tage-Schnitt oder vom günstigsten Angebot ab. Prüfe die echten Angebote, bevor du dich auf den Wert verlässt.',
      real.filter((c) => !c.userGrade).map((c) => ({ c, o: outlierOf(c.cardmarket && c.cardmarket.prices, isHoloVariant(c.userVariant)) }))
        .filter((x) => x.o)
        .map(({ c, o }) => ({ id: c.docId, ...label(c), sub2: o.text, act: 'edit', item: c, btn: 'Ansehen' })));

    add('priceOff', 'warn', 'Eigener Preis weicht stark vom Richtwert ab',
      'Mehr als dreimal so hoch oder dreimal so niedrig wie der berechnete Richtwert – vielleicht ein Tippfehler.',
      real.filter((c) => !c.userGrade && !isAutoPrice(c)).map((c) => {
        const est = parseFloat(calculatePrice(c, c.userCondition, c.userLanguage, c.userVariant || 'normal', c.userGrade));
        const mine = num(c.userPrice);
        return { c, est, mine };
      }).filter((x) => x.est > 0 && x.mine > 0 && (x.mine / x.est > 3 || x.mine / x.est < 1 / 3))
        .map(({ c, est, mine }) => ({ id: c.docId, ...label(c), sub2: `Dein Preis ${eur(mine)} · Richtwert ${eur(est)}`, act: 'edit', item: c, btn: 'Bearbeiten' })));

    add('noImage', 'warn', 'Karten ohne Bild',
      'Es gibt weder ein Bild aus der Datenbank noch ein eigenes Foto.',
      coll.filter((c) => !(c.images && c.images.small) && !c.customImage)
        .map((c) => ({ id: c.docId, ...label(c), act: 'edit', item: c, btn: 'Foto hinzufügen' })));

    add('gradedAlert', 'warn', 'Preis-Alarm bei gegradeten Karten',
      'Für gegradete Karten schickt der Server keinen Alarm (er kennt nur Rohpreise). Die Grenze ist wirkungslos.',
      coll.filter((c) => c.userGrade && c.userGrade.company && num(c.alertHigh) > 0)
        .map((c) => ({ id: c.docId, ...label(c), sub2: `Alarm ab ${eur(num(c.alertHigh))}`, act: 'clearAlert', item: c, btn: 'Alarm entfernen' })));

    // Dubletten: gleiche Karte, Zustand, Sprache, Variante und Grading
    const groups = new Map();
    coll.forEach((c) => {
      const g = c.userGrade && c.userGrade.company ? `${c.userGrade.company}${c.userGrade.grade}` : '';
      const k = [c.id, c.userCondition || '', c.userLanguage || '', c.userVariant || 'normal', g].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    });
    add('dupes', 'warn', 'Doppelte Einträge',
      'Dieselbe Karte mit gleichem Zustand, gleicher Sprache und Variante steht mehrfach da. Zusammenführen addiert die Stückzahl.',
      [...groups.values()].filter((l) => l.length > 1).map((l) => {
        const buys = l.map((c) => num(c.userPurchasePrice));
        const same = buys.every((b) => b === buys[0]) || buys.every((b) => b === null);
        const lb = label(l[0]);
        return {
          id: l[0].docId, title: `${l.length}× ${plain(l[0].name)}`, sub: lb.sub,
          sub2: same ? `Zusammen ${l.reduce((s, c) => s + qtyOf(c), 0)} Stück` : 'Unterschiedliche Einkaufspreise – bitte von Hand zusammenführen',
          act: same ? 'merge' : 'edit', docs: l, item: l[0], btn: same ? 'Zusammenführen' : 'Bearbeiten'
        };
      }));

    add('noSet', 'info', 'Karten ohne Set-Zuordnung',
      'Diese Karten fehlen in der Set-Ansicht und im „Wert pro Set“.',
      real.filter((c) => !(c.set && c.set.name)).map((c) => ({ id: c.docId, ...label(c), act: 'edit', item: c, btn: 'Bearbeiten' })));

    add('noBuy', 'info', 'Einkaufspreis fehlt',
      'Ohne Einkaufspreis gibt es für diese Karten keine Gewinn-/Verlustrechnung. Reine Hinweisliste, kein Fehler.',
      coll.filter((c) => num(c.userPurchasePrice) === null).map((c) => ({ id: c.docId, ...label(c), act: 'edit', item: c, btn: 'Bearbeiten' })));

    // --- Watchlist ---
    const owned = new Set(coll.map((c) => String(c.id)));
    const wl = watchlist.filter((c) => c && c.id);
    add('wNoPrice', 'warn', 'Watchlist: Karten ohne Cardmarket-Preis',
      'Hier kann weder ein Zielpreis-Alarm noch der Budget-Modus funktionieren.',
      wl.filter((c) => !hasPrice(c.cardmarket && c.cardmarket.prices))
        .map((c) => ({ id: c.id, title: plain(c.name), sub: (c.set && c.set.name) || '', act: 'removeWatch', item: c, btn: 'Entfernen' })));

    add('wOwned', 'info', 'Watchlist: Karte hast du schon',
      'Diese Karten liegen bereits in deiner Collection (in irgendeiner Variante) und blockieren Platz auf der Wunschliste.',
      wl.filter((c) => owned.has(String(c.id)))
        .map((c) => ({ id: c.id, title: plain(c.name), sub: (c.set && c.set.name) || '', act: 'removeWatch', item: c, btn: 'Entfernen' })));

    add('wTarget', 'warn', 'Watchlist: Zielpreis unrealistisch',
      'Zielpreis unter 30 % des aktuellen Preises oder Alarm-Grenze nicht über dem Zielpreis.',
      wl.map((c) => {
        const cur = watchPrice(c.cardmarket && c.cardmarket.prices);
        const t = parseFloat(c.targetPrice) || 0;
        const h = parseFloat(c.targetHigh) || 0;
        if (t > 0 && cur > 0 && t < cur * 0.3) return { c, why: `Ziel ${eur(t)} bei aktuell ${eur(cur)}`, act: 'clearTarget', btn: 'Zielpreis löschen' };
        if (t > 0 && h > 0 && h <= t) return { c, why: `Alarm ab ${eur(h)} liegt unter dem Ziel ${eur(t)}`, act: 'clearHigh', btn: 'Alarm löschen' };
        return null;
      }).filter(Boolean)
        .map(({ c, why, act, btn }) => ({ id: c.id, title: plain(c.name), sub: (c.set && c.set.name) || '', sub2: why, act, item: c, btn })));

    return out;
  }, [collection, watchlist, calculatePrice, isAutoPrice]);

  const errors = issues.filter((i) => i.level === 'error').reduce((s, i) => s + i.rows.length, 0);
  const warns = issues.filter((i) => i.level === 'warn').reduce((s, i) => s + i.rows.length, 0);
  const infos = issues.filter((i) => i.level === 'info').reduce((s, i) => s + i.rows.length, 0);

  // ---- Reparaturen ----
  const runOne = async (row) => {
    if (!uid) return;
    const it = row.item;
    if (row.act === 'edit') { onEdit && onEdit(it); return; }
    if (row.act === 'clearAlert') {
      await updateDoc(doc(db, 'users', uid, 'collection', it.docId), { alertHigh: null, alertedHigh: deleteField() });
    } else if (row.act === 'removeWatch') {
      await deleteDoc(doc(db, 'users', uid, 'watchlist', it.id));
    } else if (row.act === 'clearTarget') {
      await updateDoc(doc(db, 'users', uid, 'watchlist', it.id), { targetPrice: null, alertedTarget: deleteField() });
    } else if (row.act === 'clearHigh') {
      await updateDoc(doc(db, 'users', uid, 'watchlist', it.id), { targetHigh: null, alertedHigh: deleteField() });
    } else if (row.act === 'merge') {
      const docs = [...row.docs].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
      const keep = docs[0];
      const patch = { userQuantity: docs.reduce((s, c) => s + qtyOf(c), 0) };
      if (docs.some((c) => c.forSale)) patch.forSale = true;
      if (!keep.customImage) { const img = docs.find((c) => c.customImage); if (img) patch.customImage = img.customImage; }
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', uid, 'collection', keep.docId), patch);
      docs.slice(1).forEach((c) => batch.delete(doc(db, 'users', uid, 'collection', c.docId)));
      await batch.commit();
    }
  };

  const guard = async (fn, okMsg) => {
    setBusy(true); setMsg('');
    try { await fn(); if (okMsg) setMsg(okMsg); }
    catch (e) { setMsg('Fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler')); }
    finally { setBusy(false); }
  };

  const fixable = (issue) => issue.rows.filter((r) => r.act !== 'edit');
  const fixAll = (issue) => {
    const list = fixable(issue);
    if (!list.length || !window.confirm(`${list.length} Einträge automatisch korrigieren?`)) return;
    guard(async () => { for (const r of list) await runOne(r); }, `${list.length} Einträge korrigiert. ✓`);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-bold text-slate-100 text-sm">🩺 Datenqualitäts-Check</span>
        <span className="text-xs">
          {issues.length === 0
            ? <span className="text-emerald-400 font-bold">✓ alles sauber</span>
            : (
              <span className="font-bold">
                {errors > 0 && <span className="text-rose-300 mr-2">{errors} Fehler</span>}
                {warns > 0 && <span className="text-amber-300 mr-2">{warns} Hinweise</span>}
                {infos > 0 && <span className="text-sky-300">{infos} Infos</span>}
              </span>
            )}
          <span className="text-cyan-400 ml-3">{open ? 'Schließen' : 'Öffnen'}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-2">
          {issues.length === 0 && <p className="text-xs text-slate-400">Keine Auffälligkeiten in Collection und Watchlist gefunden.</p>}
          {issues.map((issue) => {
            const lv = LEVEL[issue.level];
            const all = !!expanded[issue.key];
            const rows = all ? issue.rows : issue.rows.slice(0, ROW_LIMIT);
            const fx = fixable(issue);
            return (
              <details key={issue.key} className={`bg-slate-950 border ${lv.border} rounded-lg p-2.5`} open={issue.level === 'error'}>
                <summary className="cursor-pointer flex items-center gap-2 text-xs font-bold text-slate-200">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${lv.dot}`} />
                  <span className="flex-1">{issue.title}</span>
                  <span className={lv.text}>{issue.rows.length}</span>
                </summary>
                <p className="text-[11px] text-slate-400 mt-2">{issue.hint}</p>
                {fx.length > 1 && (
                  <button disabled={busy} onClick={() => fixAll(issue)} className="mt-2 text-[11px] font-black px-3 py-1 rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950">
                    Alle {fx.length} automatisch korrigieren
                  </button>
                )}
                <ul className="mt-2 space-y-1.5">
                  {rows.map((r) => (
                    <li key={`${issue.key}-${r.id}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0">
                        <span className="block truncate text-slate-200">{r.title}</span>
                        <span className="block truncate text-[10px] text-slate-500">{r.sub}</span>
                        {r.sub2 && <span className={`block text-[10px] ${lv.text}`}>{r.sub2}</span>}
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => (r.act === 'edit' ? runOne(r) : guard(() => runOne(r)))}
                        className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-md border bg-slate-900 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500 hover:text-slate-950 disabled:opacity-50"
                      >{r.btn}</button>
                    </li>
                  ))}
                </ul>
                {!all && issue.rows.length > ROW_LIMIT && (
                  <button onClick={() => setExpanded((e) => ({ ...e, [issue.key]: true }))} className="mt-2 text-[11px] font-bold text-cyan-400 hover:underline">
                    Alle {issue.rows.length} anzeigen
                  </button>
                )}
              </details>
            );
          })}
          {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
        </div>
      )}
    </div>
  );
}
