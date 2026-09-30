import React, { useState, useEffect, useRef } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  collection as fsCollection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot
} from 'firebase/firestore';
import { auth, db } from './firebase';

// Verbindung zum Backend (nur für die Kartensuche über TCGdex, siehe server.js)
const API_URL = import.meta.env.VITE_API_URL || 'https://pokemon-backend-x7l7.onrender.com';

const LANGUAGES = [
  { name: 'Deutsch 🇩🇪', factor: 1.0 },
  { name: 'Englisch 🇬🇧', factor: 1.1 },
  { name: 'Japanisch 🇯🇵', factor: 0.8 },
  { name: 'Chinesisch 🇨🇳', factor: 0.65 },
  { name: 'Koreanisch 🇰🇷', factor: 0.5 },
  { name: 'Französisch 🇫🇷', factor: 0.9 },
  { name: 'Spanisch 🇪🇸', factor: 0.9 },
  { name: 'Italienisch 🇮🇹', factor: 0.9 }
];

const CONDITIONS = [
  { name: 'Mint', factor: 1.25, label: 'Mint (Makellos, +25%)' },
  { name: 'Near Mint', factor: 1.0, label: 'Near Mint (Standard)' },
  { name: 'Excellent', factor: 0.85, label: 'Excellent (-15%)' },
  { name: 'Good', factor: 0.70, label: 'Good (-30%)' },
  { name: 'Light Played', factor: 0.50, label: 'Light Played (-50%)' },
  { name: 'Played', factor: 0.35, label: 'Played (-65%)' },
  { name: 'Poor', factor: 0.15, label: 'Poor (Beschädigt, -85%)' }
];

const CHEAPEST_LANG = LANGUAGES.reduce((a, b) => (a.factor < b.factor ? a : b));

// Druckvarianten einer Karte. "holo" (bool auf der Variante) legt fest, ob
// die Holo-Cardmarket-Preise (trendPriceHolo etc.) statt der normalen
// verwendet werden — Cardmarket führt nur "non-foil" vs. "foil", nicht pro
// Variante einzeln, daher teilen sich Reverse Holo und Holo dieselbe
// Holo-Preisreihe. 1st Edition hat bei Cardmarket/TCGdex keine eigene
// EUR-Preisreihe, zählt hier daher wie "Normal".
const VARIANTS = [
  { key: 'normal', label: 'Normal', holo: false },
  { key: 'reverse', label: 'Reverse Holo', holo: true },
  { key: 'holo', label: 'Holo', holo: true },
  { key: 'firstEdition', label: '1st Edition', holo: false }
];

// Liefert nur die Varianten, die laut TCGdex für diese Karte wirklich
// existieren (card.variants, z.B. { normal: true, reverse: true, ... }).
// Ohne diese Info (oder wenn nichts als "true" markiert ist) wird
// zumindest "Normal" als Fallback angeboten, damit die Auswahl nie leer ist.
const getAvailableVariants = (card) => {
  const flags = card?.variants;
  if (!flags) return [VARIANTS[0]];
  const available = VARIANTS.filter((v) => flags[v.key]);
  return available.length > 0 ? available : [VARIANTS[0]];
};
const PREMIUM_LANG = LANGUAGES.reduce((a, b) => (a.factor > b.factor ? a : b));

// Firebase Auth erwartet eine E-Mail-Adresse. Die App fragt bewusst nur
// nach einem Benutzernamen (passend zum ursprünglichen Design) -> daraus
// wird intern eine eindeutige, technische Pseudo-E-Mail gebaut. Der Nutzer
// bekommt davon nichts mit, meldet sich immer nur mit Benutzername an.
const usernameToEmail = (username) => `${username.trim().toLowerCase()}@poketracker.local`;

// Übersetzt Firebase-Fehlercodes in verständliche deutsche Meldungen.
const authErrorMessage = (code) => {
  switch (code) {
    case 'auth/email-already-in-use': return 'Dieser Benutzername ist bereits vergeben.';
    case 'auth/weak-password': return 'Passwort zu kurz (mindestens 6 Zeichen).';
    case 'auth/invalid-credential':
    case 'auth/wrong-password': return 'Falsches Passwort.';
    case 'auth/user-not-found': return 'Diesen Benutzer gibt es noch nicht. Bitte zuerst registrieren.';
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed': return 'E-Mail/Passwort-Anmeldung ist in Firebase noch nicht aktiviert (Authentication → Sign-in method).';
    case 'auth/too-many-requests': return 'Zu viele Versuche. Bitte kurz warten und erneut versuchen.';
    case 'auth/network-request-failed': return 'Keine Verbindung zu Firebase. Internetverbindung prüfen.';
    default: return 'Etwas ist schiefgelaufen. Bitte erneut versuchen.';
  }
};

// Zeigt das Kartenbild, oder einen dezenten Platzhalter statt eines
// kaputten Bild-Icons, wenn TCGdex (noch) kein Bild für diese Karte hat.
// Menge einer Collection-Karte (ältere Einträge ohne Feld zählen als 1)
const qtyOf = (item) => Math.max(1, parseInt(item?.userQuantity, 10) || 1);
const parseQty = (v) => Math.max(1, parseInt(v, 10) || 1);
const parseMoney = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
};

// TCGdex-Karten-IDs haben die Form "<set-id>-<nummer>" (z.B. "sv08.5-061").
// Ältere Collection-Einträge haben noch keine set.id gespeichert -> aus der
// Karten-ID ableiten. Eigene Karten und reine Cardmarket-Treffer haben keine.
const setIdOf = (item) => {
  if (item?.set?.id) return item.set.id;
  const id = String(item?.id || '');
  if (!id || id.startsWith('custom-') || id.startsWith('cm-')) return null;
  const i = id.lastIndexOf('-');
  return i > 0 ? id.slice(0, i) : null;
};

