// Echtes Login für TCG Vault (Firebase Authentication):
//   LoginScreen         – Anmelden, Registrieren, Passwort vergessen, Google
//   AccountPanel        – Konto-Karte im Profil (E-Mail, Bestätigung, Google verknüpfen, Passwort ändern)
//
// Importiert nichts aus App.jsx (kein Zirkellbezug). Die Daten bleiben unter users/{uid}/... in Firestore,
// deshalb ändert sich an den Firestore-Regeln nichts.
import React, { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  linkWithPopup,
  linkWithRedirect,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  signOut
} from 'firebase/auth';
import { auth } from './firebase';
import { BRAND_NAME, Disclaimer, Footer } from './brand';
import { API_URL, QUOTA_CHANGED_EVENT } from './config';
import { navigate } from './router';
import { markRedirectPending, resolveRedirectOutcome } from './authRedirect';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const authErrorMessage = (code) => {
  switch (code) {
    case 'auth/email-already-in-use': return 'Zu dieser E-Mail-Adresse gibt es schon ein Konto. Bitte anmelden oder „Passwort vergessen“ nutzen.';
    case 'auth/invalid-email': return 'Diese E-Mail-Adresse ist ungültig.';
    case 'auth/missing-password': return 'Bitte ein Passwort eingeben.';
    case 'auth/weak-password': return `Passwort zu schwach (mindestens ${MIN_PASSWORD} Zeichen).`;
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'E-Mail oder Passwort stimmt nicht.';
    case 'auth/user-disabled': return 'Dieses Konto wurde deaktiviert.';
    case 'auth/too-many-requests': return 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.';
    case 'auth/network-request-failed': return 'Keine Verbindung zu Firebase. Internetverbindung prüfen.';
    case 'auth/operation-not-allowed':
    case 'auth/configuration-not-found': return 'Diese Anmeldeart ist in Firebase noch nicht aktiviert (Authentication → Sign-in method).';
    case 'auth/unauthorized-domain': return 'Diese Domain ist in Firebase nicht freigegeben (Authentication → Settings → Authorized domains).';
    case 'auth/account-exists-with-different-credential': return 'Zu dieser E-Mail-Adresse gibt es schon ein Konto mit einer anderen Anmeldeart.';
    case 'auth/credential': return 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte lade die Seite neu (Strg+F5) und versuche es erneut.';
    case 'auth/credential-already-in-use': return 'Dieses Google-Konto gehört schon zu einem anderen ' + BRAND_NAME + '-Konto.';
    case 'auth/provider-already-linked': return 'Google ist mit diesem Konto schon verknüpft.';
    case 'auth/requires-recent-login': return 'Bitte melde dich zur Sicherheit neu an und versuche es dann erneut.';
    case 'auth/popup-blocked': return 'Das Anmeldefenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben.';
    default: return 'Etwas ist schiefgelaufen. Bitte erneut versuchen.';
  }
};

const googleProvider = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

const IGNORED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];
const POPUP_PROBLEMS = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'];

// Marker für Redirect-Login und Auswertung des Redirect-Ergebnisses liegen
// zentral in ./authRedirect.js – dort wird getRedirectResult genau einmal
// aufgerufen und das Ergebnis zwischen Login und Verknüpfung geteilt.

const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true);

const inputCls = 'w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all';

