// Zentraler Redirect-Result-Handler für Firebase Auth (Google-Login).
//
// Warum ein eigenes Modul? Nach einem Redirect (installierte App / Popup blockiert)
// landet die App neu auf der Startseite. Das Ergebnis darf nur EINMAL gelesen
// werden – der SDK löscht den Redirect-State nach dem ersten Abruf. Deshalb
// lesen LoginScreen und AccountPanel (Google verknüpfen) hier über ein gemeinsames,
// gecachtes Promise statt jeweils selbst getRedirectResult() aufzurufen.
//
// Zusätzlich merken wir uns selbst, dass ein Redirect lief: im SDK v12 trägt die
// Rück-URL keine auth-Parameter mehr, ohne diese Marke ist ein fehlgeschlagener
// Redirect nicht von einem normalen Seitenaufruf zu unterscheiden.
import { getRedirectResult } from 'firebase/auth';
import { auth } from './firebase';

const REDIRECT_PENDING_KEY = 'tcg-vault:redirect-pending';

// Wird vor dem Redirect gesetzt, damit wir die Rückkehr erkennen.
export const markRedirectPending = () => {
  try { window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1'); } catch { /* Speicher gesperrt */ }
};

// Liest die Marke und löscht sie. Nur der erste Aufruf bekommt true.
export const consumeRedirectPending = () => {
  try {
    const v = window.sessionStorage.getItem(REDIRECT_PENDING_KEY);
    window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);
    return v === '1';
  } catch {
    return false;
  }
};

let outcomePromise = null;

/**
 * Löst das Redirect-Ergebnis genau einmal auf und cacht es.
 * Rückgabe: { ok, result, error, cameBack }
 *   ok       – kein Fehler beim Abruf (result kann trotzdem null sein)
 *   result   – UserCredential oder null (kein Redirect / Ergebnis verloren)
 *   error    – Fehlerobjekt des SDK (z. B. auth/credential)
 *   cameBack – true, wenn wir nach einem Redirect zurückgekommen sind
 */
export const resolveRedirectOutcome = () => {
  if (!outcomePromise) {
    // cameBack muss synchron beim ersten Aufruf gelesen werden, sonst
    // liefert der asynchrone Callback den Wert nach dem Löschen immer false.
    const cameBack = consumeRedirectPending();
    outcomePromise = getRedirectResult(auth).then(
      (result) => ({ ok: true, result, error: null, cameBack }),
      (error) => ({ ok: false, result: null, error, cameBack })
    );
  }
  return outcomePromise;
};
