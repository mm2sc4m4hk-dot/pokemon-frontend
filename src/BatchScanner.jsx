// Batch-Import per Foto: ein Foto einer Binder-Seite (z. B. 3×3) wird in Felder zerlegt,
// jedes Feld per KI analysiert, gesucht und geprüft.
// Danach kannst du die Treffer kontrollieren und alle auf einmal in die Collection legen.
import React, { useState, useRef, useEffect } from 'react';
import { readCard, loadImageSource } from './CardScanner';
import { coverRect, buildQuery } from './scanParse';
import { rankByImage } from './imageMatch';
import { watchPrice } from './priceData';
import { OwnedBadge } from './Backup';

const plain = (n) => String(n || '').replace(/\s*\[.*\]\s*$/, '');
const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;

// Raster über das Foto legen (trim = Rand in %, der auf allen Seiten abgeschnitten wird)
function cellRects(w, h, rows, cols, trim) {
  const tx = (w * trim) / 100;
  const ty = (h * trim) / 100;
  const cw = (w - 2 * tx) / cols;
  const ch = (h - 2 * ty) / rows;
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) out.push({ x: tx + c * cw, y: ty + r * ch, w: cw, h: ch });
  }
  return out;
}

// Aus einem Feld das größte mittige 5:7-Rechteck (Kartenformat) ausschneiden
function cellCanvas(source, rect) {
  const { sx, sy, sw } = coverRect(rect.w, rect.h);
  const sh = (sw * 7) / 5;
  const outW = Math.min(1100, Math.round(sw));
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = Math.round((outW * 7) / 5);
  c.getContext('2d').drawImage(source, rect.x + sx, rect.y + sy, sw, Math.min(sh, rect.h), 0, 0, c.width, c.height);
  return c;
}

function smallThumb(canvas) {
  const c = document.createElement('canvas');
  c.width = 140;
  c.height = 196;
  c.getContext('2d').drawImage(canvas, 0, 0, 140, 196);
  try { return c.toDataURL('image/jpeg', 0.6); } catch (e) { return ''; }
}

