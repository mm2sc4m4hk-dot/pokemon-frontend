import React, { useState, useEffect } from 'react';

// Verbindung zum Backend
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

// Sehr günstigste/teuerste Kombination, um Preisspannen (min/max) zu zeigen
const CHEAPEST_LANG = LANGUAGES.reduce((a, b) => (a.factor < b.factor ? a : b));
const PREMIUM_LANG = LANGUAGES.reduce((a, b) => (a.factor > b.factor ? a : b));

export default function App() {
  // --- AUTH ---
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('poketracker_auth') === 'true');
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem('poketracker_current_user') || '');
  const [authMode, setAuthMode] = useState('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState('profile');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSet, setSearchSet] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  // pro Suchergebnis gewählte Condition/Sprache, um Preis live zu berechnen
  const [searchSelections, setSearchSelections] = useState({});

  const [collection, setCollection] = useState(() => {
    const saved = localStorage.getItem('poketracker_collection');
    return saved ? JSON.parse(saved) : [];
  });
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('poketracker_watchlist');
    return saved ? JSON.parse(saved) : [];
  });

  const [selectedCard, setSelectedCard] = useState(null);
  const [modalType, setModalType] = useState(null);
  const [cardCondition, setCardCondition] = useState('Near Mint');
  const [cardLanguage, setCardLanguage] = useState('Deutsch 🇩🇪');
  const [customPrice, setCustomPrice] = useState('');

  const [filterLang, setFilterLang] = useState('Alle');
  const [filterSet, setFilterSet] = useState('Alle');
  const [sortBy, setSortBy] = useState('name-asc');

  useEffect(() => {
    if (isAuthenticated) {
      localStorage.setItem('poketracker_collection', JSON.stringify(collection));
      localStorage.setItem('poketracker_watchlist', JSON.stringify(watchlist));
    }
  }, [collection, watchlist, isAuthenticated]);

  // --- AUTH LOGIK ---
  // Hinweis: Ohne eigenes Backend-Auth-System werden Zugangsdaten nur lokal
  // im Browser (localStorage) gespeichert. Für echten Mehrgeräte-Zugriff
  // bräuchte man später eine echte Nutzer-Datenbank im server.js.
  const getStoredUsers = () => {
    const raw = localStorage.getItem('poketracker_users');
    return raw ? JSON.parse(raw) : {};
  };

  const handleLogin = (e) => {
    e.preventDefault();
    setAuthError('');
    const users = getStoredUsers();
    const uname = authUsername.trim();
    if (!uname || !authPassword) {
      setAuthError('Bitte Benutzername und Passwort eingeben.');
      return;
    }
    if (!users[uname]) {
      setAuthError('Diesen Benutzer gibt es noch nicht. Bitte zuerst registrieren.');
      return;
    }
    if (users[uname] !== authPassword) {
      setAuthError('Falsches Passwort.');
      return;
    }
    setIsAuthenticated(true);
    setCurrentUser(uname);
    localStorage.setItem('poketracker_auth', 'true');
    localStorage.setItem('poketracker_current_user', uname);
    setActiveTab('profile');
  };

  const handleRegister = (e) => {
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
    const users = getStoredUsers();
    if (users[uname]) {
      setAuthError('Dieser Benutzername ist bereits vergeben.');
      return;
    }
    users[uname] = authPassword;
    localStorage.setItem('poketracker_users', JSON.stringify(users));
    setIsAuthenticated(true);
    setCurrentUser(uname);
    localStorage.setItem('poketracker_auth', 'true');
    localStorage.setItem('poketracker_current_user', uname);
    setActiveTab('profile');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser('');
    localStorage.removeItem('poketracker_auth');
    localStorage.removeItem('poketracker_current_user');
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    setAuthError('');
    setAuthPassword('');
    setAuthPasswordConfirm('');
  };

  // --- SICHERE PREIS-LOGIK ---
  const calculatePrice = (card, conditionName, langName) => {
    if (!card) return "0.00";
    const basePrice = card.cardmarket?.prices?.trendPrice || card.cardmarket?.prices?.averageSellPrice || 0;
    const condFactor = CONDITIONS.find(c => c.name === conditionName)?.factor || 1.0;
    const langFactor = LANGUAGES.find(l => l.name === langName)?.factor || 1.0;
    return (basePrice * condFactor * langFactor).toFixed(2);
  };

  const getTrendIcon = (card) => {
    if (!card) return null;
    const current = card.cardmarket?.prices?.trendPrice || 0;
    const avg30 = card.cardmarket?.prices?.avg30 || current;
    const threshold = Math.max(0.05, avg30 * 0.03); // 3% Schwelle statt starrer 5 Cent
    if (current > avg30 + threshold) return <span className="text-emerald-400 font-bold" title="Preis steigt">▲</span>;
    if (current < avg30 - threshold) return <span className="text-rose-400 font-bold" title="Preis sinkt">▼</span>;
    return <span className="text-slate-400 font-bold" title="Preis stabil">=</span>;
  };

  // Echte, von Cardmarket gelieferte Kennzahlen (1/7/30 Tage) statt Fantasiewerten
  const getPriceHistoryBars = (card) => {
    const prices = card?.cardmarket?.prices || {};
    const points = [
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

      // Timeout selbst setzen: Render-Gratisserver können nach Inaktivität
      // bis zu ~50s zum Aufwachen brauchen, daher hier grosszügig 45s statt
      // endlos zu warten oder sofort abzubrechen.
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
        setSearchError('Keine Karten mit diesem Namen (und Set) gefunden.');
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
    searchSelections[cardId] || { condition: 'Near Mint', language: 'Deutsch 🇩🇪' };

  const updateSearchSelection = (cardId, patch) => {
    setSearchSelections(prev => ({
      ...prev,
      [cardId]: { ...getSearchSelection(cardId), ...patch }
    }));
  };

  const addToCollection = () => {
    const calculatedVal = calculatePrice(selectedCard, cardCondition, cardLanguage);
    const newItem = {
      ...selectedCard,
      userCondition: cardCondition,
      userLanguage: cardLanguage,
      userPrice: customPrice ? parseFloat(customPrice).toFixed(2) : calculatedVal,
      instanceId: Date.now()
    };
    setCollection(prev => [...prev, newItem]);
    setModalType(null);
    setCustomPrice('');
  };

  // Nimmt die Karte direkt als Parameter entgegen, statt sich auf den
  // (asynchronen) selectedCard-State zu verlassen — vermeidet, dass beim
  // schnellen Klicken die falsche Karte zur Watchlist hinzugefügt wird.
  const addToWatchlistCard = (card) => {
    setWatchlist(prev => (prev.some(item => item.id === card.id) ? prev : [...prev, card]));
  };

  const stats = (() => {
    if (collection.length === 0) return { min: '0.00', median: '0.00', max: '0.00' };
    let total = 0, totalMin = 0, totalMax = 0;
    collection.forEach(item => {
      const price = parseFloat(item.userPrice) || 0;
      total += price;
      totalMin += price * 0.85;
      totalMax += price * 1.25;
    });
    return { min: totalMin.toFixed(2), median: total.toFixed(2), max: totalMax.toFixed(2) };
  })();

  const filteredCollection = (() => {
    let list = [...collection];
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
      return 0;
    });
    return list;
  })();

  const availableSets = ['Alle', ...new Set(collection.map(item => item.set?.name).filter(Boolean))];

  // --- LOGIN / SIGNUP SCREEN ---
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

            <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-lg py-3 rounded-xl transition-all shadow-lg shadow-cyan-500/20 mt-4">
              {isRegister ? 'Account erstellen' : 'Anmelden'}
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
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-widest">Minimalwert</p>
                  <p className="text-base sm:text-lg font-bold text-slate-300 mt-1">{stats.min} €</p>
                </div>
                <div className="bg-slate-950 border border-cyan-500/50 p-4 rounded-xl shadow-lg shadow-cyan-500/20 scale-105 z-10 flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-cyan-400 font-black uppercase tracking-widest">Medianwert</p>
                  <p className="text-xl sm:text-2xl font-black text-cyan-300 mt-1">{stats.median} €</p>
                </div>
                <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col justify-center">
                  <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-widest">Maximalwert</p>
                  <p className="text-base sm:text-lg font-bold text-emerald-400 mt-1">{stats.max} €</p>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-800 flex justify-between text-sm">
                <span className="text-slate-400">Anzahl Karten:</span>
                <span className="font-bold text-cyan-400">{collection.length} Stück</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-slate-400">Karten auf der Watchlist:</span>
                <span className="font-bold text-cyan-400">{watchlist.length} Stück</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'collection' && (
          <div className="space-y-4 fade-in">
            <div className="bg-slate-900 border border-slate-800 p-3 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-2 shadow-md">
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
              </select>
            </div>
            {filteredCollection.length === 0 ? (
              <div className="text-center py-20 text-slate-500">Keine Karten gefunden.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filteredCollection.map((item) => (
                  <div key={item.instanceId} className="bg-slate-900 border border-slate-800 rounded-xl p-3 relative group shadow-lg">
                    <button onClick={() => setCollection(collection.filter(i => i.instanceId !== item.instanceId))} className="absolute top-2 right-2 bg-slate-950/80 text-rose-400 w-6 h-6 rounded-full text-xs font-bold z-10 border border-rose-500/30 hover:bg-rose-500 hover:text-white transition">✕</button>
                    <img onClick={() => { setSelectedCard(item); setModalType('detail'); }} src={item.images?.small || ''} alt={item.name} className="w-full rounded-lg mb-2 cursor-pointer hover:scale-105 transition-transform" />
                    <h3 className="font-bold text-sm text-slate-200 truncate">{item.name}</h3>
                    <p className="text-xs text-slate-400 truncate">{item.set?.name || 'Unbekanntes Set'} • {item.userLanguage.split(' ')[0]}</p>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-cyan-400 font-bold">{item.userPrice} €</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] bg-slate-800 px-1 rounded text-slate-300">{item.userCondition}</span>
                        {getTrendIcon(item)}
                      </div>
                    </div>
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
                {watchlist.map((card) => {
                  const minPrice = calculatePrice(card, 'Poor', CHEAPEST_LANG.name);
                  const maxPrice = calculatePrice(card, 'Mint', PREMIUM_LANG.name);
                  return (
                    <div key={card.id} className="bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-3 flex gap-4 items-center shadow-lg transition-colors">
                      <img onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small || ''} alt={card.name} className="w-16 rounded-md cursor-pointer hover:opacity-80" />
                      <div className="flex-1">
                        <h4 className="font-bold text-slate-200">{card.name}</h4>
                        <p className="text-xs text-slate-400">{card.set?.name || 'Unbekannt'}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-cyan-400">Min {minPrice}€ – Max {maxPrice}€</p>
                          {getTrendIcon(card)}
                        </div>
                      </div>
                      <button onClick={() => setWatchlist(watchlist.filter(i => i.id !== card.id))} className="text-slate-500 hover:text-rose-400 px-2 py-2 text-xl font-bold">✕</button>
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
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Kartennamen suchen..." className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none" />
              <input type="text" value={searchSet} onChange={e => setSearchSet(e.target.value)} placeholder="Set (optional, z.B. Base Set)" className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none" />
              <button type="submit" className="bg-cyan-500 text-slate-950 font-bold px-6 py-3 rounded-xl hover:bg-cyan-400 transition-colors">Suche</button>
            </form>

            {loading && <div className="text-center text-cyan-400 py-10">Lade Karten...</div>}
            {searchError && <div className="text-center text-rose-400 py-10">{searchError}</div>}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.isArray(searchResults) && searchResults.map((card) => {
                const sel = getSearchSelection(card.id);
                const livePrice = calculatePrice(card, sel.condition, sel.language);
                return (
                  <div key={card.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col relative group shadow-lg">
                    <img onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small || ''} alt={card.name} className="w-full rounded-lg mb-2 cursor-pointer hover:scale-105 transition-transform" />
                    <h3 className="font-bold text-sm text-slate-200 truncate">{card.name}</h3>
                    <p className="text-xs text-slate-400 truncate">{card.set?.name || 'Unbekannt'}</p>

                    <div className="flex gap-1 mt-2">
                      <select value={sel.condition} onChange={e => updateSearchSelection(card.id, { condition: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                        {CONDITIONS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <select value={sel.language} onChange={e => updateSearchSelection(card.id, { language: e.target.value })} className="flex-1 bg-slate-950 border border-slate-800 text-[10px] rounded-lg p-1 text-slate-300">
                        {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name.split(' ')[0]}</option>)}
                      </select>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-1">
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
                          setModalType('collection');
                        }}
                        className="flex-1 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500 hover:text-slate-900 text-xs font-bold py-2 rounded-lg border border-cyan-500/30 transition-colors"
                      >
                        ➕ Coll
                      </button>
                      <button onClick={() => addToWatchlistCard(card)} className="bg-slate-800 text-slate-300 hover:text-cyan-400 text-xs px-3 rounded-lg border border-slate-700 transition-colors">★</button>
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
              <img src={selectedCard.images?.small || ''} alt={selectedCard.name} className="w-24 rounded-lg shadow-lg" />
              <div>
                <h3 className="font-bold text-lg text-slate-100">{selectedCard.name}</h3>
                <p className="text-sm text-slate-400">{selectedCard.set?.name || 'Unbekannt'}</p>
                <div className="mt-2 text-xs text-slate-300">Trend (Basis): <span className="text-cyan-400 font-bold">{selectedCard.cardmarket?.prices?.trendPrice || 0} €</span></div>
                {selectedCard.cardmarket?.url && (
                  <a href={selectedCard.cardmarket.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-400 hover:underline mt-1 inline-block">Original-Angebote auf Cardmarket ansehen ↗</a>
                )}
              </div>
            </div>

            {modalType === 'detail' && (
              <div className="space-y-4 mb-4 border-t border-slate-800 pt-4">
                <h4 className="text-sm font-bold text-cyan-400 flex justify-between"><span>Preisverlauf</span><span>{getTrendIcon(selectedCard)}</span></h4>
                {(() => {
                  const bars = getPriceHistoryBars(selectedCard);
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

            {modalType === 'collection' && (
              <div className="space-y-3 mb-4 border-t border-slate-800 pt-3">
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
                <div className="bg-slate-950 border border-cyan-500/30 p-3 rounded-lg text-center shadow-inner">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Geschätzter Richtwert</p>
                  <p className="text-xl font-black text-emerald-400">~{calculatePrice(selectedCard, cardCondition, cardLanguage)} €</p>
                  <p className="text-[10px] text-slate-500 mt-1">Hochgerechnet aus dem Cardmarket-Trendpreis (Near Mint) × Zustand/Sprache. Kein Live-Preis von Cardmarket selbst.</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Eigenen Preis eintragen (optional)</label>
                  <input type="number" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none" />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => { setModalType(null); setCustomPrice(''); }} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl font-bold text-sm transition-colors">Zurück</button>
              {modalType === 'collection' && <button onClick={addToCollection} className="flex-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 py-3 rounded-xl font-black text-sm transition-colors shadow-lg shadow-cyan-500/20">Speichern</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
