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

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('poketracker_auth') === 'true');
  const [authMode, setAuthMode] = useState('login'); 
  
  const [activeTab, setActiveTab] = useState('profile');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

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

  const handleLogin = (e) => {
    e.preventDefault();
    setIsAuthenticated(true);
    localStorage.setItem('poketracker_auth', 'true');
    setActiveTab('profile'); 
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('poketracker_auth');
  };

  // --- SICHERE PREIS-LOGIK ---
  const calculatePrice = (card, conditionName, langName) => {
    if (!card) return "0.00";
    // Sicheres Auslesen, falls cardmarket oder prices fehlen
    const basePrice = card.cardmarket?.prices?.trendPrice || 0;
    const condFactor = CONDITIONS.find(c => c.name === conditionName)?.factor || 1.0;
    const langFactor = LANGUAGES.find(l => l.name === langName)?.factor || 1.0;
    return (basePrice * condFactor * langFactor).toFixed(2);
  };

  const getTrendIcon = (card) => {
    if (!card) return null;
    const current = card.cardmarket?.prices?.trendPrice || 0;
    const avg30 = card.cardmarket?.prices?.avg30 || current;
    if (current > avg30 + 0.05) return <span className="text-emerald-400 font-bold" title="Preis steigt">▲</span>;
    if (current < avg30 - 0.05) return <span className="text-rose-400 font-bold" title="Preis sinkt">▼</span>;
    return <span className="text-slate-400 font-bold" title="Preis stabil">=</span>;
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSearchError('');
    try {
      const res = await fetch(`${API_URL}/api/cards?name=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) throw new Error("API antwortet nicht");
      const data = await res.json();
      
      // Sicherheits-Check, falls die API Müll zurückgibt
      if (!Array.isArray(data)) {
         setSearchResults([]);
         setSearchError("Keine Karten gefunden oder Fehler bei der Abfrage.");
      } else {
         setSearchResults(data);
      }
    } catch (err) {
      setSearchError('Verbindungsfehler zum Backend. Läuft Render noch?');
    } finally {
      setLoading(false);
    }
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
    setCollection([...collection, newItem]);
    setModalType(null);
  };

  const addToWatchlist = () => {
    if (!watchlist.some(item => item.id === selectedCard.id)) {
      setWatchlist([...watchlist, selectedCard]);
    }
    setModalType(null);
  };

  const stats = (() => {
    if (collection.length === 0) return { min: '0.00', median: '0.00', max: '0.00' };
    let totalMedian = 0, totalMin = 0, totalMax = 0;
    collection.forEach(item => {
      const price = parseFloat(item.userPrice) || 0;
      totalMedian += price;
      totalMin += price * 0.85;
      totalMax += price * 1.25;
    });
    return { min: totalMin.toFixed(2), median: totalMedian.toFixed(2), max: totalMax.toFixed(2) };
  })();

  const filteredCollection = (() => {
    let list = [...collection];
    if (filterLang !== 'Alle') list = list.filter(i => i.userLanguage === filterLang);
    if (filterSet !== 'Alle') list = list.filter(i => i.set?.name === filterSet);
    
    list.sort((a, b) => {
      // Sicheres Sortieren (Absturzschutz)
      const nameA = a.name || ''; const nameB = b.name || '';
      const setA = a.set?.name || ''; const setB = b.set?.name || '';
      const langA = a.userLanguage || ''; const langB = b.userLanguage || '';
      
      if (sortBy === 'name-asc') return nameA.localeCompare(nameB);
      if (sortBy === 'name-desc') return nameB.localeCompare(nameA);
      if (sortBy === 'price-desc') return (parseFloat(b.userPrice) || 0) - (parseFloat(a.userPrice) || 0);
      if (sortBy === 'price-asc') return (parseFloat(a.userPrice) || 0) - (parseFloat(b.userPrice) || 0);
      if (sortBy === 'set-asc') return setA.localeCompare(setB);
      if (sortBy === 'lang-asc') return langA.localeCompare(langB);
      return 0;
    });
    return list;
  })();

  const availableSets = ['Alle', ...new Set(collection.map(item => item.set?.name).filter(Boolean))];

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans selection:bg-cyan-500 text-slate-100">
        <div className="bg-slate-900 border border-cyan-500/30 p-8 rounded-2xl w-full max-w-md shadow-2xl shadow-cyan-900/20">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-teal-400 tracking-wider mb-2">PokéTracker</h1>
            <p className="text-slate-400 text-sm">Verwalte deine Sammlung & Werte</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            {authMode === 'register' && (
              <div>
                <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Benutzername</label>
                <input type="text" required className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all" placeholder="Dein Name" />
              </div>
            )}
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">E-Mail Adresse</label>
              <input type="email" required className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all" placeholder="name@beispiel.de" />
            </div>
            <div>
              <label className="text-xs text-cyan-400 font-bold ml-1 mb-1 block">Passwort</label>
              <input type="password" required className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 outline-none text-white transition-all" placeholder="••••••••" />
            </div>
            <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-lg py-3 rounded-xl transition-all shadow-lg shadow-cyan-500/20 mt-4">
              {authMode === 'login' ? 'Anmelden' : 'Account erstellen'}
            </button>
          </form>
          <div className="mt-6 text-center text-sm text-slate-400">
            {authMode === 'login' ? (
              <p>Sign up: Noch keinen Account? <button onClick={() => setAuthMode('register')} className="text-cyan-400 font-bold hover:underline">Hier registrieren</button></p>
            ) : (
              <p>Bereits einen Account? <button onClick={() => setAuthMode('login')} className="text-cyan-400 font-bold hover:underline">Hier anmelden</button></p>
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
        <button onClick={handleLogout} className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-rose-400 transition-colors">Abmelden</button>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {activeTab === 'profile' && (
          <div className="space-y-6 fade-in">
            <div className="bg-slate-900 border border-cyan-500/30 p-6 rounded-2xl shadow-xl shadow-cyan-900/10">
              <h2 className="text-xl font-black text-white mb-6">Dein Collection Wert</h2>
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
                <option value="name-asc">A-Z (Alphabetisch)</option>
                <option value="name-desc">Z-A (Alphabetisch)</option>
                <option value="price-desc">Preis (Highest first)</option>
                <option value="price-asc">Preis (Lowest first)</option>
                <option value="set-asc">Set (Alphabetisch)</option>
                <option value="lang-asc">Ursprungsland</option>
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
                  const minPrice = calculatePrice(card, 'Poor', 'Chinesisch 🇨🇳'); 
                  const maxPrice = calculatePrice(card, 'Mint', 'Englisch 🇬🇧');  
                  return (
                    <div key={card.id} className="bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-xl p-3 flex gap-4 items-center shadow-lg transition-colors">
                      <img onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small || ''} alt={card.name} className="w-16 rounded-md cursor-pointer hover:opacity-80" />
                      <div className="flex-1">
                        <h4 className="font-bold text-slate-200">{card.name}</h4>
                        <p className="text-xs text-slate-400">{card.set?.name || 'Unbekannt'}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-cyan-400">Spanne: ~{minPrice}€ bis ~{maxPrice}€</p>
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
            <form onSubmit={handleSearch} className="flex gap-2">
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Kartennamen suchen..." className="flex-1 bg-slate-900 border border-slate-700 focus:border-cyan-400 text-white rounded-xl px-4 py-3 outline-none" />
              <button type="submit" className="bg-cyan-500 text-slate-950 font-bold px-6 py-3 rounded-xl hover:bg-cyan-400 transition-colors">Suche</button>
            </form>
            
            {loading && <div className="text-center text-cyan-400 py-10">Lade Karten...</div>}
            {searchError && <div className="text-center text-rose-400 py-10">{searchError}</div>}
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array.isArray(searchResults) && searchResults.map((card) => {
                const minPrice = calculatePrice(card, 'Poor', 'Koreanisch 🇰🇷');
                const maxPrice = calculatePrice(card, 'Mint', 'Englisch 🇬🇧');
                return (
                  <div key={card.id} className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col relative group shadow-lg">
                    <img onClick={() => { setSelectedCard(card); setModalType('detail'); }} src={card.images?.small || ''} alt={card.name} className="w-full rounded-lg mb-2 cursor-pointer hover:scale-105 transition-transform" />
                    <h3 className="font-bold text-sm text-slate-200 truncate">{card.name}</h3>
                    <p className="text-xs text-slate-400 truncate">{card.set?.name || 'Unbekannt'}</p>
                    <div className="mt-1">
                      <p className="text-cyan-400 font-bold text-xs">{minPrice} € – {maxPrice} €</p>
                    </div>
                    <div className="flex gap-1 mt-3">
                      <button onClick={() => { setSelectedCard(card); setModalType('collection'); }} className="flex-1 bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500 hover:text-slate-900 text-xs font-bold py-2 rounded-lg border border-cyan-500/30 transition-colors">➕ Coll</button>
                      <button onClick={() => { setSelectedCard(card); setModalType('watchlist'); addToWatchlist(); }} className="bg-slate-800 text-slate-300 hover:text-cyan-400 text-xs px-3 rounded-lg border border-slate-700 transition-colors">★</button>
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
              </div>
            </div>

            {modalType === 'detail' && (
              <div className="space-y-4 mb-4 border-t border-slate-800 pt-4">
                <h4 className="text-sm font-bold text-cyan-400 flex justify-between"><span>Preisverlauf</span><span>{getTrendIcon(selectedCard)}</span></h4>
                <div className="flex items-end gap-2 h-24 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="flex-1 flex flex-col items-center justify-end gap-1"><div className="w-full bg-slate-700 rounded-t-sm" style={{height: '60%'}}></div><span className="text-[10px] text-slate-500">30 T</span></div>
                  <div className="flex-1 flex flex-col items-center justify-end gap-1"><div className="w-full bg-cyan-800 rounded-t-sm" style={{height: '75%'}}></div><span className="text-[10px] text-slate-500">7 T</span></div>
                  <div className="flex-1 flex flex-col items-center justify-end gap-1"><div className="w-full bg-cyan-400 rounded-t-sm relative" style={{height: '90%'}}></div><span className="text-[10px] text-cyan-400 font-bold">Heute</span></div>
                </div>
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
                  <label className="text-xs text-slate-400">Land der Sprache</label>
                  <select value={cardLanguage} onChange={e => setCardLanguage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg p-2 text-sm mt-1 focus:border-cyan-500 outline-none">
                    {LANGUAGES.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
                <div className="bg-slate-950 border border-cyan-500/30 p-3 rounded-lg text-center shadow-inner">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Berechneter Marktwert</p>
                  <p className="text-xl font-black text-emerald-400">{calculatePrice(selectedCard, cardCondition, cardLanguage)} €</p>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Eigener Kaufpreis eintragen (Optional)</label>
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