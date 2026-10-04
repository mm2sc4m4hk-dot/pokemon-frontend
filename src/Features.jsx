// Neue Funktionen: „Wenn ich alles verkaufe“-Rechner, Portfolio-Aufteilung,
// Verkaufshistorie (inkl. „Verkauft“-Dialog) und der Hinweis auf neue Sets.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection as fsCollection, doc, onSnapshot, writeBatch, deleteDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { toCsv, downloadText } from './csvTools';
import { HBars } from './Extras';
import { CompletionPanel } from './Completion';
import { OutlierBadge } from './Insights';
import { watchPrice, outlierOf } from './priceData';

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const signedEur = (n) => `${n >= 0 ? '+' : '−'}${eur(Math.abs(n))}`;
const plain = (name) => String(name || '').replace(/\s*\[.*\]\s*$/, '');
const qtyOf = (it) => Math.max(1, parseInt(it?.userQuantity, 10) || 1);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const loadSetting = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; } };
const saveSetting = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* egal */ } };
const VARIANT_LABEL = { normal: 'Normal', reverse: 'Reverse Holo', holo: 'Holo', firstEdition: '1st Edition' };

function NumField({ label, value, onChange, step = 'any', suffix }) {
  return (
    <label className="block text-[11px] text-slate-400">
      {label}
      <div className="flex items-center gap-1 mt-1">
        <input type="number" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm focus:border-cyan-500 outline-none" />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
    </label>
  );
}

const pill = (active) => `text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`;

