// CardScanner V2
//
// Architektur:
//   Foto/Kamera -> Karten-Crop -> mehrere OCR-Messungen
//                         -> Name-/Nummer-Kandidaten
//                         -> mehrere API-Suchen (alle Kandidaten, kein "erster Treffer gewinnt")
//                         -> Text-/Nummer-Scoring
//                         -> optionaler Bildvergleich
//                         -> Ergebnis
//
// Wichtig: OCR ist nur ein Signal. Ein einzelner schlechter OCR-Lauf darf deshalb
// niemals alleine entscheiden, welche Karte gefunden wird.
// Unicode wird mit NFKC normalisiert, aber NICHT in ASCII umgewandelt. Damit bleiben
// japanische, chinesische und koreanische Kartennamen erhalten.

import React, { useEffect, useRef, useState } from 'react';
import { buildQuery, coverRect } from './scanParse';
import { watchPrice } from './priceData';
import { OwnedBadge } from './Backup';
import { rankByImage } from './imageMatch';

// -----------------------------------------------------------------------------
// OCR worker
// -----------------------------------------------------------------------------
let workerPromise = null;
let idleTimer = null;

export function getWorker(onStatus) {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) => createWorker('deu+eng+jpn+kor+chi_sim+chi_tra', 1, {
        logger: (m) => {
          if (onStatus && m && typeof m.progress === 'number' && /load|init/i.test(m.status || '')) {
            onStatus(`Lade Texterkennung … ${Math.round(m.progress * 100)} %`);
          }
        }
      }))
      .catch((e) => {
        workerPromise = null;
        throw e;
      });
  }

  return workerPromise;
}

export function releaseWorkerLater() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const p = workerPromise;
    workerPromise = null;
    idleTimer = null;
    if (p) p.then((w) => w.terminate()).catch(() => {});
  }, 60000);
}

// -----------------------------------------------------------------------------
// Unicode / Text helpers
// -----------------------------------------------------------------------------
function unicodeText(value) {
  try {
    return String(value ?? '').normalize('NFKC');
  } catch {
    return String(value ?? '');
  }
}

