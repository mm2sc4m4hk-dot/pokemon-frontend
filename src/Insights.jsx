// Neue Ansichten: Preisverlauf pro Karte, Gewinner/Verlierer der Woche,
// Push-Schalter für Zielpreise und „Kosten bis komplett“ für Binder.
// Die Daten kommen aus Firestore (vom Tages-Job des Servers befüllt), siehe priceData.js.
import React, { useState, useEffect, useMemo } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { loadCardPrices, loadHistory, fetchPrices, watchPrice } from './priceData';

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const signedEur = (n) => `${n >= 0 ? '+' : '−'}${eur(Math.abs(n))}`;
const signedPct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')} %`;
const plain = (name) => String(name || '').replace(/\s*\[.*\]\s*$/, '');
const qtyOf = (it) => Math.max(1, parseInt(it?.userQuantity, 10) || 1);
const HOLO_VARIANTS = new Set(['reverse', 'holo']); // wie VARIANTS in App.jsx
const fmtDate = (d) => { const [, m, dd] = d.split('-'); return `${dd}.${m}.`; };
const shiftDay = (key, n) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------------
// Preisverlauf einer Karte (Detailansicht)
// ---------------------------------------------------------------------
export function CardHistoryChart({ cardId, holo = false }) {
  const [state, setState] = useState({ loading: true, points: [], error: '' });
  const [range, setRange] = useState('all');

  useEffect(() => {
    let alive = true;
    setState({ loading: true, points: [], error: '' });
    loadHistory(cardId)
      .then((points) => { if (alive) setState({ loading: false, points, error: '' }); })
      .catch((e) => { if (alive) setState({ loading: false, points: [], error: e.code === 'permission-denied' ? 'rules' : 'load' }); });
    return () => { alive = false; };
  }, [cardId]);

  const series = useMemo(() => {
    const hasHolo = state.points.some((p) => p.h > 0);
    const hasNormal = state.points.some((p) => p.t > 0);
    const useHolo = hasHolo && (holo || !hasNormal);
    return state.points.map((p) => ({ date: p.date, value: useHolo ? p.h : p.t })).filter((p) => p.value > 0);
  }, [state.points, holo]);

  if (state.loading) return <p className="text-xs text-slate-500 text-center py-3">Lade Verlauf …</p>;
  if (state.error === 'rules') return <p className="text-xs text-amber-300">Verlauf nicht lesbar – bitte die Firestore-Regeln für cardHistory freigeben.</p>;
  if (state.error) return <p className="text-xs text-slate-500 text-center py-3">Verlauf konnte nicht geladen werden.</p>;
  if (series.length < 2) {
    return <p className="text-xs text-slate-500 text-center py-3">Der Verlauf baut sich ab jetzt täglich auf{series.length === 1 ? ' (bisher 1 Messpunkt)' : ''}.</p>;
  }

  const last = series[series.length - 1];
  const days = range === 'all' ? null : Number(range);
  let shown = days ? series.filter((p) => p.date >= shiftDay(last.date, -days)) : series;
  if (shown.length < 2) shown = series.slice(-2);

  const W = 300, H = 100, PX = 4, PY = 12;
  const vals = shown.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const t0 = new Date(`${shown[0].date}T00:00:00Z`).getTime();
  const t1 = new Date(`${last.date}T00:00:00Z`).getTime();
  const tSpan = t1 - t0 || 1;
  // x nach echtem Datum, damit Lücken (Tage ohne Messung) nicht gestaucht werden
  const xy = shown.map((p) => [
    PX + ((new Date(`${p.date}T00:00:00Z`).getTime() - t0) / tSpan) * (W - 2 * PX),
    PY + (1 - (p.value - min) / span) * (H - 2 * PY)
  ]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${PX},${H - PY} ${line} ${xy[xy.length - 1][0].toFixed(1)},${H - PY}`;
  const diff = last.value - shown[0].value;
  const pct = shown[0].value > 0 ? (diff / shown[0].value) * 100 : 0;
  const [lx, ly] = xy[xy.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end gap-2">
        <p className={`text-xs font-bold ${diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {signedEur(diff)} ({signedPct(pct)}) seit {fmtDate(shown[0].date)}
        </p>
        <div className="flex gap-1">
          {[['7', '7 T'], ['30', '30 T'], ['90', '90 T'], ['all', 'Alles']].map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} className={`text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${range === k ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`}>{label}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-24 bg-slate-950 border border-slate-800 rounded-xl" role="img" aria-label="Preisverlauf der Karte">
        <polygon points={area} fill="rgb(34 211 238)" fillOpacity="0.12" />
        <polyline points={line} fill="none" stroke="rgb(34 211 238)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={lx} cy={ly} r="2.5" fill="rgb(34 211 238)" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{fmtDate(shown[0].date)}</span>
        <span>Tief {eur(min)} · Hoch {eur(max)}</span>
        <span>{fmtDate(last.date)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Gewinner & Verlierer der Collection (Profil)
// ---------------------------------------------------------------------
function MoverRow({ r }) {
  const up = r.pct >= 0;
  return (
    <li className="flex items-center justify-between gap-3 text-xs">
      <span className="min-w-0">
        <span className="block truncate text-slate-200 font-bold">{plain(r.item.name)}{r.qty > 1 ? <span className="text-slate-500 font-normal"> ×{r.qty}</span> : null}</span>
        <span className="block truncate text-[10px] text-slate-500">{[r.item.set?.name, r.variantLabel].filter(Boolean).join(' · ')} · jetzt {eur(r.now)}</span>
      </span>
      <span className={`shrink-0 text-right font-bold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
        <span className="block">{signedPct(r.pct)}</span>
        <span className="block text-[10px] font-normal">{signedEur(r.delta)}</span>
      </span>
    </li>
  );
}

export function WeeklyMovers({ collection }) {
  const [period, setPeriod] = useState('7');
  const [sortKey, setSortKey] = useState('eur');
  const [state, setState] = useState({ loading: true, docs: {} });

  const idsKey = useMemo(
    () => [...new Set(collection.map((c) => c.id).filter((id) => id && !String(id).startsWith('custom-')))].sort().join('|'),
    [collection]
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split('|') : [];
    if (ids.length === 0) { setState({ loading: false, docs: {} }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loadCardPrices(ids).then((docs) => { if (alive) setState({ loading: false, docs }); });
    return () => { alive = false; };
  }, [idsKey]);

  const { rows, total, compared } = useMemo(() => {
    // gleiche Karte + Variante zusammenfassen (z. B. mehrere Zustände)
    const groups = new Map();
    for (const it of collection) {
      const d = state.docs[it.id];
      if (!d || !d.past || !d.past[period]) continue;
      const variant = it.userVariant || 'normal';
      const key = `${it.id}|${variant}`;
      const g = groups.get(key) || { item: it, variant, qty: 0, value: 0 };
      g.qty += qtyOf(it);
      g.value += (parseFloat(it.userPrice) || 0) * qtyOf(it);
      groups.set(key, g);
    }
    const out = [];
    for (const g of groups.values()) {
      const d = state.docs[g.item.id];
      const past = d.past[period];
      const nowT = d.prices.trendPrice || d.prices.averageSellPrice || 0;
      const nowH = d.prices.trendPriceHolo || d.prices.avg1Holo || 0;
      const idx = HOLO_VARIANTS.has(g.variant) && nowH > 0 && past[1] > 0 ? 1 : 0;
      const now = idx === 1 ? nowH : nowT;
      const was = Number(past[idx]) || 0;
      if (!(now > 0) || !(was > 0)) continue;
      const pct = (now / was - 1) * 100;
      out.push({
        key: `${g.item.id}|${g.variant}`, item: g.item, qty: g.qty, now, pct,
        delta: g.value * (1 - was / now), // Wertänderung deiner Exemplare
        variantLabel: g.variant === 'reverse' ? 'Reverse Holo' : g.variant === 'holo' ? 'Holo' : g.variant === 'firstEdition' ? '1st Edition' : ''
      });
    }
    return { rows: out, total: out.reduce((s, r) => s + r.delta, 0), compared: out.length };
  }, [collection, state.docs, period]);

  const ranked = (list) => [...list].sort((a, b) => (sortKey === 'eur' ? Math.abs(b.delta) - Math.abs(a.delta) : Math.abs(b.pct) - Math.abs(a.pct)));
  // Prozent-Ranking: Karten unter 0,50 € ausblenden (sonst gewinnen Cent-Karten mit +50 %)
  const eligible = sortKey === 'pct' ? rows.filter((r) => r.now >= 0.5) : rows;
  const gainers = ranked(eligible.filter((r) => r.pct > 0.05)).slice(0, 5);
  const losers = ranked(eligible.filter((r) => r.pct < -0.05)).slice(0, 5);
  const pill = (active) => `text-[10px] font-bold px-2 py-1 rounded-md border transition-colors ${active ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`;

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-bold text-slate-100 text-sm">📈 Gewinner & Verlierer</h3>
        <div className="flex gap-1">
          {[['1', '1 T'], ['7', '7 T'], ['30', '30 T']].map(([k, l]) => <button key={k} onClick={() => setPeriod(k)} className={pill(period === k)}>{l}</button>)}
          <span className="w-1" />
          {[['eur', '€'], ['pct', '%']].map(([k, l]) => <button key={k} onClick={() => setSortKey(k)} className={pill(sortKey === k)} title={k === 'eur' ? 'Nach Wertänderung sortieren' : 'Nach Prozent sortieren'}>{l}</button>)}
        </div>
      </div>

      {state.loading && <p className="text-xs text-slate-500">Lade Vergleichswerte …</p>}
      {!state.loading && compared === 0 && (
        <p className="text-xs text-slate-500">Noch keine Vergleichswerte für {period === '1' ? 'gestern' : `vor ${period} Tagen`}. Der Preisverlauf baut sich ab dem ersten Server-Lauf täglich auf.</p>
      )}
      {!state.loading && compared > 0 && (
        <>
          <p className="text-xs text-slate-400">
            Deine Collection (<span className="text-slate-300">{compared}</span> Karten verglichen):{' '}
            <span className={`font-bold ${total >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{signedEur(total)}</span> in {period === '1' ? '1 Tag' : `${period} Tagen`}
          </p>
          <div>
            <p className="text-[11px] font-bold text-emerald-300 mb-1">▲ Gestiegen</p>
            {gainers.length === 0 ? <p className="text-xs text-slate-500">Keine Karte ist gestiegen.</p> : <ul className="space-y-2">{gainers.map((r) => <MoverRow key={r.key} r={r} />)}</ul>}
          </div>
          <div className="pt-2 border-t border-slate-800">
            <p className="text-[11px] font-bold text-rose-300 mb-1">▼ Gefallen</p>
            {losers.length === 0 ? <p className="text-xs text-slate-500">Keine Karte ist gefallen.</p> : <ul className="space-y-2">{losers.map((r) => <MoverRow key={r.key} r={r} />)}</ul>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Push-Benachrichtigungen (Watchlist)
// ---------------------------------------------------------------------
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

function urlB64ToUint8Array(b64) {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Das Abo (Endpoint + Schlüssel) liegt unter users/{uid}/pushSubs/{hash} – der Server liest es beim Senden.
async function saveSubscription(sub) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Nicht angemeldet.');
  const json = sub.toJSON();
  const id = await sha256Hex(json.endpoint);
  await setDoc(doc(db, 'users', uid, 'pushSubs', id), {
    endpoint: json.endpoint, keys: json.keys, createdAt: Date.now(), ua: navigator.userAgent.slice(0, 140)
  });
  return id;
}

export function PushToggle({ apiUrl }) {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  const needsInstall = isIos && !standalone; // iOS: Push nur für die zum Home-Bildschirm hinzugefügte App

  const [checking, setChecking] = useState(true);
  const [hasSw, setHasSw] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState(supported ? Notification.permission : 'denied');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!supported) { setChecking(false); return undefined; }
    let alive = true;
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (!alive) return;
      setHasSw(!!reg);
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!alive) return;
      setSubscribed(!!sub);
      if (sub && auth.currentUser) saveSubscription(sub).catch(() => {}); // Abo dem aktuellen Konto zuordnen
      setChecking(false);
    }).catch(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [supported]);

  const enable = async () => {
    setBusy(true); setMsg('');
    try {
      if (!VAPID_PUBLIC_KEY) throw new Error('VITE_VAPID_PUBLIC_KEY fehlt (Vercel → Settings → Environment Variables).');
      const result = await Notification.requestPermission();
      setPerm(result);
      if (result !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt. Das lässt sich in den Browser- bzw. Systemeinstellungen ändern.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
      await saveSubscription(sub);
      setSubscribed(true);
      setMsg('Push ist aktiv ✓ Du wirst benachrichtigt, sobald eine Karte ihren Zielpreis erreicht.');
    } catch (e) {
      console.error('Push aktivieren fehlgeschlagen:', e);
      setMsg(e.message || 'Aktivieren fehlgeschlagen.');
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const uid = auth.currentUser?.uid;
        if (uid) await deleteDoc(doc(db, 'users', uid, 'pushSubs', await sha256Hex(sub.endpoint))).catch(() => {});
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg('Push ist ausgeschaltet.');
    } catch (e) { setMsg(e.message || 'Ausschalten fehlgeschlagen.'); } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true); setMsg('Sende Test … (der Server braucht nach Inaktivität evtl. bis zu einer Minute)');
    try {
      const token = await auth.currentUser.getIdToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);
      const res = await fetch(`${apiUrl}/api/push/test`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
      setMsg(data.sent > 0 ? 'Test gesendet – die Nachricht sollte gleich erscheinen. ✓' : 'Der Server konnte keine Nachricht zustellen. Bitte Push aus- und wieder einschalten.');
    } catch (e) {
      setMsg(e.name === 'AbortError' ? 'Der Server hat nicht geantwortet. Bitte gleich nochmal versuchen.' : (e.message || 'Test fehlgeschlagen.'));
    } finally { setBusy(false); }
  };

  let hint = 'Eine Nachricht aufs Handy, sobald eine Watchlist-Karte ihren Zielpreis erreicht – auch wenn die App zu ist.';
  if (!supported) hint = 'Dieser Browser unterstützt keine Push-Nachrichten.';
  else if (needsInstall) hint = 'Auf iPhone/iPad geht Push nur mit der installierten App: Teilen → „Zum Home-Bildschirm“, dann von dort öffnen und hier aktivieren.';
  else if (perm === 'denied') hint = 'Benachrichtigungen sind für diese Seite blockiert – in den Browser-/Systemeinstellungen wieder erlauben.';
  else if (!checking && !hasSw) hint = 'Der Service Worker ist nicht aktiv (läuft nur in der veröffentlichten App, nicht im Entwicklungsmodus).';

  const canUse = supported && !needsInstall && perm !== 'denied' && hasSw;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-100">🔔 Push bei Zielpreis</p>
          <p className="text-[11px] text-slate-500">{hint}</p>
        </div>
        {canUse && (subscribed
          ? <button onClick={disable} disabled={busy} className="shrink-0 text-xs font-bold px-3 py-2 rounded-lg border bg-slate-950 text-slate-300 border-slate-700 hover:border-rose-500 disabled:opacity-50">Ausschalten</button>
          : <button onClick={enable} disabled={busy || checking} className="shrink-0 text-xs font-black px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 disabled:opacity-50">Einschalten</button>)}
      </div>
      {canUse && subscribed && (
        <button onClick={sendTest} disabled={busy} className="text-[11px] font-bold text-cyan-400 hover:underline disabled:opacity-50">Test-Nachricht senden</button>
      )}
      {msg && <p className="text-[11px] text-slate-300">{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// „Kosten bis komplett“ für die Fehlt-Liste eines Binders
// ---------------------------------------------------------------------
// ids: Karten-IDs aller fehlenden Slots (Duplikate zählen mehrfach, wie im Binder).
// Die Preise werden per onPrices an den Binder zurückgegeben, damit die Liste sie pro Zeile zeigen kann.
export function MissingCost({ ids, api, prices, onPrices, unpicked = 0 }) {
  const [state, setState] = useState({ loading: false, error: '' });
  const key = ids.join('|');

  useEffect(() => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) { onPrices({}); setState({ loading: false, error: '' }); return undefined; }
    let alive = true;
    setState({ loading: true, error: '' });
    fetchPrices(unique, api).then((res) => {
      if (!alive) return;
      const map = {};
      unique.forEach((id) => { map[id] = watchPrice(res[id] && res[id].prices); });
      onPrices(map);
      setState({ loading: false, error: '' });
    }).catch((e) => {
      if (alive) setState({ loading: false, error: e.name === 'AbortError' ? 'Der Server antwortet nicht (Render-Gratisplan schläft). Bitte die Liste in einer Minute erneut öffnen.' : (e.message || 'Preise konnten nicht geladen werden.') });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, api]);

  if (ids.length === 0) return null;
  const total = ids.reduce((s, id) => s + (prices[id] || 0), 0);
  const noPrice = ids.filter((id) => !(prices[id] > 0)).length;

  return (
    <div className="space-y-1">
      <div className="bg-slate-950 border border-amber-500/30 rounded-lg px-3 py-2 flex items-baseline justify-between gap-3">
        <span className="text-xs text-slate-400">💶 Kosten bis komplett</span>
        <span className="text-lg font-black text-amber-300">{state.loading ? '…' : eur(total)}</span>
      </div>
      {state.error && <p className="text-[10px] text-rose-400">{state.error}</p>}
      {!state.loading && !state.error && (
        <p className="text-[10px] text-slate-500">
          Summe der aktuellen Cardmarket-Trendpreise der {ids.length} fehlenden Karten.
          {noPrice > 0 ? ` ${noPrice} ohne Preis, nicht eingerechnet.` : ''}
          {unpicked > 0 ? ` ${unpicked} Slot${unpicked === 1 ? '' : 's'} ohne gewählte Karte fehl${unpicked === 1 ? 't' : 'en'} in der Rechnung.` : ''}
        </p>
      )}
    </div>
  );
}