// ---------------------------------------------------------------------
// „Wenn ich alles verkaufe“
// ---------------------------------------------------------------------
export function SellAllCalculator({ collection }) {
  const [scope, setScope] = useState('all');
  const [factor, setFactor] = useState(() => loadSetting('sellAllFactor', '100'));
  const [fee, setFee] = useState(() => loadSetting('sellFeePct', '5'));
  const [ship, setShip] = useState(() => loadSetting('sellShipParcel', '1.50'));
  const [perParcel, setPerParcel] = useState(() => loadSetting('sellPerParcel', '25'));
  useEffect(() => { saveSetting('sellAllFactor', factor); }, [factor]);
  useEffect(() => { saveSetting('sellFeePct', fee); }, [fee]);
  useEffect(() => { saveSetting('sellShipParcel', ship); }, [ship]);
  useEffect(() => { saveSetting('sellPerParcel', perParcel); }, [perParcel]);

  const calc = useMemo(() => {
    const items = scope === 'sale' ? collection.filter((i) => i.forSale) : collection;
    const feePct = Math.min(100, Math.max(0, num(fee) ?? 0));
    const shipPer = Math.max(0, num(ship) ?? 0);
    const pp = Math.max(1, parseInt(perParcel, 10) || 1);
    let pieces = 0; let gross = 0; let knownVal = 0; let cost = 0; let knownN = 0;
    items.forEach((it) => {
      const q = qtyOf(it);
      const v = (num(it.userPrice) || 0) * q;
      pieces += q; gross += v;
      const buy = num(it.userPurchasePrice);
      if (buy !== null) { cost += buy * q; knownVal += v; knownN += 1; }
    });
    const parcels = pieces ? Math.ceil(pieces / pp) : 0;
    const shipTotal = parcels * shipPer;
    const netAt = (pct) => gross * (pct / 100) * (1 - feePct / 100) - shipTotal;
    const f = Math.min(200, Math.max(1, num(factor) ?? 100));
    const offered = gross * (f / 100);
    const feeAmt = offered * (feePct / 100);
    const knownNet = knownVal * (f / 100) * (1 - feePct / 100);
    return { pieces, kinds: items.length, gross, offered, feeAmt, parcels, shipTotal, net: offered - feeAmt - shipTotal, knownN, cost, profitKnown: knownNet - cost, netAt, feePct };
  }, [collection, scope, factor, fee, ship, perParcel]);

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
      <h3 className="font-bold text-slate-100 text-sm">🧮 Wenn ich alles verkaufe …</h3>
      <div className="flex gap-2 flex-wrap">
        {[['all', 'Ganze Collection'], ['sale', 'Nur „Tausch/Verkauf“']].map(([k, l]) => <button key={k} onClick={() => setScope(k)} className={pill(scope === k)}>{l}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Verkaufspreis in % vom Richtwert" value={factor} onChange={setFactor} suffix="%" />
        <NumField label="Gebühr" value={fee} onChange={setFee} suffix="%" />
        <NumField label="Porto pro Paket" value={ship} onChange={setShip} suffix="€" step="0.01" />
        <NumField label="Karten pro Paket" value={perParcel} onChange={setPerParcel} step="1" />
      </div>
      <p className="text-[10px] text-slate-500">100 % = du bekommst den Richtwert. Bei einem Ankauf durch Händler sind eher 50–70 % realistisch. Gebühr und Porto sind Beispielwerte.</p>

      {calc.pieces === 0 ? (
        <p className="text-xs text-slate-500">Keine Karten in dieser Auswahl.</p>
      ) : (
        <>
          <div className="text-sm space-y-1 pt-2 border-t border-slate-800">
            <div className="flex justify-between"><span className="text-slate-400">{calc.pieces} Karten ({calc.kinds} Einträge)</span><span className="text-slate-200">{eur(calc.gross)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Erlös bei {Math.round(num(factor) ?? 100)} %</span><span className="text-slate-200">{eur(calc.offered)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Gebühr ({calc.feePct} %)</span><span className="text-rose-400">−{eur(calc.feeAmt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Versand ({calc.parcels} {calc.parcels === 1 ? 'Paket' : 'Pakete'})</span><span className="text-rose-400">−{eur(calc.shipTotal)}</span></div>
            <div className="flex justify-between pt-1 border-t border-slate-800"><span className="font-bold text-slate-200">Bleibt dir</span><span className={`font-black ${calc.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{eur(calc.net)}</span></div>
          </div>
          {calc.knownN > 0 && (
            <p className="text-[11px] text-slate-400">
              Für {calc.knownN} Einträge mit Einkaufspreis ({eur(calc.cost)} investiert): <span className={`font-bold ${calc.profitKnown >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{signedEur(calc.profitKnown)}</span> Gewinn/Verlust (ohne Porto).
            </p>
          )}
          <div className="pt-2 border-t border-slate-800">
            <p className="text-[10px] text-slate-500 mb-1">Szenarien (nach Gebühr und Porto)</p>
            <div className="grid grid-cols-4 gap-1 text-center">
              {[100, 85, 70, 50].map((p) => (
                <div key={p} className="bg-slate-950 border border-slate-800 rounded-lg py-1.5">
                  <p className="text-[10px] text-slate-500">{p} %</p>
                  <p className="text-xs font-bold text-cyan-300">{eur(calc.netAt(p))}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Portfolio-Aufteilung (Ringdiagramm)
// ---------------------------------------------------------------------
const PALETTE = ['#22d3ee', '#2dd4bf', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#fb7185', '#a3e635', '#94a3b8'];
const BAND_LABELS = ['unter 1 €', '1–5 €', '5–20 €', '20–100 €', 'ab 100 €'];
const bandOf = (p) => (p < 1 ? 0 : p < 5 ? 1 : p < 20 ? 2 : p < 100 ? 3 : 4);

export function PortfolioSplit({ collection }) {
  const [dim, setDim] = useState('lang');
  const [metric, setMetric] = useState('value');

  const groups = useMemo(() => {
    const m = new Map();
    collection.forEach((it) => {
      const q = qtyOf(it);
      const p = num(it.userPrice) || 0;
      let key; let label;
      if (dim === 'lang') { key = it.userLanguage || 'Unbekannt'; label = key; }
      else if (dim === 'cond') { key = it.userCondition || 'Unbekannt'; label = key; }
      else if (dim === 'variant') { key = it.userVariant || 'normal'; label = VARIANT_LABEL[key] || key; }
      else if (dim === 'band') { key = bandOf(p); label = BAND_LABELS[key]; }
      else { key = it.set?.name || 'Ohne Set'; label = key; }
      const g = m.get(key) || { key: String(key), label, value: 0, pieces: 0, order: typeof key === 'number' ? key : 0 };
      g.value += p * q; g.pieces += q;
      m.set(key, g);
    });
    let arr = [...m.values()];
    if (dim === 'band') arr.sort((a, b) => a.order - b.order);
    else arr.sort((a, b) => (metric === 'value' ? b.value - a.value : b.pieces - a.pieces));
    if (dim === 'set' && arr.length > 8) {
      const rest = arr.slice(7);
      arr = [...arr.slice(0, 7), { key: '__rest', label: `Weitere ${rest.length} Sets`, value: rest.reduce((s, g) => s + g.value, 0), pieces: rest.reduce((s, g) => s + g.pieces, 0) }];
    }
    return arr;
  }, [collection, dim, metric]);

  const val = (g) => (metric === 'value' ? g.value : g.pieces);
  const total = groups.reduce((s, g) => s + val(g), 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-slate-100 text-sm">🥧 Portfolio-Aufteilung</h3>
        <div className="flex gap-1">
          {[['value', '€'], ['pieces', 'Stück']].map(([k, l]) => <button key={k} onClick={() => setMetric(k)} className={pill(metric === k)}>{l}</button>)}
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[['lang', 'Sprache'], ['cond', 'Zustand'], ['variant', 'Variante'], ['band', 'Preisklasse'], ['set', 'Set']].map(([k, l]) => (
          <button key={k} onClick={() => setDim(k)} className={`whitespace-nowrap ${pill(dim === k)}`}>{l}</button>
        ))}
      </div>
      {total <= 0 ? (
        <p className="text-xs text-slate-500">Noch keine Werte vorhanden.</p>
      ) : (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <svg viewBox="0 0 120 120" className="w-40 h-40 shrink-0" role="img" aria-label="Portfolio-Aufteilung">
            <circle cx="60" cy="60" r={R} fill="none" stroke="#0f172a" strokeWidth="16" />
            {groups.map((g, i) => {
              const len = (val(g) / total) * C;
              const el = (
                <circle key={g.key} cx="60" cy="60" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16"
                  strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />
              );
              offset += len;
              return el;
            })}
            <text x="60" y="58" textAnchor="middle" fontSize="11" fontWeight="800" fill="#e2e8f0">{metric === 'value' ? eur(total) : total}</text>
            <text x="60" y="71" textAnchor="middle" fontSize="7" fill="#94a3b8">{metric === 'value' ? 'Gesamtwert' : 'Karten'}</text>
          </svg>
          <ul className="flex-1 w-full space-y-1.5">
            {groups.map((g, i) => (
              <li key={g.key} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="flex-1 min-w-0 truncate text-slate-300">{g.label}</span>
                <span className="text-slate-400 whitespace-nowrap">{metric === 'value' ? eur(g.value) : `${g.pieces} Stk.`}</span>
                <span className="w-12 text-right font-bold text-cyan-300">{((val(g) / total) * 100).toFixed(1).replace('.', ',')} %</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Verkaufshistorie: „Verkauft“-Dialog (Collection -> users/{uid}/sales)
// ---------------------------------------------------------------------
export function RecordSaleModal({ item, onClose, onDone }) {
  const maxQty = qtyOf(item);
  const [qty, setQty] = useState(String(maxQty));
  const [price, setPrice] = useState(item.userPrice != null ? String(item.userPrice) : '');
  const [costs, setCosts] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sold = Math.min(maxQty, Math.max(1, parseInt(qty, 10) || 1));
  const p = num(price);

  const save = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !item.docId) return;
    if (p === null || p < 0) { setError('Bitte einen gültigen Verkaufspreis pro Stück eintragen.'); return; }
    setBusy(true); setError('');
    try {
      const img = item.images?.small || '';
      const sale = {
        cardId: item.id,
        name: plain(item.name),
        set: item.set?.name || '',
        number: item.number || '',
        image: /^https?:/.test(img) ? img : '',
        variant: item.userVariant || 'normal',
        condition: (item.userGrade && item.userGrade.company ? `${item.userGrade.company} ${item.userGrade.grade}` : item.userCondition) || '',
        language: item.userLanguage || '',
        qty: sold,
        salePrice: p,
        costs: Math.max(0, num(costs) || 0),
        purchasePrice: num(item.userPurchasePrice),
        note: note.trim(),
        soldAt: Date.now()
      };
      const batch = writeBatch(db);
      batch.set(doc(fsCollection(db, 'users', uid, 'sales')), sale);
      const cref = doc(db, 'users', uid, 'collection', item.docId);
      if (sold >= maxQty) batch.delete(cref); else batch.update(cref, { userQuantity: maxQty - sold });
      await batch.commit();
      onDone(`${sold}× ${plain(item.name)} als verkauft gebucht ✓`);
      onClose();
    } catch (e) {
      setError(e.code === 'permission-denied'
        ? 'Keine Berechtigung – bitte die Firestore-Regel für users/{uid}/sales veröffentlichen.'
        : 'Speichern fehlgeschlagen: ' + (e.message || 'Unbekannter Fehler'));
      setBusy(false);
    }
  };

  const buy = num(item.userPurchasePrice);
  const profit = p !== null && buy !== null ? p * sold - (num(costs) || 0) - buy * sold : null;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-slate-100">✔ Als verkauft buchen</h3>
        <p className="text-xs text-slate-400">{plain(item.name)} · {item.set?.name || 'Unbekanntes Set'} · {item.userCondition}</p>
        <div className="grid grid-cols-2 gap-2">
          <NumField label={`Anzahl (max. ${maxQty})`} value={qty} onChange={setQty} step="1" />
          <NumField label="Verkaufspreis pro Stück" value={price} onChange={setPrice} step="0.01" suffix="€" />
          <NumField label="Gebühren/Porto gesamt (optional)" value={costs} onChange={setCosts} step="0.01" suffix="€" />
          <label className="block text-[11px] text-slate-400">Notiz (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Cardmarket" className="w-full mt-1 bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm focus:border-cyan-500 outline-none" />
          </label>
        </div>
        {p !== null && (
          <p className="text-xs text-slate-300">
            Erlös {eur(p * sold - (num(costs) || 0))}
            {profit !== null && <> · Gewinn/Verlust <span className={`font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{signedEur(profit)}</span></>}
          </p>
        )}
        {p !== null && num(item.userPrice) > 0 && (p / num(item.userPrice) > 2.5 || p / num(item.userPrice) < 0.4) && (
          <p className="text-[11px] text-amber-300">⚠️ Dein Verkaufspreis weicht stark vom Richtwert ({eur(num(item.userPrice))}) ab – Tippfehler?</p>
        )}
        <p className="text-[10px] text-slate-500">{sold >= maxQty ? 'Die Karte wird aus der Collection entfernt.' : `In der Collection bleiben ${maxQty - sold} Stück.`}</p>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-xl font-bold text-sm">Abbrechen</button>
          <button onClick={save} disabled={busy} className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 py-2.5 rounded-xl font-black text-sm">{busy ? 'Speichere …' : 'Buchen'}</button>
        </div>
      </div>
    </div>
  );
}

export function SalesHistory() {
  const uid = auth.currentUser?.uid;
  const [state, setState] = useState({ loading: true, denied: false, list: [] });
  const [year, setYear] = useState('all');

  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(
      fsCollection(db, 'users', uid, 'sales'),
      (snap) => setState({ loading: false, denied: false, list: snap.docs.map((d) => ({ ...d.data(), id: d.id })) }),
      (err) => { console.warn('Verkäufe nicht lesbar:', err.code); setState({ loading: false, denied: err.code === 'permission-denied', list: [] }); }
    );
  }, [uid]);

  const all = useMemo(() => [...state.list].sort((a, b) => (b.soldAt || 0) - (a.soldAt || 0)), [state.list]);
  const years = useMemo(() => [...new Set(all.map((s) => new Date(s.soldAt || 0).getFullYear()))].sort((a, b) => b - a), [all]);
  const list = year === 'all' ? all : all.filter((s) => String(new Date(s.soldAt || 0).getFullYear()) === year);

  const profitOf = (s) => (s.purchasePrice != null ? (s.salePrice || 0) * (s.qty || 1) - (s.costs || 0) - s.purchasePrice * (s.qty || 1) : null);
  const sums = useMemo(() => {
    let revenue = 0; let costs = 0; let profit = 0; let withBuy = 0; let withoutBuy = 0; let pieces = 0;
    list.forEach((s) => {
      const q = s.qty || 1;
      revenue += (s.salePrice || 0) * q; costs += s.costs || 0; pieces += q;
      const p = profitOf(s);
      if (p === null) withoutBuy += 1; else { profit += p; withBuy += 1; }
    });
    return { revenue, costs, profit, withBuy, withoutBuy, pieces };
  }, [list]);

  const months = useMemo(() => {
    const m = new Map();
    list.forEach((s) => {
      const d = new Date(s.soldAt || 0);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      m.set(key, (m.get(key) || 0) + (s.salePrice || 0) * (s.qty || 1) - (s.costs || 0));
    });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
      .map(([k, v]) => ({ key: k, label: `${k.slice(5)}/${k.slice(0, 4)}`, value: Math.max(0, v) }));
  }, [list]);

  const exportCsv = () => {
    const rows = list.map((s) => ({
      datum: new Date(s.soldAt || 0).toLocaleDateString('de-DE'),
      name: s.name, set: s.set, nummer: s.number, variante: VARIANT_LABEL[s.variant] || s.variant,
      zustand: s.condition, sprache: String(s.language || '').split(' ')[0], anzahl: s.qty || 1,
      verkaufspreis: String(s.salePrice ?? '').replace('.', ','), kosten: String(s.costs ?? 0).replace('.', ','),
      einkaufspreis: s.purchasePrice != null ? String(s.purchasePrice).replace('.', ',') : '',
      gewinn: profitOf(s) != null ? profitOf(s).toFixed(2).replace('.', ',') : '', notiz: s.note || ''
    }));
    downloadText(`verkaeufe-${year}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, ['datum', 'name', 'set', 'nummer', 'variante', 'zustand', 'sprache', 'anzahl', 'verkaufspreis', 'kosten', 'einkaufspreis', 'gewinn', 'notiz']));
  };

  const remove = async (s) => {
    if (!window.confirm('Eintrag aus der Verkaufshistorie löschen? Die Karte kommt dadurch NICHT in die Collection zurück.')) return;
    try { await deleteDoc(doc(db, 'users', uid, 'sales', s.id)); } catch (e) { window.alert('Löschen fehlgeschlagen.'); }
  };

  if (state.loading) return <p className="text-center text-cyan-400 text-sm py-10 animate-pulse">Lade Verkäufe …</p>;
  if (state.denied) return <p className="text-xs text-amber-300">Die Verkäufe sind nicht lesbar. Bitte in der Firebase Console die Firestore-Regel für {'users/{uid}/sales'} freigeben.</p>;
  if (all.length === 0) {
    return <div className="text-center py-20 text-slate-500">Noch kein Verkauf gebucht.<br /><span className="text-xs">In „Verkauf“ bei einer Karte auf „✔ Verkauft“ tippen.</span></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-4 space-y-3 shadow-md">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-slate-100 text-sm">🧾 Verkaufshistorie</h3>
          <div className="flex gap-1 overflow-x-auto">
            {['all', ...years.map(String)].map((y) => <button key={y} onClick={() => setYear(y)} className={pill(year === y)}>{y === 'all' ? 'Alle' : y}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3"><p className="text-[10px] text-slate-400 uppercase tracking-wider">Umsatz</p><p className="text-lg font-black text-cyan-300">{eur(sums.revenue)}</p><p className="text-[10px] text-slate-500">{sums.pieces} Karten</p></div>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3"><p className="text-[10px] text-slate-400 uppercase tracking-wider">Gewinn/Verlust</p><p className={`text-lg font-black ${sums.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{signedEur(sums.profit)}</p><p className="text-[10px] text-slate-500">aus {sums.withBuy} Verkäufen mit Einkaufspreis</p></div>
        </div>
        <p className="text-[10px] text-slate-500">Gebühren/Porto: {eur(sums.costs)}{sums.withoutBuy > 0 ? ` · ${sums.withoutBuy} Verkäufe ohne Einkaufspreis zählen nicht zum Gewinn` : ''}.</p>
        <button onClick={exportCsv} className="w-full bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 font-bold text-xs py-2 rounded-lg">⬇️ Als CSV exportieren</button>
      </div>

      {months.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
          <h4 className="font-bold text-slate-100 text-sm mb-2">Erlös pro Monat (nach Kosten)</h4>
          <HBars rows={months} />
        </div>
      )}

      <div className="space-y-2">
        {list.map((s) => {
          const pr = profitOf(s);
          return (
            <div key={s.id} className="bg-slate-900 border border-slate-800 rounded-lg p-2 flex gap-3 items-center text-xs">
              {s.image ? <img src={s.image} alt="" className="w-9 rounded" loading="lazy" /> : <div className="w-9 h-12 rounded bg-slate-800 flex items-center justify-center">🃏</div>}
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-200 truncate">{s.qty || 1}× {s.name}</p>
                <p className="text-slate-500 truncate">{s.set || 'Unbekanntes Set'} · {new Date(s.soldAt || 0).toLocaleDateString('de-DE')}{s.note ? ` · ${s.note}` : ''}</p>
              </div>
              <div className="text-right whitespace-nowrap">
                <p className="text-cyan-400 font-bold">{eur((s.salePrice || 0) * (s.qty || 1))}</p>
                {pr !== null && <p className={`text-[10px] font-bold ${pr >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{signedEur(pr)}</p>}
              </div>
              <button onClick={() => remove(s)} title="Eintrag löschen" className="text-slate-600 hover:text-rose-400 px-1">✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Hinweis auf neue Sets (Vergleich mit der Liste von TCGdex)
// ---------------------------------------------------------------------
const KNOWN_KEY = 'knownSetIds';

export function NewSetsBanner({ api, watchIds, uid, Img }) {
  const [fresh, setFresh] = useState([]);
  const [open, setOpen] = useState(null);
  const [cache, setCache] = useState({});
  const allNew = useRef([]);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    fetch(`${api}/api/sets-list`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (!alive || !Array.isArray(list)) return;
        const withCards = list.filter((s) => s.id && s.total > 0);
        let known = null;
        try { known = JSON.parse(localStorage.getItem(KNOWN_KEY)); } catch (e) { /* neu anlegen */ }
        if (!Array.isArray(known)) {
          // Erster Start: alle heutigen Sets als bekannt merken, sonst gäbe es eine Flut an Hinweisen
          saveSetting(KNOWN_KEY, JSON.stringify(withCards.map((s) => s.id)));
          return;
        }
        const ks = new Set(known);
        const fresher = withCards.filter((s) => !ks.has(s.id));
        allNew.current = fresher.map((s) => s.id);
        setFresh(fresher.slice(-5).reverse());
      })
      .catch(() => { /* kein Hinweis ist kein Drama */ })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; ctrl.abort(); clearTimeout(timer); };
  }, [api]);

  const markSeen = (ids) => {
    let known = [];
    try { known = JSON.parse(localStorage.getItem(KNOWN_KEY)) || []; } catch (e) { /* leer */ }
    saveSetting(KNOWN_KEY, JSON.stringify([...new Set([...known, ...ids])]));
    setFresh((f) => f.filter((s) => !ids.includes(s.id)));
    allNew.current = allNew.current.filter((id) => !ids.includes(id));
  };

  const toggle = async (s) => {
    if (open === s.id) { setOpen(null); return; }
    setOpen(s.id);
    if (cache[s.id]?.cards) return;
    setCache((c) => ({ ...c, [s.id]: { loading: true } }));
    try {
      const res = await fetch(`${api}/api/sets/${encodeURIComponent(s.id)}`);
      if (!res.ok) throw new Error('Set nicht gefunden');
      const data = await res.json();
      setCache((c) => ({ ...c, [s.id]: { cards: data.cards || [] } }));
    } catch (e) {
      setCache((c) => ({ ...c, [s.id]: { error: e.message || 'Fehler beim Laden' } }));
    }
  };

  if (fresh.length === 0) return null;

  return (
    <div className="bg-violet-500/10 border border-violet-500/40 rounded-xl p-3 space-y-2 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-violet-300">🆕 {fresh.length === 1 ? 'Neues Set' : 'Neue Sets'} bei TCGdex</h3>
        <button onClick={() => markSeen(allNew.current)} className="text-[11px] text-slate-400 hover:text-violet-300 underline">Alle gesehen</button>
      </div>
      {fresh.map((s) => {
        const c = cache[s.id];
        return (
          <div key={s.id} className="bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-100 truncate">{s.name}</p>
                <p className="text-[10px] text-slate-500">{s.total} Karten · ID {s.id}</p>
              </div>
              <button onClick={() => toggle(s)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-slate-900 text-violet-300 border-violet-500/40 hover:bg-violet-500 hover:text-slate-950">{open === s.id ? 'Zuklappen' : 'Ansehen'}</button>
              <button onClick={() => markSeen([s.id])} title="Als gesehen markieren" className="text-slate-500 hover:text-slate-200 px-1">✕</button>
            </div>
            {open === s.id && (
              <div>
                {c?.loading && <p className="text-xs text-cyan-400">Lade Kartenliste …</p>}
                {c?.error && <p className="text-xs text-rose-400">{c.error}</p>}
                {c?.cards && (
                  <>
                    <div className="flex gap-1.5 overflow-x-auto pb-2">
                      {c.cards.slice(0, 12).map((card) => <Img key={card.id} src={card.image} alt={card.name} className="w-14 rounded shrink-0" />)}
                    </div>
                    <CompletionPanel
                      title="💶 Was kostet das ganze Set?"
                      cards={c.cards.map((card) => ({ id: card.id, name: card.name, image: card.image, localId: card.localId, setName: s.name }))}
                      api={api}
                      uid={uid}
                      watchIds={watchIds}
                      Img={Img}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Tauschrechner: meine Karten gegen Karten des Partners
// ---------------------------------------------------------------------
const clampInt = (v) => Math.max(1, parseInt(v, 10) || 1);
const rowSum = (list) => list.reduce((s, r) => s + (num(r.price) || 0) * clampInt(r.qty), 0);
const HOLO_KEYS = ['reverse', 'holo'];

function TradeRow({ r, onChange, onRemove }) {
  const inp = 'bg-slate-900 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-md px-1.5 py-1 text-xs outline-none';
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-200 truncate">{r.name}</p>
          <p className="text-[10px] text-slate-500 truncate">{r.sub}</p>
        </div>
        <button onClick={onRemove} className="text-slate-500 hover:text-rose-400 text-sm px-1">✕</button>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 flex-wrap">
        <span>Anz.</span>
        <input type="number" min="1" max={r.max || 99} value={r.qty} onChange={(e) => onChange({ qty: e.target.value })} className={`w-12 ${inp}`} />
        <span>à</span>
        <input type="number" min="0" step="0.01" value={r.price} onChange={(e) => onChange({ price: e.target.value })} className={`w-20 ${inp}`} />
        <span>€</span>
        <OutlierBadge prices={r.prices} holo={r.holo} />
      </div>
    </div>
  );
}

export function TradeCalculator({ collection, api }) {
  const [give, setGive] = useState([]);
  const [recv, setRecv] = useState([]);
  const [pct, setPct] = useState(() => loadSetting('tradePct', '100'));
  const [cash, setCash] = useState('');
  const [q, setQ] = useState('');
  const [sq, setSq] = useState('');
  const [res, setRes] = useState({ loading: false, error: '', cards: null });
  const [man, setMan] = useState({ name: '', price: '' });
  const [copied, setCopied] = useState(false);
  useEffect(() => { saveSetting('tradePct', pct); }, [pct]);

  const upd = (setList) => (key, patch) => setList((l) => l.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const del = (setList) => (key) => setList((l) => l.filter((r) => r.key !== key));

  const mine = useMemo(() => {
    const t = q.trim().toLowerCase();
    return collection
      .filter((it) => it.docId && (!t || `${it.name} ${it.set?.name || ''}`.toLowerCase().includes(t)))
      .sort((a, b) => (b.forSale ? 1 : 0) - (a.forSale ? 1 : 0) || plain(a.name).localeCompare(plain(b.name)))
      .slice(0, 30);
  }, [collection, q]);

  const addGive = (it) => setGive((l) => {
    if (l.some((r) => r.key === it.docId)) return l.map((r) => (r.key === it.docId ? { ...r, qty: Math.min(r.max, clampInt(r.qty) + 1) } : r));
    const g = it.userGrade && it.userGrade.company ? `${it.userGrade.company} ${it.userGrade.grade}` : it.userCondition;
    return [...l, {
      key: it.docId, name: plain(it.name), sub: `${it.set?.name || '?'} · ${g || ''}`,
      price: String(num(it.userPrice) ?? 0), qty: 1, max: qtyOf(it),
      prices: it.userGrade ? null : it.cardmarket?.prices, holo: HOLO_KEYS.includes(it.userVariant)
    }];
  });

  const addRecv = (card) => setRecv((l) => {
    if (l.some((r) => r.key === card.id)) return l.map((r) => (r.key === card.id ? { ...r, qty: clampInt(r.qty) + 1 } : r));
    const p = watchPrice(card.cardmarket && card.cardmarket.prices);
    return [...l, {
      key: card.id, name: plain(card.name) + (card.number ? ` #${card.number}` : ''), sub: card.set?.name || '',
      price: p ? p.toFixed(2) : '', qty: 1, max: 99, prices: card.cardmarket?.prices, holo: false
    }];
  });

  const addManual = (e) => {
    e.preventDefault();
    if (!man.name.trim()) return;
    setRecv((l) => [...l, { key: `m-${Date.now()}`, name: man.name.trim(), sub: 'manuell', price: man.price, qty: 1, max: 99, prices: null, holo: false }]);
    setMan({ name: '', price: '' });
  };

  const search = async (e) => {
    e.preventDefault();
    if (!sq.trim()) return;
    setRes({ loading: true, error: '', cards: null });
    try {
      const r = await fetch(`${api}/api/cards?name=${encodeURIComponent(sq.trim())}`);
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || `Fehler ${r.status}`);
      setRes({ loading: false, error: '', cards: Array.isArray(d) ? d.slice(0, 12) : [] });
    } catch (err) {
      setRes({ loading: false, error: err.message || 'Suche fehlgeschlagen', cards: null });
    }
  };

  const f = Math.min(200, Math.max(1, num(pct) ?? 100)) / 100;
  const gv = rowSum(give) * f;
  const rv = rowSum(recv) * f;
  const c = num(cash) || 0;
  const mineTotal = gv + c;
  const diff = mineTotal - rv;
  const fair = Math.abs(diff) <= Math.max(0.5, Math.max(mineTotal, rv) * 0.05);
  const flagged = [...give, ...recv].some((r) => r.prices && outlierOf(r.prices, r.holo));

  const copy = async () => {
    const lines = [
      'Ich gebe:', ...give.map((r) => `${clampInt(r.qty)}x ${r.name} (${eur(num(r.price) || 0)})`),
      ...(c ? [`${c > 0 ? 'Zuzahlung von mir' : 'Zuzahlung vom Partner'}: ${eur(Math.abs(c))}`] : []),
      '', 'Ich bekomme:', ...recv.map((r) => `${clampInt(r.qty)}x ${r.name} (${eur(num(r.price) || 0)})`),
      '', `Wertansatz ${Math.round(f * 100)} %: ${eur(mineTotal)} ↔ ${eur(rv)}`
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); } catch (e) { window.prompt('Zum Kopieren markieren:', lines.join('\n')); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const inp = 'w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-lg px-3 py-2 text-xs outline-none';

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-4 space-y-3 shadow-md">
        <h3 className="font-bold text-slate-100 text-sm">🔁 Tauschrechner</h3>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Wertansatz in % vom Richtwert (beide Seiten)" value={pct} onChange={setPct} suffix="%" />
          <NumField label="Zuzahlung von mir (− = Partner zahlt)" value={cash} onChange={setCash} step="0.01" suffix="€" />
        </div>
        <p className="text-[10px] text-slate-500">Viele tauschen zu 80–90 % vom Cardmarket-Trend. Alle Preise lassen sich pro Zeile überschreiben.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
          <h4 className="text-xs font-bold text-emerald-300">Ich gebe ({eur(gv)})</h4>
          {give.map((r) => <TradeRow key={r.key} r={r} onChange={(p) => upd(setGive)(r.key, p)} onRemove={() => del(setGive)(r.key)} />)}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="In meiner Collection suchen …" className={inp} />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {mine.map((it) => (
              <button key={it.docId} onClick={() => addGive(it)} className="w-full text-left flex items-center justify-between gap-2 text-[11px] bg-slate-950 border border-slate-800 hover:border-cyan-500 rounded-md px-2 py-1">
                <span className="truncate text-slate-300">{it.forSale ? '🏷️ ' : ''}{plain(it.name)} <span className="text-slate-500">· {it.set?.name || '?'}</span></span>
                <span className="text-cyan-400 font-bold whitespace-nowrap">{eur(num(it.userPrice) || 0)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
          <h4 className="text-xs font-bold text-amber-300">Ich bekomme ({eur(rv)})</h4>
          {recv.map((r) => <TradeRow key={r.key} r={r} onChange={(p) => upd(setRecv)(r.key, p)} onRemove={() => del(setRecv)(r.key)} />)}
          <form onSubmit={search} className="flex gap-2">
            <input value={sq} onChange={(e) => setSq(e.target.value)} placeholder='Karte suchen, z. B. "Glurak 006"' className={inp} />
            <button type="submit" className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs px-3 rounded-lg">Suche</button>
          </form>
          {res.loading && <p className="text-xs text-cyan-400 animate-pulse">Suche läuft …</p>}
          {res.error && <p className="text-xs text-rose-400">{res.error}</p>}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {(res.cards || []).map((card) => (
              <button key={card.id} onClick={() => addRecv(card)} className="w-full text-left flex items-center justify-between gap-2 text-[11px] bg-slate-950 border border-slate-800 hover:border-cyan-500 rounded-md px-2 py-1">
                <span className="truncate text-slate-300">{plain(card.name)}{card.number ? ` #${card.number}` : ''} <span className="text-slate-500">· {card.set?.name || '?'}</span></span>
                <span className="text-cyan-400 font-bold whitespace-nowrap">{eur(watchPrice(card.cardmarket && card.cardmarket.prices))}</span>
              </button>
            ))}
          </div>
          <form onSubmit={addManual} className="flex gap-2">
            <input value={man.name} onChange={(e) => setMan({ ...man, name: e.target.value })} placeholder="oder von Hand: Name" className={inp} />
            <input type="number" step="0.01" value={man.price} onChange={(e) => setMan({ ...man, price: e.target.value })} placeholder="€" className="w-20 bg-slate-950 border border-slate-700 text-slate-100 rounded-lg px-2 py-2 text-xs outline-none" />
            <button type="submit" className="bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 font-bold text-xs px-3 rounded-lg">＋</button>
          </form>
        </div>
      </div>

      {(give.length > 0 || recv.length > 0) && (
        <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-4 space-y-2 shadow-md">
          <div className="flex justify-between text-sm"><span className="text-slate-400">Meine Seite{c ? ` (inkl. ${eur(Math.abs(c))} ${c > 0 ? 'Zuzahlung' : 'Abzug'})` : ''}</span><span className="font-bold text-slate-200">{eur(mineTotal)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-400">Seite des Partners</span><span className="font-bold text-slate-200">{eur(rv)}</span></div>
          <p className={`text-sm font-black pt-2 border-t border-slate-800 ${fair ? 'text-emerald-400' : 'text-amber-300'}`}>
            {fair
              ? `⚖️ Ziemlich fair (Differenz ${eur(Math.abs(diff))})`
              : diff > 0
                ? `Du gibst ${eur(diff)} mehr, als du bekommst – der Partner könnte ${eur(diff)} drauflegen.`
                : `Du bekommst ${eur(-diff)} mehr – du könntest ${eur(-diff)} drauflegen.`}
          </p>
          {flagged && <p className="text-[11px] text-amber-300">⚠️ Mindestens eine Karte hat einen auffälligen Preis (Ausreißer-Verdacht). Prüfe vor dem Tausch die echten Angebote.</p>}
          <button onClick={copy} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-2.5 rounded-xl font-black text-sm">{copied ? 'Kopiert ✓' : 'Tausch-Angebot kopieren'}</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Einkaufsplaner: gefundene Cardmarket-Angebote nach Verkäufer bündeln (Porto sparen)
// Cardmarket hat keine freie Schnittstelle für Angebote – du trägst ein, was du gefunden hast.
// ---------------------------------------------------------------------
export function SellerPlanner({ watchlist, uid }) {
  const storeKey = `sellerPlan:${uid || ''}`;
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(() => { try { return JSON.parse(loadSetting(storeKey, '{}')) || {}; } catch (e) { return {}; } });
  const [ship, setShip] = useState(() => loadSetting('plannerShip', '1.50'));
  const [msg, setMsg] = useState('');
  useEffect(() => { saveSetting(storeKey, JSON.stringify(plan)); }, [plan, storeKey]);
  useEffect(() => { saveSetting('plannerShip', ship); }, [ship]);
  const patchRow = (id, patch) => setPlan((p) => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));

  const rows = useMemo(() => watchlist.map((c) => {
    const e = plan[c.id] || {};
    const price = num(e.price);
    const trend = watchPrice(c.cardmarket && c.cardmarket.prices);
    let warn = '';
    if (price != null && trend >= 1) {
      if (price > trend * 1.25) warn = `${Math.round((price / trend - 1) * 100)} % über Trend`;
      else if (price < trend * 0.5) warn = 'auffällig günstig – Zustand/Sprache prüfen';
    }
    return { c, sellerRaw: e.seller || '', seller: String(e.seller || '').trim(), priceRaw: e.price ?? '', price, qty: clampInt(e.qty), qtyRaw: e.qty ?? '', trend, warn };
  }), [watchlist, plan]);

  const groups = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      if (!r.seller || r.price == null) return;
      const k = r.seller.toLowerCase();
      const g = m.get(k) || { seller: r.seller, rows: [], total: 0 };
      g.rows.push(r); g.total += r.price * r.qty;
      m.set(k, g);
    });
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length || b.total - a.total);
  }, [rows]);

  const shipN = Math.max(0, num(ship) || 0);
  const filled = groups.reduce((s, g) => s + g.rows.length, 0);
  const goods = groups.reduce((s, g) => s + g.total, 0);
  const saved = Math.max(0, (filled - groups.length) * shipN);
  const sellers = [...new Set(rows.map((r) => r.seller).filter(Boolean))];

  const copyGroup = async (g) => {
    const text = `Bestellung bei ${g.seller}:\n` + g.rows.map((r) => `${r.qty}x ${plain(r.c.name)}${r.c.set?.name ? ` (${r.c.set.name})` : ''} – ${eur(r.price)}`).join('\n') + `\nSumme: ${eur(g.total)} + Porto`;
    try { await navigator.clipboard.writeText(text); setMsg(`Liste für ${g.seller} kopiert. ✓`); } catch (e) { window.prompt('Zum Kopieren markieren:', text); }
  };

  if (watchlist.length === 0) return null;
  const inp = 'bg-slate-950 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-md px-2 py-1 text-xs outline-none';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-sm font-bold text-slate-100">🛒 Einkaufsplaner: Verkäufer bündeln</span>
        <span className="text-xs text-cyan-400">{open ? 'Schließen' : 'Öffnen'}</span>
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-400">Öffne pro Karte die Angebote („Angebote suchen ↗“), trage den günstigsten passenden Verkäufer + Preis ein – unten siehst du, welcher Verkäufer mehrere deiner Karten hat und wie viel Porto das Bündeln spart.</p>
          <datalist id="seller-list">{sellers.map((s) => <option key={s} value={s} />)}</datalist>
          <div className="w-40"><NumField label="Porto pro Bestellung" value={ship} onChange={setShip} step="0.01" suffix="€" /></div>

          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.c.id} className="bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-200 truncate">{plain(r.c.name)} <span className="text-slate-500 font-normal">{r.c.set?.name}</span></p>
                  {r.c.cardmarket?.url && <a href={r.c.cardmarket.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400 underline shrink-0">Angebote suchen ↗</a>}
                </div>
                <div className="grid grid-cols-6 gap-1">
                  <input list="seller-list" value={r.sellerRaw} onChange={(e) => patchRow(r.c.id, { seller: e.target.value })} placeholder="Verkäufer" className={`col-span-3 ${inp}`} />
                  <input type="number" step="0.01" min="0" value={r.priceRaw} onChange={(e) => patchRow(r.c.id, { price: e.target.value })} placeholder="€ / Stück" className={`col-span-2 ${inp}`} />
                  <input type="number" min="1" value={r.qtyRaw} onChange={(e) => patchRow(r.c.id, { qty: e.target.value })} placeholder="1" className={`col-span-1 ${inp}`} />
                </div>
                <p className="text-[10px] text-slate-500">Trend {eur(r.trend)}{r.warn ? <span className="text-amber-300 font-bold"> · ⚠️ {r.warn}</span> : null}</p>
              </div>
            ))}
          </div>

          {groups.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <p className="text-xs font-bold text-slate-200">Bestellungen nach Verkäufer</p>
              {groups.map((g) => (
                <div key={g.seller} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-slate-300"><b>{g.seller}</b> · {g.rows.length} {g.rows.length === 1 ? 'Karte' : 'Karten'}</span>
                  <span className="whitespace-nowrap text-cyan-300 font-bold">{eur(g.total)} <span className="text-slate-500 font-normal">+ {eur(shipN)}</span></span>
                  <button onClick={() => copyGroup(g)} className="text-[11px] font-bold text-cyan-400 hover:underline">Kopieren</button>
                </div>
              ))}
              <p className="text-xs text-slate-300">
                Gesamt: <span className="font-black text-cyan-300">{eur(goods + groups.length * shipN)}</span> bei {groups.length} {groups.length === 1 ? 'Bestellung' : 'Bestellungen'}
                {saved > 0 ? <> · Bündeln spart ca. <span className="font-bold text-emerald-400">{eur(saved)}</span> Porto</> : null}
              </p>
            </div>
          )}
          {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
          <button onClick={() => { if (window.confirm('Alle eingetragenen Angebote löschen?')) setPlan({}); }} className="text-[11px] text-slate-500 hover:text-rose-400 underline">Eingaben zurücksetzen</button>
        </div>
      )}
    </div>
  );
}
