// Karten-Scanner: Kamera (oder Foto) -> Texterkennung im Browser (Tesseract.js, kostenlos, kein Server)
// -> Name + Kartennummer -> Suche. Benötigt:  npm install tesseract.js
//
// mode="search":      erkannter Text geht direkt an die Suche (onResult)
// mode="collection":  Treffer werden hier gezeigt, ein Tipp übernimmt die Karte (onPick)
import React, { useState, useEffect, useRef } from 'react';
import { cleanName, parseNumber, buildQuery, coverRect } from './scanParse';
import { watchPrice } from './priceData';
import { OwnedBadge } from './Backup';
import { rankByImage } from './imageMatch';

// ---- gemeinsamer OCR-Worker (wird nach dem Schließen nach 60 s wieder freigegeben) ----
let workerPromise = null;
let idleTimer = null;

export function getWorker(onStatus) {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) =>
      createWorker('deu+eng+jpn+kor+chi_sim+chi_tra', 1, {
        logger: (m) => {
          if (onStatus && m && typeof m.progress === 'number' && /load|init/i.test(m.status || '')) {
            onStatus(`Lade Texterkennung … ${Math.round(m.progress * 100)} %`);
          }
        }
      })
    ).catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

export function releaseWorkerLater() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const p = workerPromise;
    workerPromise = null; idleTimer = null;
    if (p) p.then((w) => w.terminate()).catch(() => {});
  }, 60000);
}

// ---- Bild-Helfer ----
// Kartenausschnitt (5:7) aus Video/Bild in ein Canvas kopieren
function cardCanvas(source, w, h) {
  const { sx, sy, sw, sh } = coverRect(w, h);
  const outW = Math.min(1100, Math.round(sw));
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = Math.round(outW * 7 / 5);
  c.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

// Bereich ausschneiden, vergrößern, Graustufen + Kontrast strecken.
// invert: true/false oder 'auto' (dunkler Hintergrund -> umkehren)
function prepare(src, x, y, w, h, targetW, invert = 'auto', threshold = false) {
  const scale = targetW / w;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(targetW));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const n = c.width * c.height;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    gray[p] = g; hist[g] += 1;
  }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  let sum = 0;
  for (let p = 0; p < n; p++) { gray[p] = Math.max(0, Math.min(255, ((gray[p] - lo) * 255) / span)); sum += gray[p]; }
  const doInvert = invert === 'auto' ? sum / n < 100 : !!invert;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = doInvert ? 255 - gray[p] : gray[p];
    const out = threshold ? (v >= 160 ? 255 : 0) : v;
    d[i] = d[i + 1] = d[i + 2] = out; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, inverted: doInvert };
}

// Name oben + Nummer unten lesen
function normalizeOcrLine(raw) {
  return String(raw || '')
    .normalize('NFKC')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[|¦]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameCandidatesFromOcr(raw) {
  const text = normalizeOcrLine(raw);
  if (!text) return [];
  const lines = String(raw || '')
    .normalize('NFKC')
    .split(/\r?\n/)
    .map(normalizeOcrLine)
    .filter(Boolean);

  const out = [];
  const add = (v) => {
    const x = normalizeOcrLine(v);
    if (!x || x.length < 2 || out.includes(x)) return;
    out.push(x);
    const cleaned = cleanName(x);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  };

  lines.forEach(add);
  add(text);

  // OCR hängt bei schlechten Fotos gern kurze Fragmente vor den eigentlichen Namen.
  // Einzelne Tokens werden deshalb ebenfalls als Suchkandidaten versucht.
  const tokens = text.split(/\s+/).filter((x) => x.length >= 3);
  tokens
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
    .forEach(add);

  return out.slice(0, 8);
}

export async function readCard(worker, card) {
  const cw = card.width, ch = card.height;

  // Der bisherige Ausschnitt war zu schmal: bei vielen Karten wurden die ersten/letzten
  // Zeichen des Namens abgeschnitten. Der Name darf praktisch die komplette obere Zeile nutzen.
  const nameBox = [0.02 * cw, 0.012 * ch, 0.96 * cw, 0.145 * ch];
  const numBox = [0.01 * cw, 0.875 * ch, 0.98 * cw, 0.125 * ch];

  const runName = async (canvas, psm) => {
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: String(psm) });
    return worker.recognize(canvas);
  };

  const nameRuns = [];
  let nameThumb = null;

  for (const [invert, threshold, psm] of [
    ['auto', false, 7],
    [false, false, 7],
    [true, false, 7],
    ['auto', true, 7],
    ['auto', false, 6]
  ]) {
    const p = prepare(card, ...nameBox, 1200, invert, threshold);
    const r = await runName(p.canvas, psm);
    const raw = r?.data?.text || '';
    const candidates = nameCandidatesFromOcr(raw);
    if (candidates.length) {
      nameRuns.push(...candidates);
      if (!nameThumb) nameThumb = p.canvas;
    }
  }

  // Doppelte Kandidaten entfernen, Reihenfolge/erste brauchbare OCR-Variante behalten.
  const nameCandidates = [...new Set(nameRuns)].slice(0, 12);
  let name = nameCandidates[0] || '';

  // Nummern brauchen eine harte Zeichenmenge, damit Karten-Text nicht als Nummer endet.
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.-',
    tessedit_pageseg_mode: '11'
  });

  const numberRuns = [];
  let numThumb = null;
  for (const [invert, threshold] of [
    ['auto', false],
    [false, false],
    [true, false],
    ['auto', true]
  ]) {
    const q = prepare(card, ...numBox, 1600, invert, threshold);
    const raw = (await worker.recognize(q.canvas))?.data?.text || '';
    const parsed = parseNumber(raw);
    if (parsed) numberRuns.push(parsed);
    if (!numThumb) numThumb = q.canvas;
  }

  // Häufig liefert ein OCR-Lauf 044/102 und ein anderer 44/102. Der Parser entscheidet,
  // welche Variante gültig ist; die erste gültige bleibt die Anzeige.
  const number = numberRuns[0] || '';

  const thumb = (c) => {
    try { return c ? c.toDataURL('image/jpeg', 0.6) : ''; }
    catch (e) { return ''; }
  };

  return {
    name,
    nameCandidates,
    number,
    thumbs: { name: thumb(nameThumb), num: thumb(numThumb) }
  };
}


