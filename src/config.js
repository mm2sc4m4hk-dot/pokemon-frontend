// Zentrale Konfiguration der Frontend-App.
//
// API_URL: Basis-URL des Backends (Render). Wird per VITE_API_URL in .env gesetzt.
// Hinweis: Die .env-Datei ist im Repository (siehe .env.txt) – bei einem Wechsel
// der Umgebung muss VITE_API_URL dort angepasst werden.
export const API_URL = import.meta.env.VITE_API_URL || 'https://pokemon-backend-x7l7.onrender.com';

// Freiwilliger Unterstützen-Link (Ko-fi). Über VITE_KOFI_URL in .env bzw. in
// Vercel änderbar, ohne Code anzufassen.
export const KOFI_URL = import.meta.env.VITE_KOFI_URL || 'https://ko-fi.com/tcgvault0203';

// Event, das nach einem Scan ausgelöst wird, damit die Kontingent-Anzeige
// im Profil sich aktualisiert (der Server liefert den neuen Stand).
export const QUOTA_CHANGED_EVENT = 'tcg-vault:quota-changed';

export const notifyQuotaChanged = () => {
  try { window.dispatchEvent(new CustomEvent(QUOTA_CHANGED_EVENT)); } catch (e) { /* egal */ }
};