export default function BatchScanner({ onClose, onSearch, onAdd, Img, api, conditions, languages, defaultCondition, defaultLanguage, owned }) {
  const [step, setStep] = useState('setup'); // setup | review
  const [photo, setPhoto] = useState(null); // { url, w, h, source }
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [trim, setTrim] = useState(3);
  const [cells, setCells] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [cond, setCond] = useState(defaultCondition);
  const [lang, setLang] = useState(defaultLanguage);
  const [adding, setAdding] = useState(false);

  const aliveRef = useRef(true);
  const canvases = useRef([]);
  const urlRef = useRef(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const patch = (i, p) => setCells((prev) => prev.map((c) => (c.idx === i ? { ...c, ...p } : c)));

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const { source, w, h } = await loadImageSource(file);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setPhoto({ url, w, h, source });
    } catch (err) {
      setError('Das Foto konnte nicht gelesen werden.');
    }
  };

  // Name/Nummer suchen (erst mit Nummer, sonst nur Name), mehrere Treffer per Bildvergleich sortieren
  const lookup = async (name, number, canvas) => {
    const nm = String(name || '').trim();
    if (!nm) return { cards: [], scores: {} };
    let list = await onSearch(buildQuery(nm, number));
    if (list.length === 0 && number) list = await onSearch(nm);
    if (list.length > 1 && canvas) {
      try { return await rankByImage(canvas, list, api); } catch (e) { /* ohne Bildvergleich */ }
    }
    return { cards: list, scores: {} };
  };

  const run = async () => {
    if (!photo || running) return;
    const rects = cellRects(photo.w, photo.h, rows, cols, trim);
    canvases.current = [];
    setError('');
    setStep('review');
    setRunning(true);
    setCells(rects.map((_, i) => ({ idx: i, status: 'wait', name: '', number: '', thumb: '', cards: [], scores: {}, sel: -1, include: false })));
    
    try {
      for (let i = 0; i < rects.length; i += 1) {
        if (!aliveRef.current) return;
        setProgress(`Karte ${i + 1} / ${rects.length} wird per KI analysiert …`);
        const canvas = cellCanvas(photo.source, rects[i]);
        canvases.current[i] = canvas;
        const base64Image = canvas.toDataURL('image/jpeg', 0.85);

        let name = '';
        let number = '';
        let foundCards = [];
        let scores = {};
        let status = 'none';

        try {
          const scanResult = await readCard(base64Image);
          name = scanResult.aiAnalysis?.name || '';
          number = scanResult.aiAnalysis?.number || '';
          foundCards = scanResult.results || [];

          // Fallback-Suche, falls Backend-Ergebnis leer ist, aber ein Name/Nummer von KI erkannt wurde
          if (foundCards.length === 0 && (name || number)) {
            const fallback = await lookup(name, number, canvas);
            foundCards = fallback.cards || [];
            scores = fallback.scores || {};
          }

          status = foundCards.length ? 'ok' : 'none';
        } catch (e) {
          status = 'error';
        }

        if (!aliveRef.current) return;
        patch(i, {
          status,
          name,
          number,
          thumb: smallThumb(canvas),
          cards: foundCards,
          scores,
          sel: foundCards.length ? 0 : -1,
          include: foundCards.length > 0
        });
      }
    } catch (e) {
      if (aliveRef.current) setError('Analyse fehlgeschlagen: ' + ((e && e.message) || 'Unbekannter Fehler'));
    } finally {
      if (aliveRef.current) { setRunning(false); setProgress(''); }
    }
  };

  const research = async (i) => {
    const c = cells[i];
    patch(i, { status: 'wait' });
    try {
      const found = await lookup(c.name, c.number, canvases.current[i]);
      patch(i, { status: found.cards.length ? 'ok' : 'none', cards: found.cards, scores: found.scores, sel: found.cards.length ? 0 : -1, include: found.cards.length > 0 });
    } catch (e) { patch(i, { status: 'error' }); }
  };

  const chosenOf = (c) => (c.sel >= 0 ? c.cards[c.sel] : null);
  const count = cells.filter((c) => c.include && chosenOf(c)).length;

  const doAdd = async () => {
    const picked = new Map();
    cells.forEach((c) => {
      const card = chosenOf(c);
      if (!c.include || !card) return;
      const e = picked.get(card.id) || { card, qty: 0 };
      e.qty += 1;
      picked.set(card.id, e);
    });
    if (picked.size === 0) return;
    setAdding(true);
    try {
      await onAdd([...picked.values()], cond, lang);
      onClose();
    } catch (e) {
      setError('Hinzufügen fehlgeschlagen: ' + ((e && e.message) || 'Unbekannter Fehler'));
      setAdding(false);
    }
  };

  const inputCls = 'w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-md px-2 py-1 text-xs outline-none';
  const pill = (active) => `px-3 py-1.5 rounded-lg text-xs font-bold border ${active ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800'}`;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/20 bg-slate-900">
        <h2 className="font-black text-cyan-400 text-sm">🗂️ Mehrere Karten per Foto</h2>
        <button onClick={onClose} className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-rose-400">Schließen ✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {step === 'setup' && (
          <div className="space-y-4 max-w-xl mx-auto">
            <p className="text-xs text-slate-400">
              Fotografiere eine ganze Binder-Seite (oder Karten in einem Raster) von oben, gerade und ohne Blitz-Reflexe.
              Stelle unten Reihen und Spalten ein, sodass das Raster genau über den Karten liegt.
            </p>
            <label className="block text-center cursor-pointer bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black py-3 rounded-xl text-sm transition-colors">
              📷 Foto aufnehmen / auswählen
              <input type="file" accept="image/*" onChange={onFile} className="hidden" />
            </label>
            {error && <p className="text-xs text-amber-300">{error}</p>}

            {photo && (
              <>
                <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-black">
                  <img src={photo.url} alt="Foto" className="w-full block" />
                  <div
                    className="absolute grid pointer-events-none"
                    style={{ left: `${trim}%`, right: `${trim}%`, top: `${trim}%`, bottom: `${trim}%`, gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
                  >
                    {Array.from({ length: rows * cols }, (_, i) => (
                      <div key={i} className="border border-dashed border-cyan-300/80 flex items-start justify-start">
                        <span className="text-[10px] bg-slate-950/70 text-cyan-300 px-1 rounded-br">{i + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-slate-400 mb-1">Reihen</p>
                    <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRows(n)} className={`flex-1 ${pill(rows === n)}`}>{n}</button>)}</div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400 mb-1">Spalten</p>
                    <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setCols(n)} className={`flex-1 ${pill(cols === n)}`}>{n}</button>)}</div>
                  </div>
                </div>
                <label className="block text-[10px] text-slate-400">
                  Rand abschneiden: {trim} %
                  <input type="range" min="0" max="20" value={trim} onChange={(e) => setTrim(Number(e.target.value))} className="w-full accent-cyan-500" />
                </label>
                <button onClick={run} className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black py-3 rounded-xl text-sm transition-colors">
                  🔍 {rows * cols} Karten erkennen
                </button>
              </>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3 max-w-3xl mx-auto">
            {running && (
              <div className="bg-slate-900 border border-cyan-500/30 rounded-xl p-3 text-xs text-cyan-300 flex items-center gap-2">
                <span className="animate-spin">⚡</span> {progress}
              </div>
            )}
            {error && <p className="text-xs text-amber-300">{error}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cells.map((c, i) => {
                const chosen = chosenOf(c);
                const score = chosen ? c.scores[chosen.id] : null;
                return (
                  <div key={c.idx} className={`bg-slate-900 border rounded-xl p-2 space-y-2 ${c.include ? 'border-cyan-500/50' : 'border-slate-800'}`}>
                    <div className="flex gap-2">
                      <div className="w-16 shrink-0">
                        {c.thumb ? <img src={c.thumb} alt="Foto" className="w-full rounded border border-slate-800" /> : <div className="aspect-[5/7] rounded border border-dashed border-slate-700" />}
                        <p className="text-[9px] text-slate-500 text-center mt-0.5">Platz {Math.floor(i / cols) + 1}/{(i % cols) + 1}</p>
                      </div>
                      <div className="w-16 shrink-0">
                        {chosen
                          ? <Img src={chosen.images && chosen.images.small} alt={chosen.name} className="w-full rounded" />
                          : <div className="aspect-[5/7] rounded border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-lg">{c.status === 'wait' ? '…' : '?'}</div>}
                        <p className="text-[9px] text-slate-500 text-center mt-0.5">Treffer</p>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="grid grid-cols-3 gap-1">
                          <input value={c.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Name" className={`col-span-2 ${inputCls}`} />
                          <input value={c.number} onChange={(e) => patch(i, { number: e.target.value })} placeholder="44/102" className={inputCls} />
                        </div>
                        <select
                          value={c.sel}
                          onChange={(e) => { const sel = Number(e.target.value); patch(i, { sel, include: sel >= 0 }); }}
                          className={inputCls}
                          disabled={c.cards.length === 0}
                        >
                          <option value={-1}>{c.cards.length ? '— keine —' : 'Kein Treffer'}</option>
                          {c.cards.slice(0, 12).map((card, k) => (
                            <option key={card.id} value={k}>
                              {plain(card.name)}{card.number ? ` #${card.number}` : ''} · {(card.set && card.set.name) || '?'}{c.scores[card.id] != null ? ` · ${c.scores[card.id]} %` : ''}
                            </option>
                          ))}
                        </select>
                        {chosen && (
                          <p className="text-[10px] text-slate-400 truncate">
                            <span className="text-cyan-400 font-bold">{eur(watchPrice(chosen.cardmarket && chosen.cardmarket.prices))}</span>
                            {score != null ? ` · Bildähnlichkeit ${score} %` : ''}
                          </p>
                        )}
                        {chosen && owned && <OwnedBadge info={owned.get(chosen.id)} />}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={c.include && !!chosen} disabled={!chosen} onChange={(e) => patch(i, { include: e.target.checked })} className="accent-cyan-500" />
                        Hinzufügen
                      </label>
                      <span className="text-[10px] text-slate-500">
                        {c.status === 'wait' && 'wird analysiert …'}
                        {c.status === 'none' && (c.name ? 'nichts gefunden' : 'leer / nicht erkannt')}
                        {c.status === 'error' && 'Suche fehlgeschlagen'}
                      </span>
                      <button onClick={() => research(i)} disabled={running || c.status === 'wait'} className="text-[11px] font-bold text-cyan-400 hover:underline disabled:opacity-40">Neu suchen</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {step === 'review' && (
        <div className="border-t border-cyan-500/20 bg-slate-900 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 max-w-3xl mx-auto">
            <select value={cond} onChange={(e) => setCond(e.target.value)} className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2 text-xs">
              {conditions.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2 text-xs">
              {languages.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2 max-w-3xl mx-auto">
            <button onClick={() => { if (!running) { setStep('setup'); setCells([]); } }} disabled={running} className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-bold py-3 rounded-xl text-sm border border-slate-700">← Anderes Foto</button>
            <button onClick={doAdd} disabled={adding || running || count === 0} className="flex-[2] bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-black py-3 rounded-xl text-sm transition-colors">
              {adding ? '⏳ Speichere …' : `➕ ${count} Karten zur Collection`}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 text-center">Zustand und Sprache gelten für alle Karten dieses Fotos. Variante und Preis werden automatisch gesetzt und lassen sich später in der Collection bearbeiten.</p>
        </div>
      )}
    </div>
  );
}