// ---------------------------------------------------------------------
// Login-Screen
// ---------------------------------------------------------------------
export function LoginScreen({ onDone }) {
  const [mode, setMode] = useState('login'); // login | register | reset
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  // Ergebnis nach der Rückkehr vom Redirect (Google) auswerten.
  // Ohne Redirect liefert getRedirectResult null – das ist normal und kein Fehler.
  // Kamen wir per Redirect zurück und ist das Ergebnis trotzdem null, ist der
  // Login stillschweigend verloren gegangen -> sichtbarer Hinweis statt Stille.
  useEffect(() => {
    let active = true;
    resolveRedirectOutcome().then(({ ok, result, error, cameBack }) => {
      if (!active) return;
      if (!ok) {
        console.error('[Auth] redirect error:', error?.code, error?.message);
        if (!IGNORED.includes(error?.code)) setError(authErrorMessage(error?.code));
        return;
      }
      console.log('[Auth] redirect result:', result);
      if (!result && cameBack) {
        setError('Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen – hilfreich ist ein Neuladen ohne Cache (Strg+F5).');
      }
    });
    return () => { active = false; };
  }, []);

  const switchMode = (m) => {
    setMode(m); setError(''); setInfo(''); setPassword(''); setConfirm('');
  };

  const login = async () => {
    const id = email.trim();
    if (!id || !password) { setError('Bitte E-Mail und Passwort eingeben.'); return; }
    await signInWithEmailAndPassword(auth, id, password);
    if (onDone) onDone();
  };

  const register = async () => {
    const mail = email.trim();
    if (!EMAIL_RE.test(mail)) { setError('Bitte eine gültige E-Mail-Adresse eingeben.'); return; }
    if (!EMAIL_RE.test(mail)) { setError('Bitte die E-Mail-Adresse deines Kontos eingeben.'); return; }
    if (password.length < MIN_PASSWORD) { setError(`Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`); return; }
    if (password !== confirm) { setError('Die Passwörter stimmen nicht überein.'); return; }
    const cred = await createUserWithEmailAndPassword(auth, mail, password);
    await updateProfile(cred.user, { displayName: name.trim() || mail.split('@')[0] });
    sendEmailVerification(cred.user).catch(() => {});
    if (onDone) onDone();
  };

  const reset = async () => {
    const mail = email.trim();
    if (!EMAIL_RE.test(mail)) { setError('Bitte die E-Mail-Adresse deines Kontos eingeben.'); return; }
    if (!EMAIL_RE.test(mail)) { setError('Bitte die E-Mail-Adresse deines Kontos eingeben.'); return; }
    try {
      await sendPasswordResetEmail(auth, mail);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e; // sonst würde die Meldung verraten, welche Adressen es gibt
    }
    setInfo('Falls zu dieser Adresse ein Konto existiert, ist eine Mail mit einem Link zum Zurücksetzen unterwegs. Schau auch im Spam-Ordner nach.');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(''); setInfo('');
    setBusy(true);
    try {
      if (mode === 'register') await register();
      else if (mode === 'reset') await reset();
      else await login();
    } catch (err) {
      console.error('Firebase Auth Fehler:', err.code, err.message);
      setError(authErrorMessage(err.code));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    if (busy) return;
    setError(''); setInfo(''); setBusy(true);
    const provider = googleProvider();
    try {
      // Installierte App: gleich Redirect, Popups gehen dort nicht zuverlässig
      if (isStandalone()) {
        markRedirectPending();
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
      if (onDone) onDone();
    } catch (err) {
      if (IGNORED.includes(err.code)) {
        setBusy(false);
        return;
      }
      if (POPUP_PROBLEMS.includes(err.code)) {
        try {
          markRedirectPending();
          await signInWithRedirect(auth, provider);
          return;
        } catch (e2) {
          setError(authErrorMessage(e2.code));
          setBusy(false);
          return;
        }
      }
      console.error('Google-Anmeldung fehlgeschlagen:', err.code, err.message);
      setError(authErrorMessage(err.code));
      setBusy(false);
    }
  };

  const isRegister = mode === 'register';
  const isReset = mode === 'reset';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-slate-100">
      <div className="bg-slate-900 border border-cyan-500/30 p-8 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-teal-400 tracking-wider mb-2">{BRAND_NAME}</h1>
          <p className="text-slate-400 text-sm">Verwalte deine Sammlung &amp; Werte</p>
        </div>

        <h2 className="text-xl font-bold text-slate-200 mb-4">
          {isReset ? 'Passwort zurücksetzen' : isRegister ? 'Konto erstellen' : 'Anmelden'}
        </h2>

        {isReset && (
          <p className="text-xs text-slate-400 mb-4">Gib die E-Mail-Adresse deines Kontos ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>
        )}

        {!isReset && (
          <>
            <button
              type="button"
              onClick={google}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-900 font-bold py-3 rounded-xl transition-colors"
            >
              <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
                <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
              </svg>
              Mit Google anmelden
            </button>
            <div className="flex items-center gap-3 my-5">
              <div className="h-px bg-slate-800 flex-1" />
              <span className="text-[11px] text-slate-500">oder mit E-Mail</span>
              <div className="h-px bg-slate-800 flex-1" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Name (optional)</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={inputCls} placeholder="Wie sollen wir dich nennen?" />
            </div>
          )}
          <div>
            <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">{mode === 'login' ? 'E-Mail' : 'E-Mail-Adresse'}</label>
            <input
              type={mode === 'login' ? 'text' : 'email'}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete={mode === 'login' ? 'username' : 'email'}
              autoCapitalize="none"
              className={inputCls}
              placeholder="name@beispiel.de"
            />
            
          </div>
          {!isReset && (
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Passwort</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                className={inputCls}
                placeholder="••••••••"
              />
            </div>
          )}
          {isRegister && (
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Passwort bestätigen</label>
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputCls} placeholder="••••••••" />
            </div>
          )}

          {error && <p className="text-rose-400 text-sm text-center">{error}</p>}
          {info && <p className="text-emerald-400 text-sm text-center">{info}</p>}

          <button type="submit" disabled={busy} className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black text-lg py-3 rounded-xl transition-all shadow-lg mt-2">
            {busy ? 'Bitte warten …' : isReset ? 'Link senden' : isRegister ? 'Konto erstellen' : 'Anmelden'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-400 space-y-2">
          {mode === 'login' && (
            <p><button onClick={() => switchMode('reset')} className="text-cyan-400 font-bold hover:underline">Passwort vergessen?</button></p>
          )}
          {mode === 'login' && (
            <p>Noch kein Konto? <button onClick={() => switchMode('register')} className="text-cyan-400 font-bold hover:underline">Jetzt registrieren</button></p>
          )}
          {isRegister && (
            <p>Schon ein Konto? <button onClick={() => switchMode('login')} className="text-cyan-400 font-bold hover:underline">Anmelden</button></p>
          )}
          {isReset && (
            <p><button onClick={() => switchMode('login')} className="text-cyan-400 font-bold hover:underline">Zurück zur Anmeldung</button></p>
          )}
        </div>
      </div>
      <Footer className="mt-6 max-w-md px-2" />
    </div>
  );
}

// ---------------------------------------------------------------------
// Google mit dem aktuellen Konto verknüpfen (uid und Daten bleiben gleich)
// ---------------------------------------------------------------------
// Popup zuerst; geht das nicht (installierte App, Blocker), dann Redirect. Nach dem Redirect lädt die Seite neu,
// das Ergebnis holt der useEffect mit getRedirectResult in den Komponenten unten ab.
async function linkGoogle(user) {
  const provider = googleProvider();
  if (isStandalone()) { markRedirectPending(); await linkWithRedirect(user, provider); return; }
  try {
    await linkWithPopup(user, provider);
  } catch (err) {
    if (POPUP_PROBLEMS.includes(err.code)) { markRedirectPending(); await linkWithRedirect(user, provider); return; }
    throw err;
  }
}

// Meldung nach der Rückkehr von einem Google-Redirect (Verknüpfung)
function useRedirectMessage(setMsg, okText) {
  useEffect(() => {
    let active = true;
    resolveRedirectOutcome().then(({ ok, result, error, cameBack }) => {
      if (!active) return;
      if (!ok) {
        console.error('[Auth] link redirect error:', error?.code, error?.message);
        if (!IGNORED.includes(error?.code)) setMsg({ type: 'err', text: authErrorMessage(error?.code) });
        return;
      }
      console.log('[Auth] link redirect result:', result);
      if (result && result.operationType === 'link') setMsg({ type: 'ok', text: okText });
      else if (!result && cameBack) setMsg({ type: 'err', text: 'Die Verknüpfung konnte nicht abgeschlossen werden. Bitte erneut versuchen.' });
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}



// ---------------------------------------------------------------------
// Konto-Karte im Profil (für Konten mit echter E-Mail-Adresse)
// ---------------------------------------------------------------------
export function AccountPanel() {
  const user = auth.currentUser;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [, rerender] = useState(0);
  useRedirectMessage(setMsg, 'Google ist verknüpft.');

  if (!user) return null;
  const hasGoogle = user.providerData.some((p) => p.providerId === 'google.com');
  const hasPassword = user.providerData.some((p) => p.providerId === 'password');

  const run = async (fn, okText) => {
    setBusy(true); setMsg({ type: '', text: '' });
    try {
      await fn();
      setMsg({ type: 'ok', text: okText });
      rerender((x) => x + 1);
    } catch (e) {
      if (!IGNORED.includes(e.code)) {
        console.error('Konto-Aktion fehlgeschlagen:', e.code, e.message);
        setMsg({ type: 'err', text: authErrorMessage(e.code) });
      }
    } finally {
      setBusy(false);
    }
  };

  const btn = 'text-[11px] font-bold px-3 py-1.5 rounded-lg border bg-slate-950 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500 hover:text-slate-950 disabled:opacity-50 transition-colors';

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl space-y-3">
      <h3 className="font-bold text-slate-100 text-sm">👤 Konto</h3>
      <div className="text-xs space-y-1">
        <p className="text-slate-300 break-all">{user.email}</p>
        <p className="text-slate-500">
          Anmeldung: {[hasPassword ? 'E-Mail & Passwort' : null, hasGoogle ? 'Google' : null].filter(Boolean).join(' + ') || 'unbekannt'}
        </p>
        <p className={user.emailVerified ? 'text-emerald-400' : 'text-amber-300'}>
          {user.emailVerified ? '✓ E-Mail-Adresse bestätigt' : 'E-Mail-Adresse noch nicht bestätigt'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {!user.emailVerified && (
          <button disabled={busy} onClick={() => run(() => sendEmailVerification(user), 'Bestätigungsmail gesendet. Schau auch im Spam-Ordner nach.')} className={btn}>Bestätigungsmail senden</button>
        )}
        {!hasGoogle && (
          <button disabled={busy} onClick={() => run(() => linkGoogle(user), 'Google ist verknüpft.')} className={btn}>Google verknüpfen</button>
        )}
        {hasPassword && (
          <button disabled={busy} onClick={() => run(() => sendPasswordResetEmail(auth, user.email), `Mail zum Ändern des Passworts an ${user.email} gesendet.`)} className={btn}>Passwort ändern</button>
        )}
      </div>

      {msg.text && <p className={`text-xs ${msg.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</p>}

      <ScanQuota />

      <DeleteAccount user={user} />
    </div>
  );
}

// ---------------------------------------------------------------------
// Monatliches Scan-Kontingent (Anzeige im Profil)
// ---------------------------------------------------------------------
// Der Zähler liegt ausschließlich serverseitig (Collection scanUsage) und ist
// für Clients schreibgeschützt. Der Client liest seinen Stand nur über
// GET /api/scan-usage – so kann niemand den Zähler selbst zurücksetzen.
function ScanQuota() {
  const [state, setState] = useState({ loading: true, used: 0, limit: 25, remaining: 25, resetAt: '', error: '' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/api/scan-usage`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (!active) return;
        setState({
          loading: false,
          used: Number(data.used) || 0,
          limit: Number(data.limit) || 25,
          remaining: Number(data.remaining) || 0,
          resetAt: data.resetAt || '',
          error: ''
        });
      } catch (e) {
        if (active) setState((s) => ({ ...s, loading: false, error: 'Kontingent konnte nicht geladen werden.' }));
      }
    };
    load();
    window.addEventListener(QUOTA_CHANGED_EVENT, load);
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener(QUOTA_CHANGED_EVENT, load);
      window.removeEventListener('focus', load);
    };
  }, []);

  const { used, limit, remaining, resetAt, loading, error } = state;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const resetText = resetAt
    ? new Date(resetAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return (
    <div className="pt-3 border-t border-slate-800 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-slate-300">📷 KI-Scans diesen Monat</p>
        <p className={`text-xs font-black ${remaining === 0 && !loading ? 'text-rose-400' : 'text-cyan-400'}`}>
          {loading ? '…' : `${used} / ${limit}`}
        </p>
      </div>
      <div className="h-1.5 rounded-full bg-slate-950 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${remaining === 0 ? 'bg-rose-500' : 'bg-cyan-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-slate-500">
        {error
          ? error
          : remaining === 0
            ? `Aufgebraucht${resetText ? ` – Reset am ${resetText}` : ''}.`
            : `${remaining} Scan${remaining === 1 ? '' : 's'} übrig${resetText ? ` · Reset am ${resetText}` : ''}.`}
      </p>
    </div>
  );
}


// ---------------------------------------------------------------------
// Konto löschen (Art. 17 DSGVO)
// ---------------------------------------------------------------------
// Ablauf:
//   1. Bestätigung durch Eintippen von „LÖSCHEN“ (verhindert Fehlklicks)
//   2. Re-Authentifizierung (Passwort bzw. Google-Popup), damit niemand mit
//      einer offenen Sitzung das Konto löscht
//   3. ID-Token an POST /api/delete-account: dort löscht der Server alles
//      (Firestore inkl. Untercollectionen, Storage, Kontingent, zuletzt den
//      Auth-User). Der Client kann Subcollections nicht rekursiv löschen.
const CONFIRM_WORD = 'LÖSCHEN';

function DeleteAccount({ user }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hasPassword = user.providerData.some((p) => p.providerId === 'password');

  const close = () => {
    if (busy) return;
    setOpen(false); setConfirm(''); setPassword(''); setError('');
  };

  // Frische Anmeldung: der Server prüft auth_time bzw. den letzten Sign-in.
  const reauth = async () => {
    if (hasPassword) {
      if (!password) throw new Error('Bitte dein Passwort eingeben.');
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      return;
    }
    if (isStandalone()) {
      throw new Error('Bitte melde dich ab und neu an – in der installierten App ist kein Anmeldefenster möglich.');
    }
    try {
      await reauthenticateWithPopup(user, googleProvider());
    } catch (e) {
      if (POPUP_PROBLEMS.includes(e.code)) {
        throw new Error('Das Anmeldefenster wurde blockiert. Bitte Pop-ups erlauben oder dich ab- und neu anmelden.');
      }
      throw e;
    }
  };


  const remove = async () => {
    setError('');
    if (confirm.trim().toUpperCase() !== CONFIRM_WORD) {
      setError(`Zum Löschen bitte „${CONFIRM_WORD}“ eintippen.`);
      return;
    }
    setBusy(true);
    try {
      await reauth();
      const token = await user.getIdToken(true);
      const res = await fetch(`${API_URL}/api/delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: CONFIRM_WORD })
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && data.code === 'reauth_required') {
        setError(data.error || 'Bitte melde dich zur Sicherheit neu an und versuche es erneut.');
        return;
      }
      if (!res.ok) {
        setError(data.error || `Löschen fehlgeschlagen (Status ${res.status}).`);
        return;
      }

      // Konto ist serverseitig gelöscht: Sitzung beenden und zur Startseite.
      await signOut(auth).catch(() => {});
      await navigate('/');
      window.scrollTo(0, 0);
    } catch (e) {
      console.error('Konto-Löschung fehlgeschlagen:', e.code, e.message);
      if (e.code && String(e.code).startsWith('auth/')) setError(authErrorMessage(e.code));
      else setError(e.message || 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const fieldCls = 'w-full bg-slate-950 border border-slate-700 focus:border-rose-500 rounded-lg px-3 py-2 text-xs text-white outline-none transition-colors';

  return (
    <div className="pt-3 border-t border-slate-800 space-y-2">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11px] font-bold text-rose-300 border border-rose-500/40 rounded-lg px-3 py-1.5 hover:bg-rose-500 hover:text-slate-950 transition-colors"
        >
          Konto löschen
        </button>
      ) : (
        <div className="bg-rose-500/5 border border-rose-500/40 rounded-xl p-3 space-y-2">
          <h4 className="text-xs font-black text-rose-300">Konto endgültig löschen</h4>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Gelöscht werden Sammlung, Watchlist, Binder, Verkaufs- und Wertverlaufsdaten, deine
            Freigabe-Links, dein Scan-Zähler und dein Anmeldekonto. Das lässt sich
            <strong className="text-slate-200"> nicht rückgängig</strong> machen. Sicherungskopien
            können aus technischen Gründen kurzzeitig noch bestehen (siehe Datenschutzerklärung).
          </p>

          {hasPassword ? (
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">Passwort bestätigen</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={fieldCls}
                placeholder="Dein Passwort"
              />
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">Zur Bestätigung öffnet sich das Google-Anmeldefenster.</p>
          )}

          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">
              Zum Bestätigen „{CONFIRM_WORD}“ eintippen
            </label>
            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoCapitalize="characters"
              className={fieldCls}
              placeholder={CONFIRM_WORD}
            />
          </div>

          {error && <p className="text-[11px] text-rose-400">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 transition-colors"
            >
              {busy ? 'Wird gelöscht …' : 'Endgültig löschen'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={close}
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