function cleanOcrText(value) {
  return unicodeText(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[|¦]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchText(value) {
  return cleanOcrText(value)
    .toLocaleLowerCase()
    .replace(/[‐‑‒–—―]/g, '-')
    .trim();
}

function compactText(value) {
  return searchText(value).replace(/[\s\-_/.,:;!?()[\]{}'"`´’“”]+/g, '');
}

function hasCjk(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u.test(String(value || ''));
}

function editSimilarity(a, b) {
  const aa = compactText(a);
  const bb = compactText(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) {
    return Math.min(0.97, Math.min(aa.length, bb.length) / Math.max(aa.length, bb.length) + 0.35);
  }

  const prev = new Array(bb.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= aa.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cur.length; j += 1) prev[j] = cur[j];
  }
  return Math.max(0, 1 - prev[bb.length] / Math.max(aa.length, bb.length));
}

function canonicalName(value) {
  const x = cleanOcrText(value);
  if (!x) return '';
  // Niemals CJK-Zeichen "säubern" oder transliterieren.
  if (hasCjk(x)) return x;
  return x
    .replace(/^\s*(phase\s*\d+|basis|stage\s*\d+)\s+/i, '')
    .replace(/\s+#?\d+(?:\s*\/\s*\d+)?\s*$/g, '')
    .trim();
}

// -----------------------------------------------------------------------------
// Image preparation
// -----------------------------------------------------------------------------
function cardCanvas(source, w, h) {
  const { sx, sy, sw, sh } = coverRect(w, h);
  const outW = Math.min(1200, Math.max(700, Math.round(sw)));
  const c = document.createElement('canvas');
  c.width = outW;
  c.height = Math.round(outW * 7 / 5);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function prepare(src, x, y, w, h, targetW, mode = 'gray') {
  const scale = targetW / w;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(targetW));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);

  if (mode === 'color') return { canvas: c, inverted: false };

  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const n = c.width * c.height;
  const gray = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);

  for (let i = 0, p = 0; p < n; i += 4, p += 1) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    gray[p] = g;
    hist[g] += 1;
  }

  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= n * 0.02) { lo = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) {
    acc += hist[v];
    if (acc >= n * 0.02) { hi = v; break; }
  }

  const span = Math.max(1, hi - lo);
  let sum = 0;
  for (let p = 0; p < n; p += 1) {
    gray[p] = Math.max(0, Math.min(255, ((gray[p] - lo) * 255) / span));
    sum += gray[p];
  }

  const autoInvert = sum / n < 100;
  const invert = mode === 'invert' ? true : mode === 'normal' ? false : autoInvert;
  const threshold = mode === 'threshold' || mode === 'invert-threshold';
  const forceInvert = mode === 'invert-threshold' ? true : invert;

  for (let p = 0, i = 0; p < n; p += 1, i += 4) {
    let v = forceInvert ? 255 - gray[p] : gray[p];
    if (threshold) v = v >= 160 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return { canvas: c, inverted: forceInvert };
}

function thumb(c) {
  try { return c ? c.toDataURL('image/jpeg', 0.65) : ''; } catch { return ''; }
}

// -----------------------------------------------------------------------------
// OCR candidate extraction
// -----------------------------------------------------------------------------
function addNameCandidate(map, value, confidence = 0, source = 'ocr') {
  const name = canonicalName(value);
  if (!name || name.length < 2 || name.length > 80) return;

  // Reiner Regel-/Kartentext ist kein sinnvoller Name.
  const lower = searchText(name);
  if (/^(wenn|falls|during|this|that|pokemon|trainer|energy|schwäche|resistenz|rückzug)$/i.test(lower)) return;
  if (/\b(kg|cm|hp|kp)\s*\d+\b/i.test(name)) return;

  const key = compactText(name);
  if (!key) return;
  const old = map.get(key);
  if (!old) {
    map.set(key, { value: name, hits: 1, confidence: Number(confidence) || 0, sources: [source] });
  } else {
    old.hits += 1;
    old.confidence = Math.max(old.confidence, Number(confidence) || 0);
    if (!old.sources.includes(source)) old.sources.push(source);
  }
}

function extractNameCandidates(raw, data, map) {
  const text = cleanOcrText(raw);
  if (text) addNameCandidate(map, text, 35, 'line');

  const lines = String(raw || '')
    .split(/\r?\n/)
    .map(cleanOcrText)
    .filter(Boolean);
  lines.forEach((line) => addNameCandidate(map, line, 45, 'line'));

  const words = Array.isArray(data?.words) ? data.words : [];
  words.forEach((word) => {
    const value = cleanOcrText(word?.text);
    const conf = Number(word?.confidence) || 0;
    if (value.length >= 2 && conf >= 20) addNameCandidate(map, value, conf, 'word');
  });

  // Mehrere Tokens zusammen sind häufig der korrekte Name, obwohl Tesseract die
  // Wortgrenzen falsch setzt.
  const tokens = text.split(/\s+/).filter((x) => x.length >= 2);
  for (let i = 0; i < tokens.length; i += 1) {
    for (let len = 2; len <= Math.min(4, tokens.length - i); len += 1) {
      addNameCandidate(map, tokens.slice(i, i + len).join(' '), 30, 'tokens');
    }
  }
}

function normalizeNumberText(value) {
  return unicodeText(value)
    .replace(/[OoОо]/g, '0')
    .replace(/[IiLl|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[Zz]/g, '2')
    .replace(/[—–−]/g, '-')
    .replace(/[\\]/g, '/');
}

function extractNumberCandidates(raw) {
  const text = normalizeNumberText(raw);
  const out = [];
  const seen = new Set();
  const add = (a, b) => {
    const index = String(a || '').replace(/\D/g, '');
    const total = String(b || '').replace(/\D/g, '');
    if (!index || !total || index.length > 4 || total.length > 4) return;
    const i = Number(index);
    const t = Number(total);
    if (!Number.isFinite(i) || !Number.isFinite(t) || i < 1 || t < 1 || i > t) return;
    const value = `${index.padStart(3, '0')}/${total}`;
    if (!seen.has(value)) {
      seen.add(value);
      out.push({ value, index: i, total: t });
    }
  };

  // Bevorzugt das klassische Pokémon-Format 024/189.
  for (const match of text.matchAll(/(\d{1,4})\s*[\/]\s*(\d{1,4})/g)) add(match[1], match[2]);
  for (const match of text.matchAll(/(\d{1,4})\s*-\s*(\d{1,4})/g)) add(match[1], match[2]);
  for (const match of text.matchAll(/\b(\d{1,4})\s+(\d{1,4})\b/g)) add(match[1], match[2]);

  return out;
}

// -----------------------------------------------------------------------------
// OCR pipeline
// -----------------------------------------------------------------------------
export async function readCard(worker, card, onStatus) {
  const cw = card.width;
  const ch = card.height;
  const nameBox = [0.015 * cw, 0.008 * ch, 0.97 * cw, 0.155 * ch];
  const numBox = [0.005 * cw, 0.855 * ch, 0.99 * cw, 0.145 * ch];

  const names = new Map();
  let nameThumb = null;
  const nameModes = ['color', 'auto', 'normal', 'invert', 'threshold'];

  for (let i = 0; i < nameModes.length; i += 1) {
    if (onStatus) onStatus(`Lese Kartenname … ${i + 1}/${nameModes.length}`);
    const p = prepare(card, ...nameBox, 1400, nameModes[i]);
    for (const psm of [7, 13]) {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: String(psm) });
      const result = await worker.recognize(p.canvas);
      extractNameCandidates(result?.data?.text || '', result?.data, names);
      if (!nameThumb && (result?.data?.text || '').trim()) nameThumb = p.canvas;
    }
  }

  const nameCandidates = [...names.values()]
    .sort((a, b) => (b.hits * 30 + b.confidence) - (a.hits * 30 + a.confidence))
    .slice(0, 12);

  const numbers = new Map();
  let numThumb = null;
  const numberModes = ['auto', 'normal', 'invert', 'threshold'];
  const whitelist = '0123456789/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-';

  for (let i = 0; i < numberModes.length; i += 1) {
    if (onStatus) onStatus(`Lese Kartennummer … ${i + 1}/${numberModes.length}`);
    const p = prepare(card, ...numBox, 1700, numberModes[i]);
    await worker.setParameters({ tessedit_char_whitelist: whitelist, tessedit_pageseg_mode: '11' });
    const result = await worker.recognize(p.canvas);
    const parsed = extractNumberCandidates(result?.data?.text || '');
    parsed.forEach((item) => {
      const old = numbers.get(item.value);
      numbers.set(item.value, old ? { ...item, hits: old.hits + 1 } : { ...item, hits: 1 });
    });
    if (!numThumb) numThumb = p.canvas;
  }

  const numberCandidates = [...numbers.values()].sort((a, b) => b.hits - a.hits);

  return {
    name: nameCandidates[0]?.value || '',
    nameCandidates,
    number: numberCandidates[0]?.value || '',
    numberCandidates,
    thumbs: { name: thumb(nameThumb), num: thumb(numThumb) }
  };
}