export async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, w: bmp.width, h: bmp.height };
    } catch (e) { /* weiter mit <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = reject; el.src = url;
    });
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;

export default function CardScanner({ mode, onClose, onResult, onSearch, onPick, Img, series, onSeriesChange, owned, api }) {
  const [phase, setPhase] = useState('camera'); // camera | reading | result
  const [camError, setCamError] = useState('');
  const [camReady, setCamReady] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [thumbs, setThumbs] = useState(null);
  const [results, setResults] = useState(null); // null = noch nicht gesucht
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const [scores, setScores] = useState({});

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const aliveRef = useRef(true);
  const canvasRef = useRef(null);

  const stopCamera = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamReady(false);
  };

  const startCamera = async () => {
    setCamError('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamError('Kamera ist hier nicht verfügbar (die Seite braucht HTTPS). Nutze „Foto aufnehmen“.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      if (!aliveRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { /* nicht überall möglich */ }
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
        setCamReady(true);
      }
    } catch (e) {
      setCamError(e && e.name === 'NotAllowedError'
        ? 'Kamera-Zugriff wurde verweigert. Erlaube ihn in den Browser-Einstellungen oder nutze „Foto aufnehmen“.'
        : 'Die Kamera konnte nicht gestartet werden. Nutze „Foto aufnehmen“.');
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; stopCamera(); releaseWorkerLater(); };
  }, []);

  useEffect(() => {
    if (phase === 'camera') startCamera();
    return undefined;
  }, [phase]);

  const doSearch = async (n, num, alternatives = []) => {
    const first = String(n || '').trim();
    const candidates = [];
    const addCandidate = (value) => {
      const x = String(value || '').trim();
      if (!x || x.length < 2) return;
      if (!candidates.includes(x)) candidates.push(x);
    };

    addCandidate(first);
    (alternatives || []).forEach(addCandidate);

    // Wenn OCR noch Müll vor den Namen setzt ("gaz Krebscorps"), werden auch die
    // längsten einzelnen Wörter probiert. Das ist besonders hilfreich bei glänzenden Karten.
    const tokenSource = candidates.join(' ');
    tokenSource
      .split(/\s+/)
      .filter((x) => x.length >= 3)
      .sort((a, b) => b.length - a.length)
      .slice(0, 4)
      .forEach(addCandidate);

    if (!candidates.length && num) addCandidate(String(num));

    if (!onSearch) { setResults([]); return; }

    setSearching(true); setError(''); setNote('');
    try {
      let list = [];
      let usedQuery = '';

      // Erst Name + Nummer, danach alternative OCR-Kandidaten.
      for (const candidate of candidates.slice(0, 8)) {
        try {
          const q = num ? buildQuery(candidate, num) : candidate;
          const found = await onSearch(q);
          if (Array.isArray(found) && found.length) {
            list = found;
            usedQuery = q;
            break;
          }
        } catch (e) {
          // Einen einzelnen fehlgeschlagenen Kandidaten nicht den kompletten Scan abbrechen lassen.
        }
      }

      // Falls die Nummer stimmt, der Name aber komplett danebenliegt:
      // nur nach der Kartennummer suchen und anschließend per Kartenbild ranken.
      if (list.length === 0 && num) {
        try {
          const found = await onSearch(String(num).trim());
          if (Array.isArray(found) && found.length) {
            list = found;
            usedQuery = String(num).trim();
            setNote('Name war beim OCR unsicher – Treffer wurden zusätzlich über die Kartennummer und das Kartenbild gesucht.');
          }
        } catch (e) { /* weiter */ }
      }

      if (list.length > 1 && canvasRef.current && api) {
        try {
          const r = await rankByImage(canvasRef.current, list, api);
          list = r.cards;
          if (aliveRef.current) setScores(r.scores);
        } catch (e) { /* ohne Bildvergleich weiter */ }
      }

      if (aliveRef.current) {
        setResults(list);
        if (list.length) {
          // Wenn der Scanner über einen korrigierten Kandidaten oder nur über die
          // Nummer gefunden hat, zeigen wir direkt den echten Kartennamen an.
          const best = list[0];
          if (best?.name) setName(String(best.name).replace(/\s*\[.*\]\s*$/, ''));
          if (best?.number) setNumber(String(best.number) + (best?.set?.total ? `/${best.set.total}` : ''));
        }
        if (usedQuery && usedQuery !== first && list.length) {
          setNote((prev) => prev || `Treffer über OCR-Korrektur gefunden: „${usedQuery}“`);
        }
      }
    } catch (e) {
      if (aliveRef.current) {
        setResults(null);
        setError(e && e.name === 'AbortError'
          ? 'Der Server hat zu lange nicht geantwortet (Render schläft evtl.). Gleich nochmal „Suchen“ tippen.'
          : 'Suche fehlgeschlagen: ' + ((e && e.message) || 'Unbekannter Fehler'));
      }
    } finally {
      if (aliveRef.current) setSearching(false);
    }
  };

  const runOcr = async (card) => {
    canvasRef.current = card; setScores({});
    setPhase('reading'); setError(''); setResults(null); setNote(''); setStatus('Lade Texterkennung …');
    try {
      const worker = await getWorker((s) => aliveRef.current && setStatus(s));
      if (!aliveRef.current) return;
      setStatus('Lese Karte …');
      const read = await readCard(worker, card);
      if (!aliveRef.current) return;
      setName(read.name); setNumber(read.number); setThumbs(read.thumbs);

      if (mode === 'search' && read.name) {
        onResult({ query: buildQuery(read.name, read.number), name: read.name, number: read.number });
        return;
      }
      setPhase('result');
      if (!read.name && !read.number) {
        setError('Name und Nummer wurden nicht sicher erkannt. Trage sie unten ein oder scanne nochmal (Karte möglichst plan, gut beleuchtet und ohne Spiegelung).');
      } else {
        await doSearch(read.name, read.number, read.nameCandidates);
      }
    } catch (e) {
      if (!aliveRef.current) return;
      setPhase('result');
      setError('Texterkennung fehlgeschlagen: ' + ((e && e.message) || 'Unbekannter Fehler') + ' – du kannst den Namen auch von Hand eintragen.');
    }
  };

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const card = cardCanvas(v, v.videoWidth, v.videoHeight);
    stopCamera();
    runOcr(card);
  };

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      stopCamera();
      const { source, w, h } = await loadImageSource(file);
      runOcr(cardCanvas(source, w, h));
    } catch (err) {
      setError('Das Foto konnte nicht gelesen werden.');
      setPhase('result');
    }
  };

  const rescan = () => { setResults(null); setError(''); setNote(''); setThumbs(null); setPhase('camera'); };

  const submitManual = (e) => {
    e.preventDefault();
    if (mode === 'search' && name.trim()) {
      onResult({ query: buildQuery(name, number), name: name.trim(), number: number.trim() });
    } else {
      doSearch(name, number);
    }
  };

  const inputCls = 'w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-lg px-3 py-2 text-sm outline-none';

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/20 bg-slate-900">
        <h2 className="font-black text-cyan-400 text-sm">📷 Karte scannen {mode === 'collection' ? '· zur Collection' : '· Suchen'}</h2>
        <button onClick={onClose} className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-rose-400">Schließen ✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {phase === 'camera' && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-slate-400 text-center max-w-xs">
              Karte so halten, dass sie den Rahmen ausfüllt: Name oben und Nummer unten liegen in den gestrichelten Zonen. Gutes Licht, kein Glanz.
            </p>
            <div className="relative overflow-hidden rounded-xl border-2 border-cyan-400 bg-black" style={{ width: 'min(78vw, 44vh)', aspectRatio: '5 / 7' }}>
              <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute border border-dashed border-cyan-300/80 rounded-sm pointer-events-none" style={{ left: '5%', top: '2.5%', width: '74%', height: '10.5%' }}>
                <span className="absolute -bottom-4 left-0 text-[9px] text-cyan-300 bg-slate-950/60 px-1 rounded">Name</span>
              </div>
              <div className="absolute border border-dashed border-cyan-300/80 rounded-sm pointer-events-none" style={{ left: '2%', top: '89.5%', width: '96%', height: '10%' }}>
                <span className="absolute -top-4 left-0 text-[9px] text-cyan-300 bg-slate-950/60 px-1 rounded">Nummer</span>
              </div>
              {!camReady && !camError && <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">Kamera startet …</p>}
            </div>
            {camError && <p className="text-xs text-amber-300 text-center max-w-xs">{camError}</p>}
            <div className="flex gap-2 w-full max-w-xs">
              <button onClick={snap} disabled={!camReady} className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-black py-3 rounded-xl text-sm transition-colors">📸 Scannen</button>
              <label className="flex-1 text-center cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-xl text-sm transition-colors border border-slate-700">
                🖼️ Foto
                <input type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
              </label>
            </div>
            {mode === 'collection' && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={!!series} onChange={(e) => onSeriesChange && onSeriesChange(e.target.checked)} className="accent-cyan-500" />
                Serienmodus: nach dem Hinzufügen gleich die nächste Karte scannen
              </label>
            )}
          </div>
        )}

        {phase === 'reading' && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <span className="animate-spin text-3xl">⚡</span>
            <p className="text-sm text-cyan-400 font-bold">{status}</p>
            <p className="text-[11px] text-slate-500 text-center max-w-xs">Beim ersten Mal lädt die Texterkennung einmalig ihre Sprachdaten (einige MB), danach geht es schneller.</p>
          </div>
        )}

        {phase === 'result' && (
          <div className="space-y-4 max-w-xl mx-auto">
            {thumbs && (thumbs.name || thumbs.num) && (
              <div className="grid grid-cols-2 gap-2">
                {thumbs.name && <div><p className="text-[10px] text-slate-500 mb-1">Gelesener Namensbereich</p><img src={thumbs.name} alt="Namensbereich" className="w-full rounded border border-slate-800" /></div>}
                {thumbs.num && <div><p className="text-[10px] text-slate-500 mb-1">Gelesener Nummernbereich</p><img src={thumbs.num} alt="Nummernbereich" className="w-full rounded border border-slate-800" /></div>}
              </div>
            )}

            <form onSubmit={submitManual} className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-[10px] text-slate-400">Name (korrigierbar)</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="z. B. Glumanda" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Nummer</label>
                  <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} placeholder="44/102" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={searching || !name.trim()} className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black py-2.5 rounded-xl text-sm">{searching ? 'Sucht …' : '🔍 Suchen'}</button>
                <button type="button" onClick={rescan} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl text-sm border border-slate-700">📷 Nochmal scannen</button>
              </div>
            </form>

            {error && <p className="text-xs text-amber-300">{error}</p>}
            {note && <p className="text-[11px] text-slate-400">{note}</p>}

            {results && results.length === 0 && !searching && !error && (
              <p className="text-xs text-slate-400 text-center py-6">Keine Karte gefunden. Name oder Nummer anpassen und nochmal suchen.</p>
            )}

            {results && results.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">Tippe die richtige Karte an, um sie hinzuzufügen:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {results.slice(0, 24).map((card) => (
                    <button key={card.id} onClick={() => onPick && onPick(card)} className="text-left bg-slate-900 border border-slate-800 hover:border-cyan-500/60 rounded-xl p-2 transition-colors">
                      {Img && <Img src={card.images && card.images.small} alt={card.name} className="w-full rounded-lg mb-1" />}
                      <p className="text-xs font-bold text-slate-200 truncate">
                        {String(card.name || '').replace(/\s*\[.*\]\s*$/, '')}
                        {card.number ? <span className="text-slate-500 font-normal"> #{card.number}{card.set && card.set.total ? `/${card.set.total}` : ''}</span> : null}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">{(card.set && card.set.name) || 'Unbekannt'}</p>
                      <p className="text-[11px] text-cyan-400 font-bold">{eur(watchPrice(card.cardmarket && card.cardmarket.prices))}</p>
                      {scores[card.id] != null && <p className="text-[10px] text-slate-400">Ähnlichkeit {scores[card.id]} %</p>}
                      {owned && <OwnedBadge info={owned.get(card.id)} className="mt-1" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'collection' && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={!!series} onChange={(e) => onSeriesChange && onSeriesChange(e.target.checked)} className="accent-cyan-500" />
                Serienmodus: nach dem Hinzufügen gleich die nächste Karte scannen
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
