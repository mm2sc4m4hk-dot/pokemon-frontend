// Reine Hilfsfunktionen für den Karten-Scanner (kein Browser nötig -> einfach testbar).

export const buildQuery = (name, number) => [String(name || '').trim(), String(number || '').trim()].filter(Boolean).join(' ');

// Größtes Rechteck im Kartenformat 5:7, mittig in einer Quelle der Größe w x h
// (entspricht genau dem sichtbaren Ausschnitt bei object-fit: cover).
export function coverRect(w, h, aspect = 5 / 7) {
  let sw = w;
  let sh = w / aspect;
  if (sh > h) { sh = h; sw = h * aspect; }
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}