export async function loadImageSource(file) {
  if (window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, w: bmp.width, h: bmp.height };
    } catch {
      // Fallback unten.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// -----------------------------------------------------------------------------
// Search + scoring
// -----------------------------------------------------------------------------
function cardNumber(card) {
  if (!card) return '';
  const number = String(card.number ?? card.localId ?? '').trim();
  const total = card.set?.total ?? card.total;
  return number && total ? `${number}/${total}` : number;
}

function numberMatch(card, candidates) {
  const target = String(cardNumber(card)).replace(/\s/g, '');
  if (!target) return 0;
  const targetIndex = target.split('/')[0].replace(/^0+(?=\d)/, '');
  const targetTotal = target.split('/')[1]?.replace(/^0+(?=\d)/, '');

  let best = 0;
  candidates.forEach((candidate) => {
    const raw = String(candidate.value || '').replace(/\s/g, '');
    if (raw === target) best = Math.max(best, 1);
    const [i, t] = raw.split('/');
    if (i?.replace(/^0+(?=\d)/, '') === targetIndex) best = Math.max(best, 0.72);
    if (t?.replace(/^0+(?=\d)/, '') === targetTotal) best = Math.max(best, 0.18);
  });
  return best;
}

function scoreCard(card, ocr) {
  const cardName = card?.name || '';
  const nameScores = (ocr.nameCandidates || []).map((candidate) => {
    const sim = editSimilarity(candidate.value, cardName);
    const evidence = Math.min(1, (candidate.hits * 0.18) + (candidate.confidence / 100) * 0.55);
    return sim * 0.65 + evidence * 0.35;
  });
  const nameScore = nameScores.length ? Math.max(...nameScores) : 0;
  const numScore = numberMatch(card, ocr.numberCandidates || []);

  // Nummer ist bei Pokémon-Karten ein sehr starkes Signal; ein schlechter OCR-Name
  // darf einen exakten Nummerntreffer nicht zerstören.
  const total = nameScore * 0.62 + numScore * 0.38;
  return { nameScore, numScore, total };
}

function dedupeCards(cards) {
  const map = new Map();
  (Array.isArray(cards) ? cards : []).forEach((card) => {
    if (!card?.id) return;
    if (!map.has(card.id)) map.set(card.id, card);
  });
  return [...map.values()];
}

async function collectSearchResults(onSearch, ocr, onStatus) {
  const names = (ocr.nameCandidates || []).slice(0, 7).map((x) => x.value);
  const number = String(ocr.number || '').trim();
  const queries = [];
  const seen = new Set();

  const add = (q, kind) => {
    const query = String(q || '').trim();
    if (!query || seen.has(query)) return;
    seen.add(query);
    queries.push({ query, kind });
  };

  names.forEach((name) => {
    if (number) add(buildQuery(name, number), 'name+number');
  });
  names.forEach((name) => add(name, 'name'));

  // Falls nur die Nummer sauber erkannt wurde, darf sie ebenfalls als Suchsignal dienen.
  if (number) add(number, 'number');

  const all = [];
  const used = [];
  for (let i = 0; i < queries.length; i += 1) {
    const q = queries[i];
    if (onStatus) onStatus(`Suche Kandidaten … ${i + 1}/${queries.length}`);
    try {
      const found = await onSearch(q.query);
      if (Array.isArray(found) && found.length) {
        all.push(...found);
        used.push(q);
      }
    } catch {
      // Ein einzelner API-Fehler darf die übrigen Kandidaten nicht blockieren.
    }
  }

  return { cards: dedupeCards(all), usedQueries: used };
}

async function rankCandidates(cards, ocr, image, api, onStatus) {
  let scored = cards.map((card) => ({ card, ...scoreCard(card, ocr), imageScore: null }));

  // Nur die plausibelsten Karten an den Bildvergleich geben. Das hält die Suche schnell
  // und verhindert, dass ein schwacher OCR-Treffer unnötig viele Bilder lädt.
  if (api && image && scored.length > 1) {
    const preselected = [...scored]
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)
      .map((x) => x.card);

    try {
      if (onStatus) onStatus('Vergleiche Kartenbilder …');
      const ranked = await rankByImage(image, preselected, api);
      const imageScores = ranked?.scores || {};
      scored = scored.map((entry) => ({
        ...entry,
        imageScore: imageScores[entry.card.id] != null ? Number(imageScores[entry.card.id]) / 100 : null
      }));
    } catch {
      // Text-/Nummer-Scoring bleibt vollständig funktionsfähig.
    }
  }

  scored.forEach((entry) => {
    entry.finalScore = entry.imageScore == null
      ? entry.total
      : entry.total * 0.78 + entry.imageScore * 0.22;
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  return scored;
}

// -----------------------------------------------------------------------------
// UI
// -----------------------------------------------------------------------------
const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`;

export default function CardScanner({ mode, onClose, onResult, onSearch, onPick, Img, series, onSeriesChange, owned, api }) {
  const [phase, setPhase] = useState('camera');
  const [camError, setCamError] = useState('');
  const [camReady, setCamReady] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [thumbs, setThumbs] = useState(null);
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const [scores, setScores] = useState({});

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const aliveRef = useRef(true);
  const canvasRef = useRef(null);
  const lastOcrRef = useRef(null);

  const stopCamera = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamReady(false);
  };

  const startCamera = async () => {
    setCamError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Kamera ist hier nicht verfügbar. Nutze „Foto“ oder erlaube HTTPS/Kamera-Zugriff.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      if (!aliveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      try {
        await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch {
        // Nicht jede iPhone-/Browser-Kombination unterstützt focusMode.
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
        setCamReady(true);
      }
    } catch (e) {
      setCamError(e?.name === 'NotAllowedError'
        ? 'Kamera-Zugriff wurde verweigert. Erlaube ihn im Browser oder nutze „Foto“.'
        : 'Die Kamera konnte nicht gestartet werden. Nutze „Foto“.');
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopCamera();
      releaseWorkerLater();
    };
  }, []);

  useEffect(() => {
    if (phase === 'camera') startCamera();
    return undefined;
  }, [phase]);

  const runSearch = async (ocr) => {
    if (!onSearch) return;
    setSearching(true);
    setError('');
    setNote('');
    setScores({});

    try {
      const found = await collectSearchResults(onSearch, ocr, (s) => aliveRef.current && setStatus(s));
      if (!aliveRef.current) return;

      if (!found.cards.length) {
        setResults([]);
        setNote('Keine Datenbankkarte gefunden. Prüfe Name/Nummer oder korrigiere die Felder und suche erneut.');
        return;
      }

      const ranked = await rankCandidates(found.cards, ocr, canvasRef.current, api, (s) => aliveRef.current && setStatus(s));
      if (!aliveRef.current) return;

      const top = ranked.slice(0, 24);
      const nextScores = {};
      top.forEach((entry) => {
        nextScores[entry.card.id] = Math.round(entry.finalScore * 100);
      });
      setScores(nextScores);
      setResults(top.map((entry) => entry.card));

      const best = ranked[0];
      const second = ranked[1];
      const margin = best && second ? best.finalScore - second.finalScore : 1;

      if (best && best.finalScore >= 0.78 && margin >= 0.10) {
        setNote(`Eindeutiger Treffer: ${best.card.name}${cardNumber(best.card) ? ` #${cardNumber(best.card)}` : ''}.`);
      } else if (best && best.finalScore >= 0.58) {
        setNote('Mehrere Kandidaten sind plausibel. Tippe die richtige Karte an – der Scanner fügt nicht automatisch eine unsichere Karte hinzu.');
      } else {
        setNote('Kein sicherer Treffer. Name oder Nummer korrigieren oder die Karte erneut fotografieren.');
      }

      if (found.usedQueries.length > 1) {
        setNote((prev) => `${prev} ${found.usedQueries.length} Suchvarianten wurden zusammengeführt.`);
      }
    } catch (e) {
      if (!aliveRef.current) return;
      setResults(null);
      setError(e?.name === 'AbortError'
        ? 'Der Server hat zu lange nicht geantwortet. Bitte „Suchen“ nochmal tippen.'
        : `Suche fehlgeschlagen: ${e?.message || 'Unbekannter Fehler'}`);
    } finally {
      if (aliveRef.current) setSearching(false);
    }
  };

  const runOcr = async (card) => {
    canvasRef.current = card;
    lastOcrRef.current = null;
    setScores({});
    setPhase('reading');
    setError('');
    setResults(null);
    setNote('');
    setStatus('Lade Texterkennung …');

    try {
      const worker = await getWorker((s) => aliveRef.current && setStatus(s));
      if (!aliveRef.current) return;
      const read = await readCard(worker, card, (s) => aliveRef.current && setStatus(s));
      if (!aliveRef.current) return;

      lastOcrRef.current = read;
      setName(read.name);
      setNumber(read.number);
      setThumbs(read.thumbs);
      setPhase('result');

      if (!read.name && !read.number) {
        setError('Name und Nummer konnten nicht sicher gelesen werden. Korrigiere die Felder oder scanne die Karte erneut.');
        return;
      }

      if (mode === 'search') {
        onResult?.({
          query: buildQuery(read.name, read.number),
          name: read.name,
          number: read.number
        });
        return;
      }

      await runSearch(read);
    } catch (e) {
      if (!aliveRef.current) return;
      setPhase('result');
      setError(`Texterkennung fehlgeschlagen: ${e?.message || 'Unbekannter Fehler'}. Du kannst Name und Nummer trotzdem manuell eingeben.`);
    }
  };

  const snap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const card = cardCanvas(video, video.videoWidth, video.videoHeight);
    stopCamera();
    runOcr(card);
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      stopCamera();
      const { source, w, h } = await loadImageSource(file);
      runOcr(cardCanvas(source, w, h));
    } catch {
      setPhase('result');
      setError('Das Foto konnte nicht gelesen werden.');
    }
  };

  const rescan = () => {
    stopCamera();
    setResults(null);
    setError('');
    setNote('');
    setThumbs(null);
    setName('');
    setNumber('');
    setScores({});
    setPhase('camera');
  };

  const submitManual = async (event) => {
    event.preventDefault();
    const n = name.trim();
    const num = number.trim();
    if (!n && !num) return;

    if (mode === 'search') {
      onResult?.({ query: buildQuery(n, num), name: n, number: num });
      return;
    }

    const ocr = lastOcrRef.current || { nameCandidates: [], numberCandidates: [] };
    const manual = {
      ...ocr,
      name: n,
      number: num,
      nameCandidates: [{ value: n, hits: 4, confidence: 100, sources: ['manual'] }],
      numberCandidates: extractNumberCandidates(num)
    };
    await runSearch(manual);
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
              Karte möglichst plan und vollständig in den Rahmen halten. Gutes Licht, wenig Spiegelung.
            </p>
            <div className="relative overflow-hidden rounded-xl border-2 border-cyan-400 bg-black" style={{ width: 'min(78vw, 44vh)', aspectRatio: '5 / 7' }}>
              <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute border border-dashed border-cyan-300/80 rounded-sm pointer-events-none" style={{ left: '2%', top: '1%', width: '96%', height: '15.5%' }}>
                <span className="absolute -bottom-4 left-0 text-[9px] text-cyan-300 bg-slate-950/60 px-1 rounded">Name</span>
              </div>
              <div className="absolute border border-dashed border-cyan-300/80 rounded-sm pointer-events-none" style={{ left: '1%', top: '85.5%', width: '98%', height: '13.5%' }}>
                <span className="absolute -top-4 left-0 text-[9px] text-cyan-300 bg-slate-950/60 px-1 rounded">Nummer</span>
              </div>
              {!camReady && !camError && <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">Kamera startet …</p>}
            </div>
            {camError && <p className="text-xs text-amber-300 text-center max-w-xs">{camError}</p>}
            <div className="flex gap-2 w-full max-w-xs">
              <button onClick={snap} disabled={!camReady} className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-black py-3 rounded-xl text-sm">📸 Scannen</button>
              <label className="flex-1 text-center cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 rounded-xl text-sm border border-slate-700">
                🖼️ Foto
                <input type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
              </label>
            </div>
            {mode === 'collection' && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={!!series} onChange={(e) => onSeriesChange?.(e.target.checked)} className="accent-cyan-500" />
                Serienmodus: nach dem Hinzufügen gleich die nächste Karte scannen
              </label>
            )}
          </div>
        )}

        {phase === 'reading' && (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <span className="animate-spin text-3xl">⚡</span>
            <p className="text-sm text-cyan-400 font-bold">{status || 'Lese Karte …'}</p>
            <p className="text-[11px] text-slate-500 text-center max-w-xs">
              Mehrere OCR-Varianten werden geprüft. Das ist absichtlich etwas langsamer, verhindert aber, dass ein einzelner schlechter OCR-Lauf die Karte falsch erkennt.
            </p>
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
                  <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="z. B. Igelavar / イグラバー" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Nummer</label>
                  <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} placeholder="024/189" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={searching || (!name.trim() && !number.trim())} className="flex-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black py-2.5 rounded-xl text-sm">{searching ? 'Sucht …' : '🔍 Suchen'}</button>
                <button type="button" onClick={rescan} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl text-sm border border-slate-700">📷 Nochmal scannen</button>
              </div>
            </form>

            {error && <p className="text-xs text-amber-300">{error}</p>}
            {note && <p className="text-[11px] text-slate-400">{note}</p>}
            {status && searching && <p className="text-[10px] text-slate-500">{status}</p>}

            {results && results.length === 0 && !searching && !error && (
              <p className="text-xs text-slate-400 text-center py-6">Keine Karte gefunden. Name oder Nummer anpassen und nochmal suchen.</p>
            )}

            {results && results.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">Tippe die richtige Karte an, um sie hinzuzufügen:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {results.map((card) => (
                    <button key={card.id} onClick={() => onPick?.(card)} className="text-left bg-slate-900 border border-slate-800 hover:border-cyan-500/60 rounded-xl p-2 transition-colors">
                      {Img && <Img src={card.images?.small} alt={card.name} className="w-full rounded-lg mb-1" />}
                      <p className="text-xs font-bold text-slate-200 truncate">
                        {String(card.name || '').replace(/\s*\[.*\]\s*$/, '')}
                        {card.number ? <span className="text-slate-500 font-normal"> #{card.number}{card.set?.total ? `/${card.set.total}` : ''}</span> : null}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">{card.set?.name || 'Unbekannt'}</p>
                      <p className="text-[11px] text-cyan-400 font-bold">{eur(watchPrice(card.cardmarket?.prices))}</p>
                      {scores[card.id] != null && <p className="text-[10px] text-slate-400">Treffer {scores[card.id]} %</p>}
                      {owned && <OwnedBadge info={owned.get(card.id)} className="mt-1" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mode === 'collection' && (
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={!!series} onChange={(e) => onSeriesChange?.(e.target.checked)} className="accent-cyan-500" />
                Serienmodus: nach dem Hinzufügen gleich die nächste Karte scannen
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