// Set-Fortschritt: gruppiert die Collection nach Set und zeigt, wie viele
// Karten eines Sets vorhanden sind. Beim Aufklappen werden die fehlenden
// Karten vom Backend (TCGdex) geladen.
function SetsView({ collection }) {
  const [open, setOpen] = useState(null);
  const [cache, setCache] = useState({}); // setId -> { loading, error, cards }

  const groups = new Map();
  let withoutSet = 0;
  collection.forEach(item => {
    const sid = setIdOf(item);
    if (!sid) { withoutSet += 1; return; }
    const g = groups.get(sid) || { id: sid, name: item.set?.name || sid, total: item.set?.total || null, ids: new Set() };
    g.ids.add(item.id);
    groups.set(sid, g);
  });
  const list = [...groups.values()].sort((a, b) => {
    const pa = a.total ? a.ids.size / a.total : 0; const pb = b.total ? b.ids.size / b.total : 0;
    return pb - pa || a.name.localeCompare(b.name);
  });

  const toggle = async (g) => {
    if (open === g.id) { setOpen(null); return; }
    setOpen(g.id);
    if (cache[g.id]?.cards) return;
    setCache(c => ({ ...c, [g.id]: { loading: true } }));
    try {
      const res = await fetch(`${API_URL}/api/sets/${encodeURIComponent(g.id)}`);
      if (!res.ok) throw new Error('Set nicht gefunden');
      const data = await res.json();
      setCache(c => ({ ...c, [g.id]: { cards: data.cards || [] } }));
    } catch (e) {
      setCache(c => ({ ...c, [g.id]: { error: e.message || 'Fehler beim Laden' } }));
    }
  };

  if (list.length === 0) {
    return <div className="text-center py-20 text-slate-500">Noch keine Karten mit Set-Zuordnung in deiner Collection.</div>;
  }

  return (
    <div className="space-y-3">
      {list.map(g => {
        const owned = g.ids.size;
        const pct = g.total ? Math.min(100, Math.round((owned / g.total) * 100)) : 0;
        const c = cache[g.id];
        const missing = c?.cards ? c.cards.filter(card => !g.ids.has(card.id)) : [];
        return (
          <div key={g.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md">
            <button onClick={() => toggle(g)} className="w-full text-left">
              <div className="flex justify-between items-baseline gap-2">
                <span className="font-bold text-sm text-slate-200 truncate">{g.name}</span>
                <span className="text-xs text-cyan-400 font-bold whitespace-nowrap">{owned}{g.total ? ` / ${g.total}` : ''}{g.total ? ` (${pct}%)` : ''}</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full mt-2 overflow-hidden">
                <div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </button>
            {open === g.id && (
              <div className="mt-3 pt-3 border-t border-slate-800">
                {c?.loading && <p className="text-xs text-cyan-400">Lade Kartenliste…</p>}
                {c?.error && <p className="text-xs text-rose-400">{c.error}</p>}
                {c?.cards && (missing.length === 0
                  ? <p className="text-xs text-emerald-400">Komplett – dir fehlt keine Karte dieses Sets. 🎉</p>
                  : <>
                      <p className="text-[10px] text-slate-500 mb-2">Fehlend: {missing.length} (inkl. Secret Rares außerhalb der Grundnummerierung)</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                        {missing.map(card => (
                          <div key={card.id} className="text-center">
                            <CardImage src={card.image} alt={card.name} className="w-full rounded-md opacity-70" />
                            <p className="text-[10px] text-slate-400 mt-1 truncate">#{card.localId} {card.name}</p>
                          </div>
                        ))}
                      </div>
                    </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {withoutSet > 0 && <p className="text-[10px] text-slate-500 text-center">{withoutSet} Karten ohne Set-Zuordnung (z. B. eigene Karten oder ältere Einträge) sind hier nicht enthalten.</p>}
    </div>
  );
}

// Kartenname: bei Cardmarket-Treffern steht der Angriff im Namen
// ("Dedenne [Nuzzle | Spiral Drain]") -> Name groß, Angriffe klein darunter,
// dazu ein Abzeichen, damit man die Quelle erkennt.
function CardTitle({ card, size = 'sm', truncate = true }) {
  const isCm = card.source === 'cardmarket';
  const m = isCm ? String(card.name).match(/^([^\[]*?)\s*\[(.*)\]\s*$/) : null;
  const title = m ? m[1] : card.name;
  const attacks = m ? m[2] : null;
  const cls = size === 'lg' ? 'font-bold text-lg text-slate-100' : 'font-bold text-sm text-slate-200';
  return (
    <div>
      <h3 className={`${cls} ${truncate ? 'truncate' : ''}`}>
        {title}
        {card.number ? <span className="text-slate-500 font-normal"> #{card.number}{card.set?.total ? `/${card.set.total}` : ''}</span> : null}
      </h3>
      {attacks && <p className={`text-[10px] text-slate-500 ${truncate ? 'truncate' : ''}`} title={attacks}>{attacks}</p>}
      {isCm && (
        <span className="inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5" title="Daten aus der Cardmarket-Datei: kein Bild, keine Kartennummer">
          Cardmarket
        </span>
      )}
    </div>
  );
}

// TCGdex-Bild-URLs haben die Form assets.tcgdex.net/<sprache>/<serie>/<set>/<nr>/...
// Für manche deutschen Sets (z.B. Zenit der Könige) existiert die URL, aber die
// Datei nicht -> dann automatisch dieselbe Karte auf Englisch probieren.
function englishImageUrl(url) {
  if (!url || !url.includes('assets.tcgdex.net/')) return null;
  const swapped = url.replace(/assets\.tcgdex\.net\/(?!en\/)[a-z-]+\//, 'assets.tcgdex.net/en/');
  return swapped !== url ? swapped : null;
}

function CardImage({ src, alt, className, onClick }) {
  const [failedSrc, setFailedSrc] = useState(null); // Quelle, die nicht lädt
  const [enFailed, setEnFailed] = useState(false);

  // Bei neuer Quelle wieder von vorne anfangen
  useEffect(() => { setFailedSrc(null); setEnFailed(false); }, [src]);

  const en = englishImageUrl(src);
  let shown = src;
  if (failedSrc === src) shown = en && !enFailed ? en : null;

  if (!shown) {
    return (
      <div
        onClick={onClick}
        className={`${className} bg-slate-800 border border-slate-700 flex flex-col items-center justify-center text-center p-2 aspect-[5/7] ${onClick ? 'cursor-pointer' : ''}`}
      >
        <span className="text-2xl mb-1">🃏</span>
        <span className="text-[10px] text-slate-500 line-clamp-2">{alt || 'Kein Bild'}</span>
      </div>
    );
  }
  return (
    <img
      onClick={onClick}
      src={shown}
      alt={alt}
      loading="lazy"
      onError={() => { if (failedSrc === src) setEnFailed(true); else setFailedSrc(src); }}
      className={className}
    />
  );
}

// Verkleinert ein hochgeladenes Foto client-seitig (max. Breite 500px,
// JPEG q=0.7), bevor es als Base64 in Firestore landet — Firestore-Dokumente
// dürfen max. ~1MB groß sein, ein rohes Handyfoto würde das sprengen.
function resizeImageFile(file, maxWidth = 500, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  // --- AUTH (Firebase) ---
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [activeTab, setActiveTab] = useState('profile');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSet, setSearchSet] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchSelections, setSearchSelections] = useState({});

  // Collection & Watchlist kommen jetzt live aus Firestore (siehe useEffect
  // weiter unten), nicht mehr aus localStorage.
  const [collection, setCollection] = useState([]);
  const [watchlist, setWatchlist] = useState([]);

  const [selectedCard, setSelectedCard] = useState(null);
  const [modalType, setModalType] = useState(null);
  const [cardCondition, setCardCondition] = useState('Near Mint');
  const [cardLanguage, setCardLanguage] = useState('Deutsch 🇩🇪');
  const [cardVariant, setCardVariant] = useState('normal');
  const [detailVariant, setDetailVariant] = useState('normal');
  const [customPrice, setCustomPrice] = useState('');
  const [customImage, setCustomImage] = useState('');

  // Watchlist -> Collection: merkt sich, welche Watchlist-Karte gerade in die
  // Collection übernommen wird (und ob sie dort danach entfernt werden soll).
  const [moveFromWatchlistId, setMoveFromWatchlistId] = useState(null);
  const [removeFromWatchlistAfter, setRemoveFromWatchlistAfter] = useState(true);

  // Collection-Karte bearbeiten: Preis beim Öffnen merken, um zu erkennen,
  // ob der Nutzer ihn selbst geändert hat.
  const [editOriginalPrice, setEditOriginalPrice] = useState('');

  // Eigene Karte anlegen (für Karten, die es in TCGdex nicht gibt, z.B.
  // Dedenne GX 195a oder chinesische Exklusivkarten).
  const [customCardOpen, setCustomCardOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customNumber, setCustomNumber] = useState('');
  const [customSetName, setCustomSetName] = useState('');

  // Menge und Einkaufspreis (pro Stück) für Hinzufügen/Bearbeiten
  const [cardQuantity, setCardQuantity] = useState('1');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [collectionView, setCollectionView] = useState('cards'); // 'cards' | 'sets'
  useEffect(() => { if (modalType === 'collection') { setCardQuantity('1'); setPurchasePrice(''); } }, [modalType]);
  useEffect(() => { if (customCardOpen) { setCardQuantity('1'); setPurchasePrice(''); } }, [customCardOpen]);

  const [filterLang, setFilterLang] = useState('Alle');
  const [filterSet, setFilterSet] = useState('Alle');
  const [sortBy, setSortBy] = useState('name-asc');
  const [collectionSearch, setCollectionSearch] = useState('');

  const unsubscribers = useRef([]);

  // Beim Öffnen einer anderen Karte im Modal die Varianten-Ansicht des
  // Preisverlaufs zurücksetzen: eigene Collection-Karten zeigen direkt ihre
  // gespeicherte Variante, alles andere startet bei "Normal".
  useEffect(() => {
    setDetailVariant(selectedCard?.userVariant || 'normal');
  }, [selectedCard]);

  // Firebase-Login-Status beobachten. Läuft einmal beim Start und danach
  // bei jedem Login/Logout -> hier werden auch die Firestore-Live-Listener
  // für Collection & Watchlist auf- bzw. abgebaut.
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // alte Firestore-Listener immer zuerst abmelden
      unsubscribers.current.forEach((u) => u());
      unsubscribers.current = [];

      if (user) {
        setIsAuthenticated(true);
        setCurrentUser(user.displayName || user.email?.split('@')[0] || 'Trainer');

        const collRef = fsCollection(db, 'users', user.uid, 'collection');
        const unsubColl = onSnapshot(collRef, (snap) => {
          setCollection(snap.docs.map((d) => ({ ...d.data(), docId: d.id, instanceId: d.id })));
        });

        const watchRef = fsCollection(db, 'users', user.uid, 'watchlist');
        const unsubWatch = onSnapshot(watchRef, (snap) => {
          setWatchlist(snap.docs.map((d) => d.data()));
        });

        unsubscribers.current.push(unsubColl, unsubWatch);
      } else {
        setIsAuthenticated(false);
        setCurrentUser('');
        setCollection([]);
        setWatchlist([]);
      }
      setAuthLoading(false);
    });

    return () => {
      unsubAuth();
      unsubscribers.current.forEach((u) => u());
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const uname = authUsername.trim();
    if (!uname || !authPassword) {
      setAuthError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    setAuthBusy(true);
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(uname), authPassword);
      setActiveTab('profile');
    } catch (err) {
      console.error('Firebase Auth Fehler:', err.code, err.message);
      setAuthError(authErrorMessage(err.code));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError('');
    const uname = authUsername.trim();
    if (!uname || !authPassword || !authPasswordConfirm) {
      setAuthError('Bitte alle Felder ausfüllen.');
      return;
    }
    if (authPassword !== authPasswordConfirm) {
      setAuthError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setAuthBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(uname), authPassword);
      await updateProfile(cred.user, { displayName: uname });
      setActiveTab('profile');
    } catch (err) {
      console.error('Firebase Auth Fehler:', err.code, err.message);
      setAuthError(authErrorMessage(err.code));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    signOut(auth);
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    setAuthError('');
    setAuthPassword('');
    setAuthPasswordConfirm('');
  };

  // --- SICHERE PREIS-LOGIK ---
  const calculatePrice = (card, conditionName, langName, variantKey = 'normal') => {
    if (!card) return "0.00";
    const isHolo = VARIANTS.find(v => v.key === variantKey)?.holo;
    const prices = card.cardmarket?.prices || {};
    const basePrice = isHolo
      ? (prices.trendPriceHolo || prices.avg1Holo || 0)
      : (prices.trendPrice || prices.averageSellPrice || 0);
    const condFactor = CONDITIONS.find(c => c.name === conditionName)?.factor || 1.0;
    const langFactor = LANGUAGES.find(l => l.name === langName)?.factor || 1.0;
    return (basePrice * condFactor * langFactor).toFixed(2);
  };

  const getTrendIcon = (card, variantKey = 'normal') => {
    if (!card) return null;
    const isHolo = VARIANTS.find(v => v.key === variantKey)?.holo;
    const prices = card.cardmarket?.prices || {};
    const current = (isHolo ? prices.trendPriceHolo : prices.trendPrice) || 0;
    const avg30 = (isHolo ? prices.avg30Holo : prices.avg30) || current;
    const threshold = Math.max(0.05, avg30 * 0.03);
    if (current > avg30 + threshold) return <span className="text-emerald-400 font-bold" title="Preis steigt">▲</span>;
    if (current < avg30 - threshold) return <span className="text-rose-400 font-bold" title="Preis sinkt">▼</span>;
    return <span className="text-slate-400 font-bold" title="Preis stabil">=</span>;
  };

  const getPriceHistoryBars = (card, variantKey = 'normal') => {
    const isHolo = VARIANTS.find(v => v.key === variantKey)?.holo;
    const prices = card?.cardmarket?.prices || {};
    const points = isHolo
      ? [
          { label: '30 T', value: prices.avg30Holo || 0 },
          { label: '7 T', value: prices.avg7Holo || 0 },
          { label: 'Heute', value: prices.trendPriceHolo || prices.avg1Holo || 0 }
        ]
      : [
          { label: '30 T', value: prices.avg30 || 0 },
          { label: '7 T', value: prices.avg7 || 0 },
          { label: 'Heute', value: prices.trendPrice || prices.avg1 || 0 }
        ];
    const max = Math.max(...points.map(p => p.value), 0.01);
    return points.map(p => ({ ...p, pct: Math.max(8, Math.round((p.value / max) * 100)) }));
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSearchError('');
    try {
      const params = new URLSearchParams({ name: searchQuery });
      if (searchSet.trim()) params.set('set', searchSet.trim());

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      const res = await fetch(`${API_URL}/api/cards?${params.toString()}`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.status === 429) {
        setSearchResults([]);
        setSearchError('Zu viele Anfragen an die Kartendatenbank gerade (Rate Limit). Bitte kurz warten und erneut suchen.');
        return;
      }
      if (!res.ok) throw new Error('API antwortet nicht');
      const data = await res.json();

      if (!Array.isArray(data)) {
        setSearchResults([]);
        setSearchError('Keine Karten gefunden oder Fehler bei der Abfrage.');
      } else if (data.length === 0) {
        setSearchResults([]);
        setSearchError('Keine Karten mit diesem Namen/dieser Nummer (und Set) gefunden.');
      } else {
        setSearchResults(data);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        setSearchError('Der Server hat zu lange nicht geantwortet. Falls er gerade erst "aufwacht" (Render-Gratisplan schläft nach Inaktivität ein), bitte in ca. 1 Minute nochmal suchen.');
      } else {
        setSearchError('Verbindungsfehler zum Backend. Läuft der Server auf Render noch?');
      }
    } finally {
      setLoading(false);
    }
  };

  const getSearchSelection = (cardId) =>
    searchSelections[cardId] || { condition: 'Near Mint', language: 'Deutsch 🇩🇪', variant: 'normal' };

  const updateSearchSelection = (cardId, patch) => {
    setSearchSelections(prev => ({
      ...prev,
      [cardId]: { ...getSearchSelection(cardId), ...patch }
    }));
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImageFile(file);
      setCustomImage(resized);
    } catch (err) {
      alert('Foto konnte nicht gelesen werden. Bitte anderes Bild versuchen.');
    }
  };

  const addToCollection = async () => {
    if (!auth.currentUser) return;
    const calculatedVal = calculatePrice(selectedCard, cardCondition, cardLanguage, cardVariant);
    const newItem = {
      ...selectedCard,
      userCondition: cardCondition,
      userLanguage: cardLanguage,
      userVariant: cardVariant,
      userPrice: customPrice ? parseFloat(customPrice).toFixed(2) : calculatedVal,
      userQuantity: parseQty(cardQuantity),
      userPurchasePrice: parseMoney(purchasePrice),
      customImage: customImage || null,
      addedAt: Date.now()
    };
    delete newItem.docId;
    delete newItem.instanceId;
    try {
      await addDoc(fsCollection(db, 'users', auth.currentUser.uid, 'collection'), newItem);
      // kein manuelles setCollection nötig — der Firestore-Live-Listener
      // (onSnapshot) aktualisiert die Ansicht automatisch.
      if (moveFromWatchlistId && removeFromWatchlistAfter) {
        await removeFromWatchlist(moveFromWatchlistId);
      }
      setModalType(null);
      setMoveFromWatchlistId(null);
      setCustomPrice('');
      setCustomImage('');
      setCardVariant('normal');
    } catch (err) {
      alert('Speichern fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const openEditCard = (item) => {
    setSelectedCard(item);
    setCardCondition(item.userCondition || 'Near Mint');
    setCardLanguage(item.userLanguage || 'Deutsch 🇩🇪');
    setCardVariant(item.userVariant || 'normal');
    setCustomPrice(item.userPrice ? String(item.userPrice) : '');
    setEditOriginalPrice(item.userPrice ? String(item.userPrice) : '');
    setCustomImage(item.customImage || '');
    setCardQuantity(String(qtyOf(item)));
    setPurchasePrice(item.userPurchasePrice ? String(item.userPurchasePrice) : '');
    setMoveFromWatchlistId(null);
    setModalType('edit');
  };

  const saveEdit = async () => {
    if (!auth.currentUser || !selectedCard?.docId) return;
    // Hat der Nutzer den Preis selbst geändert -> den nehmen. Sonst bei
    // normalen Karten neu aus Zustand/Sprache/Variante berechnen; bei
    // eigenen Karten (ohne Cardmarket-Preis) den bisherigen Preis behalten.
    const priceTouched = customPrice !== editOriginalPrice && customPrice !== '';
    let price;
    if (priceTouched) price = parseFloat(customPrice).toFixed(2);
    else if (selectedCard.isCustom) price = selectedCard.userPrice || '0.00';
    else price = calculatePrice(selectedCard, cardCondition, cardLanguage, cardVariant);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid, 'collection', selectedCard.docId), {
        userCondition: cardCondition,
        userLanguage: cardLanguage,
        userVariant: cardVariant,
        userPrice: price,
        userQuantity: parseQty(cardQuantity),
        userPurchasePrice: parseMoney(purchasePrice),
        customImage: customImage || null
      });
      setModalType(null);
      setCustomPrice('');
      setCustomImage('');
      setEditOriginalPrice('');
      setCardVariant('normal');
    } catch (err) {
      alert('Änderung fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const closeCustomCard = () => {
    setCustomCardOpen(false);
    setCustomName(''); setCustomNumber(''); setCustomSetName('');
    setCustomPrice(''); setCustomImage('');
  };

  const saveCustomCard = async () => {
    if (!auth.currentUser) return;
    if (!customName.trim()) {
      alert('Bitte einen Kartennamen eintragen.');
      return;
    }
    const price = customPrice ? parseFloat(customPrice).toFixed(2) : '0.00';
    const newItem = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      number: customNumber.trim() || null,
      images: { small: '', large: '' },
      set: { name: customSetName.trim() || null, total: null },
      variants: null,
      cardmarket: { url: '', prices: {} },
      isCustom: true,
      userCondition: cardCondition,
      userLanguage: cardLanguage,
      userVariant: cardVariant,
      userPrice: price,
      userQuantity: parseQty(cardQuantity),
      userPurchasePrice: parseMoney(purchasePrice),
      customImage: customImage || null,
      addedAt: Date.now()
    };
    try {
      await addDoc(fsCollection(db, 'users', auth.currentUser.uid, 'collection'), newItem);
      closeCustomCard();
      setCardVariant('normal');
    } catch (err) {
      alert('Speichern fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const removeFromCollection = async (docId) => {
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'collection', docId));
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const addToWatchlistCard = async (card) => {
    if (!auth.currentUser) return;
    try {
      // card.id als Dokument-ID -> verhindert automatisch Duplikate.
      await setDoc(doc(db, 'users', auth.currentUser.uid, 'watchlist', card.id), { ...card, addedAt: Date.now() });
    } catch (err) {
      alert('Zur Watchlist hinzufügen fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  const removeFromWatchlist = async (cardId) => {
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'watchlist', cardId));
    } catch (err) {
      alert('Entfernen fehlgeschlagen: ' + (err.message || 'Unbekannter Fehler'));
    }
  };

  // Schnelle Abfrage, ob eine Karte schon auf der Watchlist ist (für den
  // Stern in der Suche). Ein Klick auf den Stern schaltet um: hinzufügen
  // bzw. wieder entfernen.
  const watchlistIds = new Set(watchlist.map((c) => c.id));
  const toggleWatchlist = (card) => {
    if (watchlistIds.has(card.id)) removeFromWatchlist(card.id);
    else addToWatchlistCard(card);
  };

  const formatAdded = (ts) => ts
    ? new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const stats = (() => {
    if (collection.length === 0) return { min: '0.00', median: '0.00', max: '0.00' };
    let total = 0, totalMin = 0, totalMax = 0;
    collection.forEach(item => {
      const price = (parseFloat(item.userPrice) || 0) * qtyOf(item);
      total += price;
      totalMin += price * 0.85;
      totalMax += price * 1.25;
    });
    return { min: totalMin.toFixed(2), median: total.toFixed(2), max: totalMax.toFixed(2) };
  })();

  // Gesamtzahl (mit Mengen) und Gewinn/Verlust – nur über Karten mit Einkaufspreis
  const totalPieces = collection.reduce((sum, item) => sum + qtyOf(item), 0);
  const invest = (() => {
    let cost = 0, value = 0, n = 0;
    collection.forEach(item => {
      const buy = parseFloat(item.userPurchasePrice);
      if (!Number.isFinite(buy)) return;
      const q = qtyOf(item);
      cost += buy * q;
      value += (parseFloat(item.userPrice) || 0) * q;
      n += 1;
    });
    return { cost, value, profit: value - cost, n };
  })();
  const fmtSigned = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)} €`;

  const filteredCollection = (() => {
    let list = [...collection];
    const q = collectionSearch.trim().toLowerCase();
    if (q) list = list.filter(i => (i.name || '').toLowerCase().includes(q));
    if (filterLang !== 'Alle') list = list.filter(i => i.userLanguage === filterLang);
    if (filterSet !== 'Alle') list = list.filter(i => i.set?.name === filterSet);

    list.sort((a, b) => {
      const nameA = a.name || ''; const nameB = b.name || '';
      const setA = a.set?.name || ''; const setB = b.set?.name || '';
      const langA = a.userLanguage || ''; const langB = b.userLanguage || '';

      if (sortBy === 'name-asc') return nameA.localeCompare(nameB);
      if (sortBy === 'name-desc') return nameB.localeCompare(nameA);
      if (sortBy === 'price-desc') return (parseFloat(b.userPrice) || 0) - (parseFloat(a.userPrice) || 0);
      if (sortBy === 'price-asc') return (parseFloat(a.userPrice) || 0) - (parseFloat(b.userPrice) || 0);
      if (sortBy === 'set-asc') return setA.localeCompare(setB);
      if (sortBy === 'set-desc') return setB.localeCompare(setA);
      if (sortBy === 'lang-asc') return langA.localeCompare(langB);
      if (sortBy === 'lang-desc') return langB.localeCompare(langA);
      // Ältere Karten ohne Zeitstempel zählen als "ganz alt" (addedAt = 0).
      if (sortBy === 'added-desc') return (b.addedAt || 0) - (a.addedAt || 0);
      if (sortBy === 'added-asc') return (a.addedAt || 0) - (b.addedAt || 0);
      return 0;
    });
    return list;
  })();

  const availableSets = ['Alle', ...new Set(collection.map(item => item.set?.name).filter(Boolean))];

  // Beim allerersten Laden (Firebase prüft noch, ob eine Sitzung existiert)
  // lieber einen kurzen Ladeschirm zeigen als kurz den Login-Screen aufblitzen
  // zu lassen.
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        Lädt...
      </div>
    );
  }

  if (!isAuthenticated) {
    const isRegister = authMode === 'register';
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans selection:bg-cyan-500 text-slate-100">
        <div className="bg-slate-900 border border-cyan-500/30 p-8 rounded-2xl w-full max-w-md shadow-2xl shadow-cyan-900/20">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-teal-400 tracking-wider mb-2">PokéTracker</h1>
            <p className="text-slate-400 text-sm">Verwalte deine Sammlung & Werte</p>
          </div>

          <h2 className="text-xl font-bold text-slate-200 mb-4">{isRegister ? 'Sign up' : 'Login'}</h2>

          <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-4">
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Benutzername</label>
              <input
                type="text"
                required
                value={authUsername}
                onChange={e => setAuthUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all"
                placeholder="Dein Benutzername"
              />
            </div>
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Passwort</label>
              <input
                type="password"
                required
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all"
                placeholder="••••••••"
              />
            </div>
            {isRegister && (
              <div>
                <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Passwort bestätigen</label>
                <input
                  type="password"
                  required
                  value={authPasswordConfirm}
                  onChange={e => setAuthPasswordConfirm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all"
                  placeholder="••••••••"
                />
              </div>
            )}

            {authError && <p className="text-rose-400 text-sm text-center">{authError}</p>}

            <button type="submit" disabled={authBusy} className="w-full bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-black text-lg py-3 rounded-xl transition-all shadow-lg shadow-cyan-500/20 mt-4">
              {authBusy ? 'Bitte warten...' : isRegister ? 'Account erstellen' : 'Anmelden'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-400">
            {isRegister ? (
              <p>Bereits einen Account? <button onClick={() => switchAuthMode('login')} className="text-cyan-400 font-bold hover:underline">Hier anmelden</button></p>
            ) : (
              <p>Sign up: Noch keinen Account? <button onClick={() => switchAuthMode('register')} className="text-cyan-400 font-bold hover:underline">Hier registrieren</button></p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24 font-sans selection:bg-cyan-500 selection:text-black">
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-cyan-500/20 px-4 py-3 flex items-center justify-between shadow-md">
        <span className="text-cyan-400 text-xl font-black tracking-wider">⚡ PokéTracker</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 hidden sm:inline">{currentUser}</span>
          <button onClick={handleLogout} className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-rose-400 transition-colors">Abmelden</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'profile' && (
          <div className="space-y-6 fade-in">
            <div className="bg-slate-900 border border-cyan-500/30 p-6 rounded-2xl shadow-xl shadow-cyan-900/10">
              <h2 className="text-xl font-black text-white mb-1">Willkommen zurück, {currentUser || 'Trainer'}</h2>
              <p className="text-slate-400 text-sm mb-6">Wert deiner Collection</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-center">
                <div className="order-first sm:order-none col-span-2 sm:col-span-1 min-w-0 bg-slate-950 border border-cyan-500/50 p-4 rounded-xl shadow-lg shadow-cyan-500/20 sm:scale-105 z-10 flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-cyan-400 font-black uppercase tracking-widest">Medianwert</p>
                  <p className="text-2xl font-black text-cyan-300 mt-1 break-words">{stats.median} €</p>
                </div>
                <div className="sm:order-first min-w-0 bg-slate-950 border border-slate-800 p-3 sm:p-4 rounded-xl flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider sm:tracking-widest">Minimalwert</p>
                  <p className="text-base sm:text-lg font-bold text-slate-300 mt-1 break-words">{stats.min} €</p>
                </div>
                <div className="min-w-0 bg-slate-950 border border-slate-800 p-3 sm:p-4 rounded-xl flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider sm:tracking-widest">Maximalwert</p>
                  <p className="text-base sm:text-lg font-bold text-emerald-400 mt-1 break-words">{stats.max} €</p>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 flex justify-between text-sm">
                <span className="text-slate-400">Anzahl Karten:</span>
                <span className="font-bold text-cyan-400">{totalPieces} Stück{totalPieces !== collection.length ? ` (${collection.length} verschiedene)` : ''}</span>
              </div>
              {invest.n > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-800 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Investiert ({invest.n} Karten mit Einkaufspreis):</span><span className="font-bold text-slate-200">{invest.cost.toFixed(2)} €</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Aktueller Wert dieser Karten:</span><span className="font-bold text-slate-200">{invest.value.toFixed(2)} €</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Gewinn / Verlust:</span><span className={`font-black ${invest.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtSigned(invest.profit)}</span></div>
                </div>
              )}
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-slate-400">Karten auf der Watchlist:</span>
                <span className="font-bold text-cyan-400">{watchlist.length} Stück</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'collection' && (
          <div className="space-y-4 fade-in">
            <div className="flex gap-2">
              {[['cards', '🎴 Karten'], ['sets', '📊 Set-Fortschritt']].map(([key, label]) => (
                <button key={key} onClick={() => setCollectionView(key)} className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${collectionView === key ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'}`}>{label}</button>
              ))}
            </div>
            <div className={`bg-slate-900 border border-slate-800 p-3 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-2 shadow-md ${collectionView === 'sets' ? 'hidden' : ''}`}>
              <div className="relative col-span-2 md:col-span-4">
                <input
                  type="text"
                  value={collectionSearch}
                  onChange={e => setCollectionSearch(e.target.value)}
                  placeholder="In der Collection suchen, z.B. Glumanda"
                  className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 text-sm text-slate-200 rounded-lg pl-3 pr-9 py-2 outline-none"
                />
                {collectionSearch && (
                  <button
                    onClick={() => setCollectionSearch('')}
                    aria-label="Suche zurücksetzen"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-400 text-sm px-1"
                  >
                    ✕
                  </button>
                )}
              </div>
              <select value={filterLang} onChange={e => setFilterLang(e.target.value)} className="bg-slate-950 text-xs border border-slate-800 rounded-lg p-2 text-slate-300">
                <option value="Alle">Alle Sprachen</option>
                {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
              <select value={filterSet} onChange={e => setFilterSet(e.target.value)} className="bg-slate-950 text-xs border border-slate-800 rounded-lg p-2 text-slate-300">
                {availableSets.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="bg-slate-950 text-xs border border-slate-800 rounded-lg p-2 text-slate-300 md:col-span-2">
                <option value="name-asc">Name (A–Z)</option>
                <option value="name-desc">Name (Z–A)</option>
                <option value="price-desc">Preis (absteigend)</option>
                <option value="price-asc">Preis (aufsteigend)</option>
                <option value="set-asc">Set (A–Z)</option>
                <option value="set-desc">Set (Z–A)</option>
                <option value="lang-asc">Sprache (A–Z)</option>
                <option value="lang-desc">Sprache (Z–A)</option>
                <option value="added-desc">Zuletzt hinzugefügt</option>
                <option value="added-asc">Zuerst hinzugefügt</option>
              </select>
            </div>
            {collectionView === 'sets' ? (
              <SetsView collection={collection} />
            ) : filteredCollection.length === 0 ? (
              <div className="text-center py-20 text-slate-500">Keine Karten gefunden.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filteredCollection.map((item) => (
                  <div key={item.docId} className="bg-slate-900 border border-slate-800 rounded-xl p-3 relative group shadow-lg">
                    <button onClick={() => openEditCard(item)} title="Bearbeiten" className="absolute top-2 left-2 bg-slate-950/80 text-cyan-400 w-6 h-6 rounded-full text-xs font-bold z-10 border border-cyan-500/30 hover:bg-cyan-500 hover:text-slate-950 transition">✎</button>
                    <button onClick={() => removeFromCollection(item.docId)} className="absolute top-2 right-2 bg-slate-950/80 text-rose-400 w-6 h-6 rounded-full text-xs font-bold z-10 border border-rose-500/30 hover:bg-rose-500 hover:text-white transition">✕</button>
                    <CardImage onClick={() => { setSelectedCard(item); setModalType('detail'); }} src={item.customImage || item.images?.small} alt={item.name} className="w-full rounded-lg mb-2 cursor-pointer hover:scale-105 transition-transform" />
                    <CardTitle card={item} />
                    <p className="text-xs text-slate-400 truncate">{item.set?.name || 'Unbekanntes Set'} • {item.userLanguage.split(' ')[0]}</p>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-cyan-400 font-bold">{item.userPrice} €</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] bg-slate-800 px-1 rounded text-slate-300">{item.userCondition}</span>
                        {item.userVariant && item.userVariant !== 'normal' && (
                          <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1 rounded">{VARIANTS.find(v => v.key === item.userVariant)?.label || item.userVariant}</span>
                        )}
                        {getTrendIcon(item, item.userVariant)}
                      </div>
                    </div>
                    {qtyOf(item) > 1 && (
                      <p className="text-[11px] text-slate-300 mt-1">×{qtyOf(item)} · zusammen {((parseFloat(item.userPrice) || 0) * qtyOf(item)).toFixed(2)} €</p>
                    )}
                    {Number.isFinite(parseFloat(item.userPurchasePrice)) && (() => {
                      const diff = ((parseFloat(item.userPrice) || 0) - parseFloat(item.userPurchasePrice)) * qtyOf(item);
                      return (
                        <p className="text-[11px] mt-1 text-slate-400">
                          Kauf {parseFloat(item.userPurchasePrice).toFixed(2)} € · <span className={diff >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{fmtSigned(diff)}</span>
                        </p>
                      );
                    })()}
                    {item.addedAt && <p className="text-[10px] text-slate-500 mt-1">Hinzugefügt: {formatAdded(item.addedAt)}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'watchlist' && (
          <div className="space-y-4 fade-in">
            {watchlist.length === 0 ? (
              <div className="text-center py-20 text-slate-500">Deine Watchlist ist leer.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...watchlist].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map((card) => {
                  const minPrice = calculatePrice(card, 'Poor', CHEAPEST_LANG.name);
                  const maxPrice = calculatePrice(card, 'Mint', PREMIUM_LANG.name);
                  return (
                    <div key={card.id} className="bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-3 flex gap-4 items-center shadow-lg transition-colors">
                      <CardImage onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small} alt={card.name} className="w-16 rounded-md cursor-pointer hover:opacity-80" />
                      <div className="flex-1">
                        <CardTitle card={card} truncate={false} />
                        <p className="text-xs text-slate-400">{card.set?.name || 'Unbekannt'}</p>
                        {card.addedAt && <p className="text-[10px] text-slate-500">Hinzugefügt: {formatAdded(card.addedAt)}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-cyan-400">Min {minPrice}€ – Max {maxPrice}€</p>
                          {getTrendIcon(card)}
                        </div>
                      </div>
                      <div className="flex flex-col items-stretch gap-2">
                        <button
                          onClick={() => {
                            setSelectedCard(card);
                            setCardCondition('Near Mint');
                            setCardLanguage('Deutsch 🇩🇪');
                            setCardVariant(getAvailableVariants(card)[0].key);
                            setMoveFromWatchlistId(card.id);
                            setRemoveFromWatchlistAfter(true);
                            setModalType('collection');
                          }}
                          title="In die Collection übernehmen"
                          className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500 hover:text-slate-900 text-xs font-bold px-3 py-2 rounded-lg border border-cyan-500/30 transition-colors"
                        >
                          ➕ Coll
                        </button>
                        <button onClick={() => removeFromWatchlist(card.id)} className="text-slate-500 hover:text-rose-400 text-sm font-bold">✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="space-y-6 fade-in">
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Name oder Name + Nummer, z.B. Glumanda 044" className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none" />
              <input type="text" value={searchSet} onChange={e => setSearchSet(e.target.value)} placeholder="Set (optional, z.B. Base Set)" className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none" />
              <button type="submit" className="bg-cyan-500 text-slate-950 font-bold px-6 py-3 rounded-xl hover:bg-cyan-400 transition-colors">Suche</button>
            </form>

            {loading && <div className="text-center text-cyan-400 py-10">Lade Karten...</div>}
            {searchError && <div className="text-center text-rose-400 py-10">{searchError}</div>}

            <div className="text-center">
              <button
                onClick={() => setCustomCardOpen(true)}
                className="text-xs text-cyan-400 hover:underline"
              >
                Karte nicht gefunden? Eigene Karte anlegen
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.isArray(searchResults) && searchResults.map((card) => {
                const sel = getSearchSelection(card.id);
                const livePrice = calculatePrice(card, sel.condition, sel.language, sel.variant);
                const variantOptions = getAvailableVariants(card);
                return (
                  <div key={card.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col relative group shadow-lg">
                    <CardImage onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small} alt={card.name} className="w-full rounded-lg mb-2 cursor-pointer hover:scale-105 transition-transform" />
                    <CardTitle card={card} />
                    <p className="text-xs text-slate-400 truncate">{card.set?.name || 'Unbekannt'}</p>

                    <div className="flex flex-wrap gap-1 mt-2">
                      <select value={sel.condition} onChange={e => updateSearchSelection(card.id, { condition: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                        {CONDITIONS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <select value={sel.language} onChange={e => updateSearchSelection(card.id, { language: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                        {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name.split(' ')[0]}</option>)}
                      </select>
                      {variantOptions.length > 1 && (
                        <select value={sel.variant} onChange={e => updateSearchSelection(card.id, { variant: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                          {variantOptions.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                        </select>
                      )}
                    </div>

                    <div className="mt-auto pt-2 flex items-center justify-between gap-1">
                      <p className="text-cyan-400 font-bold text-xs">~{livePrice} €</p>
                      {card.cardmarket?.url && (
                        <a href={card.cardmarket.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[10px] text-slate-500 hover:text-cyan-400 underline shrink-0">Cardmarket ↗</a>
                      )}
                    </div>
                    <div className="flex gap-1 mt-3">
                      <button
                        onClick={() => {
                          setSelectedCard(card);
                          setCardCondition(sel.condition);
                          setCardLanguage(sel.language);
                          setCardVariant(sel.variant);
                          setModalType('collection');
                        }}
                        className="flex-1 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500 hover:text-slate-900 text-xs font-bold py-2 rounded-lg border border-cyan-500/30 transition-colors"
                      >
                        ➕ Coll
                      </button>
                      {(() => {
                        const inWatchlist = watchlistIds.has(card.id);
                        return (
                          <button
                            onClick={() => toggleWatchlist(card)}
                            aria-pressed={inWatchlist}
                            title={inWatchlist ? 'Von der Watchlist entfernen' : 'Zur Watchlist hinzufügen'}
                            className={`text-xs px-3 rounded-lg border transition-colors ${inWatchlist ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/30' : 'bg-slate-800 text-slate-300 hover:text-cyan-400 border-slate-700'}`}
                          >
                            ★
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-cyan-500/20 px-6 py-2 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'profile' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg">👤</span><span>Profil</span></button>
          <button onClick={() => setActiveTab('collection')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'collection' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg">🎴</span><span>Collection</span></button>
          <button onClick={() => setActiveTab('watchlist')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'watchlist' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg">★</span><span>Watchlist</span></button>
          <button onClick={() => setActiveTab('search')} className={`flex flex-col items-center gap-1 text-xs font-bold transition-all ${activeTab === 'search' ? 'text-cyan-400 scale-110' : 'text-slate-500 hover:text-slate-400'}`}><span className="text-lg">🔍</span><span>Suchen</span></button>
        </div>
      </nav>

      {modalType && selectedCard && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-sm w-full p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex gap-4 mb-4">
              <CardImage src={selectedCard.customImage || selectedCard.images?.small} alt={selectedCard.name} className="w-24 rounded-lg shadow-lg" />
              <div>
                <CardTitle card={selectedCard} size="lg" truncate={false} />
                <p className="text-sm text-slate-400">{selectedCard.set?.name || 'Unbekannt'}</p>
                <div className="mt-2 text-xs text-slate-300">Trend (Basis): <span className="text-cyan-400 font-bold">{selectedCard.cardmarket?.prices?.trendPrice || 0} €</span></div>
                {selectedCard.cardmarket?.url && (
                  <a href={selectedCard.cardmarket.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline mt-1 inline-block">Original-Angebote auf Cardmarket ansehen ↗</a>
                )}
              </div>
            </div>

            {modalType === 'detail' && (
              <div className="space-y-4 mb-4 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-cyan-400">Preisverlauf</h4>
                  {getTrendIcon(selectedCard, detailVariant)}
                </div>
                {getAvailableVariants(selectedCard).length > 1 && (
                  <div className="flex gap-1">
                    {getAvailableVariants(selectedCard).map(v => (
                      <button
                        key={v.key}
                        onClick={() => setDetailVariant(v.key)}
                        className={`flex-1 text-[10px] font-bold py-1.5 rounded-lg border transition-colors ${detailVariant === v.key ? 'bg-cyan-500 text-slate-950 border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'}`}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const bars = getPriceHistoryBars(selectedCard, detailVariant);
                  const hasData = bars.some(b => b.value > 0);
                  if (!hasData) {
                    return <p className="text-xs text-slate-500 text-center py-6">Keine Preisdaten von Cardmarket verfügbar.</p>;
                  }
                  return (
                    <div className="flex items-end gap-2 h-24 bg-slate-950 p-3 rounded-xl border border-slate-800">
                      {bars.map((b, idx) => (
                        <div key={b.label} className="flex-1 flex flex-col items-center justify-end gap-1">
                          <span className="text-[10px] text-slate-400">{b.value.toFixed(2)}€</span>
                          <div className={`w-full rounded-t-sm ${idx === bars.length - 1 ? 'bg-cyan-400' : idx === bars.length - 2 ? 'bg-cyan-800' : 'bg-slate-700'}`} style={{ height: `${b.pct}%` }}></div>
                          <span className={`text-[10px] ${idx === bars.length - 1 ? 'text-cyan-400 font-bold' : 'text-slate-500'}`}>{b.label}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {(modalType === 'collection' || modalType === 'edit') && (
              <div className="space-y-3 mb-4 border-t border-slate-800 pt-3">
                {moveFromWatchlistId && (
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={removeFromWatchlistAfter} onChange={e => setRemoveFromWatchlistAfter(e.target.checked)} className="accent-cyan-500" />
                    Danach von der Watchlist entfernen
                  </label>
                )}
                <div>
                  <label className="text-xs text-slate-400">Zustand (Condition)</label>
                  <select value={cardCondition} onChange={e => setCardCondition(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                    {CONDITIONS.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Sprache der Karte</label>
                  <select value={cardLanguage} onChange={e => setCardLanguage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                    {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Variante</label>
                  <select value={cardVariant} onChange={e => setCardVariant(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                    {VARIANTS.map(v => <option key={v.key} value={v.key}>{v.label}{selectedCard?.variants && !selectedCard.variants[v.key] ? ' (laut TCGdex nicht bekannt)' : ''}</option>)}
                  </select>
                  {(!selectedCard?.variants || !selectedCard.variants[cardVariant]) && (
                    <p className="text-[10px] text-slate-500 mt-1">Diese Variante ist bei TCGdex für die Karte nicht hinterlegt — der Preis ist dann nur eine Schätzung. Du kannst unten deinen eigenen Preis eintragen.</p>
                  )}
                </div>
                <div className="bg-slate-950 border border-cyan-500/30 p-3 rounded-lg text-center shadow-inner">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Geschätzter Richtwert</p>
                  <p className="text-xl font-black text-emerald-400">~{calculatePrice(selectedCard, cardCondition, cardLanguage, cardVariant)} €</p>
                  <p className="text-[10px] text-slate-500 mt-1">Hochgerechnet aus dem Cardmarket-Trendpreis ({VARIANTS.find(v => v.key === cardVariant)?.holo ? 'Holo' : 'Normal'}, Near Mint) × Zustand/Sprache. Kein Live-Preis von Cardmarket selbst.</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400">{modalType === 'edit' ? 'Preis in €' : 'Eigenen Preis eintragen (optional)'}</label>
                  {modalType === 'edit' && !selectedCard?.isCustom && (
                    <p className="text-[10px] text-slate-500">Wird bei neuem Zustand/Sprache/Variante automatisch neu berechnet — außer du trägst hier selbst einen anderen Preis ein.</p>
                  )}
                  <input type="number" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-400">Anzahl</label>
                    <input type="number" min="1" step="1" value={cardQuantity} onChange={e => setCardQuantity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Einkaufspreis pro Stück €</label>
                    <input type="number" min="0" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="optional" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Eigenes Foto der Karte (optional, z.B. wenn kein Bild vorhanden ist)</label>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs text-slate-400 mt-1 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-cyan-500/20 file:text-cyan-400 file:text-xs file:font-bold hover:file:bg-cyan-500/30" />
                  {customImage && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={customImage} alt="Eigenes Foto" className="w-12 h-16 object-cover rounded border border-slate-700" />
                      <button onClick={() => setCustomImage('')} className="text-xs text-rose-400 hover:underline">Entfernen</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => { setModalType(null); setMoveFromWatchlistId(null); setEditOriginalPrice(''); setCustomPrice(''); setCustomImage(''); }} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold text-sm transition-colors">Zurück</button>
              {modalType === 'edit' && <button onClick={saveEdit} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg shadow-cyan-500/20">Änderungen speichern</button>}
              {modalType === 'collection' && <button onClick={addToCollection} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg shadow-cyan-500/20">Speichern</button>}
            </div>
          </div>
        </div>
      )}
      {customCardOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl max-w-sm w-full p-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <h3 className="font-bold text-lg text-slate-100 mb-1">Eigene Karte anlegen</h3>
            <p className="text-[10px] text-slate-500 mb-3">Für Karten, die die Kartendatenbank nicht kennt. Einen Cardmarket-Preis gibt es dafür nicht — trag deinen Preis selbst ein.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">Name *</label>
                <input type="text" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="z.B. Dedenne GX" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-slate-400">Nummer</label>
                  <input type="text" value={customNumber} onChange={e => setCustomNumber(e.target.value)} placeholder="z.B. 195a" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-400">Set</label>
                  <input type="text" value={customSetName} onChange={e => setCustomSetName(e.target.value)} placeholder="optional" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Sprache der Karte</label>
                <select value={cardLanguage} onChange={e => setCardLanguage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                  {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Zustand (Condition)</label>
                <select value={cardCondition} onChange={e => setCardCondition(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                  {CONDITIONS.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Variante</label>
                <select value={cardVariant} onChange={e => setCardVariant(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                  {VARIANTS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">Dein Preis in € (optional)</label>
                <input type="number" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">Anzahl</label>
                  <input type="number" min="1" step="1" value={cardQuantity} onChange={e => setCardQuantity(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Einkaufspreis pro Stück €</label>
                  <input type="number" min="0" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="optional" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400">Foto der Karte (optional)</label>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs text-slate-400 mt-1 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-cyan-500/20 file:text-cyan-400 file:text-xs file:font-bold hover:file:bg-cyan-500/30" />
                {customImage && (
                  <div className="mt-2 flex items-center gap-2">
                    <img src={customImage} alt="Eigenes Foto" className="w-12 h-16 object-cover rounded border border-slate-700" />
                    <button onClick={() => setCustomImage('')} className="text-xs text-rose-400 hover:underline">Entfernen</button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 pt-4">
              <button onClick={closeCustomCard} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold text-sm transition-colors">Abbrechen</button>
              <button onClick={saveCustomCard} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg shadow-cyan-500/20">Speichern</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
