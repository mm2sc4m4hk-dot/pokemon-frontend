// Echtes Login für PokéTracker (Firebase Authentication):
//   LoginScreen         – Anmelden, Registrieren, Passwort vergessen, Google
//   LegacyUpgradeBanner – nur für Altkonten (benutzername@poketracker.local): Konto sichern
//   AccountPanel        – Konto-Karte im Profil (E-Mail, Bestätigung, Google verknüpfen, Passwort ändern)
//
// Importiert nichts aus App.jsx (kein Zirkelbezug). Die Daten bleiben unter users/{uid}/... in Firestore,
// deshalb ändert sich an den Firestore-Regeln nichts.
//
// LEGACY: Alles, was mit LEGACY_DOMAIN zu tun hat, wird nur gebraucht, solange noch Altkonten existieren.
// Wenn alle Konten gesichert sind, kannst du die mit "LEGACY" markierten Stellen löschen.
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
  getRedirectResult,
  linkWithPopup,
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail
} from 'firebase/auth';
import { auth } from './firebase';
import { BRAND_NAME, Disclaimer } from './brand';

const LEGACY_DOMAIN = '@poketracker.local'; // LEGACY
export const isLegacyUser = (u) => !!u && !!u.email && u.email.toLowerCase().endsWith(LEGACY_DOMAIN); // LEGACY

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

const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true);

const inputCls = 'w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all';
const smallInputCls = 'w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 text-slate-100 rounded-lg px-3 py-2 text-sm outline-none';

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

  // Fehler nach der Rückkehr vom Redirect anzeigen
  useEffect(() => {
    getRedirectResult(auth).catch((err) => {
      if (!IGNORED.includes(err.code)) setError(authErrorMessage(err.code));
    });
  }, []);

  const switchMode = (m) => {
    setMode(m); setError(''); setInfo(''); setPassword(''); setConfirm('');
  };

  const login = async () => {
    const id = email.trim();
    if (!id || !password) { setError('Bitte E-Mail und Passwort eingeben.'); return; }
    // LEGACY: Altkonten melden sich noch mit dem alten Benutzernamen an
    const loginMail = id.includes('@') ? id : `${id.toLowerCase()}${LEGACY_DOMAIN}`;
    await signInWithEmailAndPassword(auth, loginMail, password);
    if (onDone) onDone();
  };

  const register = async () => {
    const mail = email.trim();
    if (!EMAIL_RE.test(mail)) { setError('Bitte eine gültige E-Mail-Adresse eingeben.'); return; }
    if (mail.toLowerCase().endsWith(LEGACY_DOMAIN)) { setError('Bitte eine echte E-Mail-Adresse verwenden.'); return; }
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
    if (mail.toLowerCase().endsWith(LEGACY_DOMAIN)) {
      // LEGACY
      setError('An diese Platzhalter-Adresse kann keine Mail gehen. Melde dich mit deinem alten Benutzernamen an und sichere das Konto im Profil mit einer echten E-Mail-Adresse.');
      return;
    }
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
            {mode === 'login' && (
              // LEGACY
              <p className="text-[10px] text-slate-500 mt-1 ml-1">Altes Konto? Hier weiter den alten Benutzernamen eintragen.</p>
            )}
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
      <Disclaimer className="mt-6 max-w-md px-2" />
    </div>
  );
}

// ---------------------------------------------------------------------
// Google mit dem aktuellen Konto verknüpfen (uid und Daten bleiben gleich)
// ---------------------------------------------------------------------
async function linkGoogle(user) {
  await linkWithPopup(user, googleProvider());
}

// ---------------------------------------------------------------------
// LEGACY: Banner für Altkonten (benutzername@poketracker.local)
// ---------------------------------------------------------------------
export function LegacyUpgradeBanner() {
  const user = auth.currentUser;
  const [newMail, setNewMail] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [, rerender] = useState(0);

  if (!isLegacyUser(user)) return null;
  const hasGoogle = user.providerData.some((p) => p.providerId === 'google.com');

  const run = async (fn, okText) => {
    setBusy(true); setMsg({ type: '', text: '' });
    try {
      await fn();
      setMsg({ type: 'ok', text: okText });
      rerender((x) => x + 1);
    } catch (e) {
      if (!IGNORED.includes(e.code)) {
        console.error('Konto sichern fehlgeschlagen:', e.code, e.message);
        setMsg({ type: 'err', text: authErrorMessage(e.code) });
      }
    } finally {
      setBusy(false);
    }
  };

  const connectGoogle = () => run(
    () => linkGoogle(user),
    'Google ist verknüpft. Ab jetzt kannst du dich mit „Mit Google anmelden“ einloggen – deine Daten bleiben erhalten.'
  );

  const changeMail = () => {
    const mail = newMail.trim();
    if (!EMAIL_RE.test(mail) || mail.toLowerCase().endsWith(LEGACY_DOMAIN)) { setMsg({ type: 'err', text: 'Bitte eine echte E-Mail-Adresse eingeben.' }); return; }
    if (!oldPw) { setMsg({ type: 'err', text: 'Bitte dein aktuelles Passwort eingeben.' }); return; }
    run(async () => {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, oldPw));
      await verifyBeforeUpdateEmail(user, mail);
      setOldPw('');
    }, `Wir haben einen Bestätigungslink an ${mail} geschickt. Nach dem Klick darauf ist das deine neue Anmelde-Adresse (gleiches Passwort wie bisher). Danach bitte neu anmelden.`);
  };

  return (
    <div className="bg-amber-500/10 border border-amber-500/40 rounded-2xl p-5 space-y-3 shadow-lg">
      <h3 className="font-bold text-amber-300 text-sm">🔐 Konto sichern</h3>
      <p className="text-xs text-slate-300">
        Dein Konto läuft noch mit dem alten Benutzernamen-Login. Dafür gibt es keine echte E-Mail-Adresse – „Passwort vergessen“ funktioniert deshalb nicht.
        Sichere es mit einer der beiden Möglichkeiten. Deine Karten, Binder und Verkäufe bleiben dabei unverändert.
      </p>

      {!hasGoogle && (
        <button onClick={connectGoogle} disabled={busy} className="w-full bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-900 font-bold text-sm py-2.5 rounded-xl">
          Google-Konto verknüpfen
        </button>
      )}
      {hasGoogle && <p className="text-xs text-emerald-400">✓ Google ist verknüpft.</p>}

      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-bold text-slate-200">Oder: echte E-Mail-Adresse hinterlegen</p>
        <input type="email" value={newMail} onChange={(e) => setNewMail(e.target.value)} placeholder="Neue E-Mail-Adresse" autoComplete="email" className={smallInputCls} />
        <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} placeholder="Aktuelles Passwort (zur Sicherheit)" autoComplete="current-password" className={smallInputCls} />
        <button onClick={changeMail} disabled={busy} className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black text-sm py-2.5 rounded-lg">
          {busy ? 'Bitte warten …' : 'Bestätigungslink senden'}
        </button>
      </div>

      {msg.text && <p className={`text-xs ${msg.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{msg.text}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Konto-Karte im Profil (für Konten mit echter E-Mail-Adresse)
// ---------------------------------------------------------------------
export function AccountPanel() {
  const user = auth.currentUser;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [, rerender] = useState(0);

  if (!user || isLegacyUser(user)) return null;
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
    </div>
  );
}
