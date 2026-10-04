// Kleine CSV-Helfer für Backup-Export und -Import (ohne Zusatzpaket).
// Format: Semikolon-getrennt + BOM, damit Excel (deutsche Einstellung) Umlaute und Spalten richtig öffnet.

const needsQuotes = /[";,\r\n\t]/;

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// rows: Array von Objekten, columns: Spaltennamen in der gewünschten Reihenfolge
export function toCsv(rows, columns, delimiter = ';') {
  const lines = [columns.join(delimiter)];
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(delimiter));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

// Liest CSV-Text (Trennzeichen ; , oder Tab wird an der Kopfzeile erkannt) und liefert
// Objekte mit kleingeschriebenen Spaltennamen. Anführungszeichen, "" und Zeilenumbrüche in Feldern werden unterstützt.
export function parseCsv(input) {
  let text = String(input || '').replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const delimiter = count(';') >= count(',') && count(';') >= count('\t') ? ';' : (count('\t') > count(',') ? '\t' : ',');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (nonEmpty.length < 2) return [];
  const header = nonEmpty[0].map((h) => String(h).trim().toLowerCase());
  return nonEmpty.slice(1).map((r) => {
    const o = {};
    header.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

export function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
