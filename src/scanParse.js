// Reine Hilfsfunktionen für den Karten-Scanner (kein Browser nötig -> einfach testbar).

const STAGE = /^(basis|basic|phase|stage|stufe|restored)$/i;

// "Entwickelt sich aus X" / "Evolves from X" inkl. Japanisch, Koreanisch, Chinesisch
// JP: たね (Basis), 進化 (Entwicklung), から進化 (entwickelt sich aus)
// KR: 진화 (Entwicklung), 에서 진화 (entwickelt sich aus)
// CN: 進化 / 进化 (Entwicklung), 從...進化 / 从...进化 (entwickelt sich aus)
const EVOLVES = /entwick|sich\s*aus|\bevolves?\b|\bfrom\b|évolue|evolu[ie]|から進化|進化|진화|에서\s*진화/i;

// OCR-Text aus dem Namensbereich -> Kartenname.
// Entfernt Entwicklungsstufe ("BASIS", "Phase 1"), KP/HP-Werte und Rauschen.
export function cleanName(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/[^A-Za-zÀ-ÿ0-9'’.:\- ♀♂\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let best = '';
  let bestLetters = 0;
  for (const line of lines) {
    if (EVOLVES.test(line)) continue; // Zeile "Entwickelt sich aus …" ist nicht der Kartenname

    let words = line.split(' ').filter(Boolean);
    if (words.length === 1 && STAGE.test(words[0])) continue; // Zeile besteht nur aus der Stufe
    while (words.length > 1 && (STAGE.test(words[0]) || /^\d$/.test(words[0]))) words.shift();
    const hp = words.findIndex((w) => /^(hp|kp)$/i.test(w));
    if (hp > 0) words = words.slice(0, hp);
    while (words.length > 1 && /^\d{2,3}$/.test(words[words.length - 1])) words.pop(); // HP-Zahl am Ende
    let cand = words.join(' ').replace(/^[-.:'’ ]+|[-.:'’ ]+$/g, '');
    // OCR liest das Stufen-Symbol oft als einzelnen Großbuchstaben vor dem Namen ("EGlumanda")
    cand = cand.replace(/^[A-Z](?=[A-Z][a-zà-ÿ]{2,})/, '');

    // Zählt lateinische Buchstaben sowie japanische (Hiragana/Katakana/Kanji), koreanische (Hangul) und chinesische Zeichen
    const letters = (cand.match(/[A-Za-zÀ-ÿ\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g) || []).length;
    if (letters > bestLetters) { best = cand; bestLetters = letters; }
  }
  return bestLetters >= 2 ? best : '';
}

// OCR-Text aus dem unteren Streifen -> "44/102" oder Promo-Nummer wie "SWSH123".
// Passt zu parseQuery im Backend.
export function parseNumber(text) {
  const t = String(text || '').toUpperCase();
  const slash = t.match(/(\d{1,3})\s*[\/|\\]\s*(\d{1,3})/);
  if (slash) return `${parseInt(slash[1], 10)}/${parseInt(slash[2], 10)}`;
  const promo = t.match(/\b(SWSH|SVP|SV|SM|XY|BW|HGSS|DP|TG|GG)\s?-?(\d{1,3})\b/);
  if (promo) return `${promo[1]}${promo[2]}`;
  return '';
}

export const buildQuery = (name, number) => [String(name || '').trim(), String(number || '').trim()].filter(Boolean).join(' ');

// Größtes Rechteck im Kartenformat 5:7, mittig in einer Quelle der Größe w x h
// (entspricht genau dem sichtbaren Ausschnitt bei object-fit: cover).
export function coverRect(w, h, aspect = 5 / 7) {
  let sw = w;
  let sh = w / aspect;
  if (sh > h) { sh = h; sw = h * aspect; }
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}