// Karten-Scanner (Backend: POST /api/scan-genai).
// Passt zu den Aufrufen in App.jsx:
//   <CardScanner mode="collection"|"search" onClose onResult onSearch onPick Img owned api series onSeriesChange history onUndo />
// Exportiert außerdem readCard + loadImageSource für BatchScanner.jsx.
import React, { useState, useRef, useEffect } from 'react';
import { buildQuery } from './scanParse';
import { rankByImage } from './imageMatch';
import { watchPrice } from './priceData';
import { OwnedBadge } from './Backup';

const API_URL = import.meta.env.VITE_API_URL || 'https://pokemon-backend-x7l7.onrender.com';

const plain = (n) => String(n || '').replace(/\s*\[.*\]\s*$/, '');
const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LANG_LABEL = { de: 'Deutsch', en: 'Englisch', ja: 'Japanisch', ko: 'Koreanisch', zh: 'Chinesisch' };

// ==========================================
// Exporte für BatchScanner
// ==========================================
export const loadImageSource = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => resolve({ source: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

// Ein Versuch. Der Server wiederholt bei Überlastung selbst.
async function readCardOnce(base64Image, api) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000); // Render-Gratisplan kann schlafen
  try {
    const response = await fetch(`${api}/api/scan-genai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ image: base64Image })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 429) { const e = new Error('Zu viele Scans auf einmal. Bitte kurz warten.'); e.final = true; throw e; }
    if (response.status === 503) { const e = new Error('Der Scan ist gerade ausgelastet. Bitte warte kurz und scanne erneut.'); e.busy = true; throw e; }
    if (!response.ok) { const e = new Error(data.error || `Fehler beim Scannen (Status ${response.status}).`); e.final = true; throw e; }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('Der Server hat nicht geantwortet (schläft evtl.). Bitte gleich nochmal versuchen.'); t.busy = true; throw t; }
    if (e instanceof TypeError) { const t = new Error('Keine Verbindung zum Server. Internet prüfen und erneut versuchen.'); t.busy = true; throw t; }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Mit einer automatischen Wiederholung (nach 3 s) bei Überlastung/Netzfehler
export const readCard = async (base64Image, api = API_URL, { retries = 1 } = {}) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readCardOnce(base64Image, api);
    } catch (e) {
      if (!e.busy || attempt >= retries) throw e;
      await sleep(3000);
    }
  }
};

// Foto verkleinern (schneller Upload, unter dem 10-MB-Limit des Servers)
function shrinkToCanvas(source, w, h, maxSide = 900) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// ==========================================
// Scan-Verlauf mit „Rückgängig“ (auch in App.jsx unter der Collection genutzt)
// ==========================================
const hhmm = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export function ScanHistory({ history = [], onUndo, onClear, Img, compact = false }) {
  const [busyId, setBusyId] = useState(null);
  if (!history.length || !onUndo) return null;
  const Pic = Img || 'img';

  const undo = async (entry) => {
    if (busyId) return;
    setBusyId(entry.docId);
    try { await onUndo(entry); } finally { setBusyId(null); }
  };

  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-amber-300">🕘 Zuletzt gescannt ({history.length})</h3>
        {onClear && !compact && <button onClick={onClear} className="text-[11px] text-slate-400 hover:text-slate-200 underline">Liste leeren</button>}
      </div>
      <ul className="space-y-1.5">
        {history.slice(0, compact ? 5 : 30).map((h) => (
          <li key={h.docId} className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg p-1.5">
            <Pic src={h.image} alt={h.name} className="w-8 rounded shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-200 truncate">{h.name}{h.number ? <span className="text-slate-500 font-normal"> #{h.number}</span> : null}</p>
              <p className="text-[10px] text-slate-500 truncate">{h.set || 'Unbekanntes Set'} · {h.condition}{h.variant && h.variant !== 'normal' ? ` · ${h.variant === 'reverse' ? 'Reverse Holo' : h.variant === 'holo' ? 'Holo' : h.variant}` : ''} · {hhmm(h.at)}</p>
            </div>
            <button
              onClick={() => undo(h)}
              disabled={!!busyId}
              className="shrink-0 text-[11px] font-black px-2.5 py-1 rounded-lg border bg-slate-900 text-rose-300 border-rose-500/40 hover:bg-rose-500 hover:text-slate-950 disabled:opacity-50"
            >{busyId === h.docId ? '…' : '↩ Rückgängig'}</button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-slate-500">Rückgängig löscht den Eintrag wieder aus der Collection{compact ? '' : ' (stammt die Karte von der Watchlist, kommt sie dorthin zurück)'}.</p>
    </div>
  );
}

// ==========================================
// Komponente
// ==========================================
export default function CardScanner({ mode = 'collection', onClose, onResult, onSearch, onPick, Img, owned, api = API_URL, series = false, onSeriesChange, history = [], onUndo }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [scanned, setScanned] = useState(false);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [meta, setMeta] = useState({ set: '', language: '' });
  const [variant, setVariant] = useState('');          // erkannte/gewählte Variante ('' = unbekannt)
  const [variantAuto, setVariantAuto] = useState(false); // true = vom Modell vorgeschlagen, nicht bestätigt
  const [cards, setCards] = useState([]);
  const [scores, setScores] = useState({});
  const canvasRef = useRef(null);
  const dataUrlRef = useRef('');
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Treffer werden sofort angezeigt; der Bildvergleich läuft im Hintergrund und sortiert danach nur um
  const rankToken = useRef(0);
  const rankInBackground = (list) => {
    rankToken.current += 1;
    const token = rankToken.current;
    const canvas = canvasRef.current;
    if (list.length < 2 || !canvas) return;
    rankByImage(canvas, list, api, 8)
      .then((r) => {
        if (aliveRef.current && rankToken.current === token) { setCards(r.cards); setScores(r.scores); }
      })
      .catch(() => { /* ohne Bildvergleich */ });
  };

  // Analysiert das aktuelle Foto (auch für „Erneut versuchen“, ohne neu zu fotografieren)
  const analyze = async (dataUrl) => {
    setBusy(true); setError(''); setScanned(false); setCards([]); setScores({});
    setStatus('Karte wird gescannt …');
    try {
      const data = await readCard(dataUrl, api);
      if (!aliveRef.current) return;
      const ai = data.aiAnalysis || {};
      setName(ai.name || '');
      setNumber(ai.number || '');
      setMeta({ set: ai.set || '', language: ai.language || '' });
      setVariant(ai.variant || '');
      setVariantAuto(!!ai.variant);

      let list = Array.isArray(data.results) ? data.results : [];
      if (list.length === 0 && ai.name && onSearch) {
        setStatus('Suche in der Datenbank …');
        try { list = await onSearch(buildQuery(ai.name, ai.number)); } catch (err) { /* unten: kein Treffer */ }
        if (list.length === 0 && ai.number) { try { list = await onSearch(ai.name); } catch (err) { /* egal */ } }
      }
      if (!aliveRef.current) return;
      setCards(list);
      setScores({});
      setScanned(true);
      rankInBackground(list);
    } catch (err) {
      if (aliveRef.current) setError(err.message || 'Scan fehlgeschlagen.');
    } finally {
      if (aliveRef.current) { setBusy(false); setStatus(''); }
    }
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || busy) return;
    setError('');
    try {
      const { source, w, h } = await loadImageSource(file);
      const canvas = shrinkToCanvas(source, w, h);
      canvasRef.current = canvas;
      dataUrlRef.current = canvas.toDataURL('image/jpeg', 0.8);
      setPreview(dataUrlRef.current);
      await analyze(dataUrlRef.current);
    } catch (err) {
      setError('Das Foto konnte nicht gelesen werden.');
    }
  };

  const research = async () => {
    if (!name.trim() || !onSearch || busy) return;
    setBusy(true); setError(''); setStatus('Suche in der Datenbank …');
    try {
      let list = await onSearch(buildQuery(name, number));
      if (list.length === 0 && number) list = await onSearch(name.trim());
      if (!aliveRef.current) return;
      setCards(list);
      setScores({});
      setScanned(true);
      rankInBackground(list);
    } catch (err) {
      if (aliveRef.current) setError(err.message || 'Suche fehlgeschlagen.');
    } finally {
      if (aliveRef.current) { setBusy(false); setStatus(''); }
    }
  };

  const takeToSearch = () => {
    if (!name.trim() || !onResult) return;
    onResult({ query: buildQuery(name, number), name: name.trim(), number: String(number || '').trim() });
  };

  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); research(); } };

  const inputCls = 'w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-lg px-3 py-2 text-sm outline-none';
  const btnCls = 'block text-center cursor-pointer font-black py-3 rounded-xl text-sm transition-colors';
  const disabled = busy ? 'opacity-50 pointer-events-none' : '';

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/20 bg-slate-900">
        <h2 className="font-black text-cyan-400 text-sm">📷 Karte scannen</h2>
        <button onClick={onClose} className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-rose-400">Schließen ✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-xl mx-auto space-y-4">
          <p className="text-xs text-slate-400">
            Fotografiere eine einzelne Karte gerade von oben, ohne Blitz-Reflexe. Name und Nummer werden erkannt und die Karte wird in der Datenbank gesucht.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <label className={`${btnCls} bg-cyan-500 hover:bg-cyan-400 text-slate-950 ${disabled}`}>
              📷 Kamera
              <input type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" disabled={busy} />
            </label>
            <label className={`${btnCls} bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 ${disabled}`}>
              🖼️ Aus Galerie
              <input type="file" accept="image/*" onChange={onFile} className="hidden" disabled={busy} />
            </label>
          </div>

          {mode === 'collection' && onSeriesChange && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={!!series} onChange={(e) => onSeriesChange(e.target.checked)} className="accent-cyan-500" />
              Serienmodus: nach dem Hinzufügen direkt die nächste Karte scannen
            </label>
          )}

          {busy && (
            <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-3 text-xs text-cyan-300 flex items-center gap-2">
              <span className="animate-spin">⚡</span> {status || 'Bitte warten …'} <span className="text-slate-500">(nach Inaktivität braucht der Server evtl. bis zu einer Minute)</span>
            </div>
          )}

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 space-y-2">
              <p className="text-xs text-rose-300">{error}</p>
              {dataUrlRef.current && !busy && (
                <button onClick={() => analyze(dataUrlRef.current)} className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950">🔄 Erneut versuchen (gleiches Foto)</button>
              )}
            </div>
          )}

          {preview && (
            <div className="flex gap-3 items-start">
              <img src={preview} alt="Scan" className="w-24 rounded-lg border border-slate-700 shrink-0" />
              {scanned && (
                <div className="flex-1 space-y-2">
                  <p className="text-[10px] text-slate-400">Erkannt – bei Bedarf korrigieren:</p>
                  <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} placeholder="Name" className={inputCls} />
                  <input value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={onEnter} placeholder="Nummer, z. B. 44/102" className={inputCls} />
                  {(meta.set || meta.language) && (
                    <p className="text-[10px] text-slate-500">
                      {meta.language ? `Sprache: ${LANG_LABEL[meta.language] || meta.language}` : ''}{meta.language && meta.set ? ' · ' : ''}{meta.set ? `Set: ${meta.set}` : ''}
                    </p>
                  )}
                  {mode === 'collection' && (
                    <div>
                      <select
                        value={variant}
                        onChange={(e) => { setVariant(e.target.value); setVariantAuto(false); }}
                        className={inputCls}
                      >
                        <option value="">Variante: Standard</option>
                        <option value="normal">Normal</option>
                        <option value="reverse">Reverse Holo</option>
                        <option value="holo">Holo</option>
                      </select>
                      {variantAuto && variant && <p className="text-[10px] text-amber-300 mt-0.5">Automatisch erkannt – bitte prüfen. Wird nur übernommen, wenn es die Variante für die Karte gibt.</p>}
                    </div>
                  )}
                  <button onClick={research} disabled={busy || !name.trim()} className="text-[11px] font-bold text-cyan-400 hover:underline disabled:opacity-40">Neu suchen</button>
                </div>
              )}
            </div>
          )}

          {scanned && mode === 'search' && (
            <button onClick={takeToSearch} disabled={!name.trim()} className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-black py-3 rounded-xl text-sm">
              🔍 „{buildQuery(name, number)}“ in der Suche öffnen
            </button>
          )}

          {scanned && mode !== 'search' && (
            cards.length === 0 ? (
              <p className="text-xs text-amber-300">Keine passende Karte gefunden. Name/Nummer oben anpassen und „Neu suchen“ tippen.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-200">Treffer ({cards.length}) – Karte antippen zum Hinzufügen</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {cards.slice(0, 12).map((card) => (
                    <button key={card.id} onClick={() => onPick && onPick(card, mode === 'collection' ? (variant || null) : null, variantAuto)} className="text-left bg-slate-900 border border-slate-800 hover:border-cyan-500 rounded-xl p-2 space-y-1 transition-colors">
                      {Img
                        ? <Img src={card.images && card.images.small} alt={card.name} className="w-full rounded-lg" />
                        : <img src={card.images && card.images.small} alt={card.name} className="w-full rounded-lg" />}
                      <p className="text-xs font-bold text-slate-200 truncate">{plain(card.name)}{card.number ? <span className="text-slate-500 font-normal"> #{card.number}</span> : null}</p>
                      <p className="text-[10px] text-slate-400 truncate">{(card.set && card.set.name) || 'Unbekanntes Set'}</p>
                      <p className="text-[11px] text-cyan-400 font-bold">
                        {eur(watchPrice(card.cardmarket && card.cardmarket.prices))}
                        {scores[card.id] != null ? <span className="text-slate-500 font-normal"> · {scores[card.id]} % ähnlich</span> : null}
                      </p>
                      {owned && <OwnedBadge info={owned.get(card.id)} />}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}

          {mode === 'collection' && <ScanHistory history={history} onUndo={onUndo} Img={Img} compact />}
        </div>
      </div>
    </div>
  );
}
