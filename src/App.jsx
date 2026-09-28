import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  // Auth State
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('poke_user')) || null);
  const [authMode, setAuthMode] = useState('login'); // 'login' oder 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // App Navigation State
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'collection' | 'watchlist' | 'search'

  // Data States
  const [collection, setCollection] = useState(() => JSON.parse(localStorage.getItem('poke_collection')) || []);
  const [watchlist, setWatchlist] = useState(() => JSON.parse(localStorage.getItem('poke_watchlist')) || []);
  
  // Search & Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Collection Filters
  const [sortOption, setSortOption] = useState('name-asc');
  const [filterLanguage, setFilterLanguage] = useState('all');
  const [filterSet, setFilterSet] = useState('all');

  // Modal State
  const [selectedCard, setSelectedCard] = useState(null);
  const [addModalCard, setAddModalCard] = useState(null);
  const [cardCondition, setCardCondition] = useState('Near Mint');
  const [cardLanguage, setCardLanguage] = useState('Deutsch');

  const backendUrl = import.meta.env.VITE_API_URL || 'https://pokemon-backend-xxxx.onrender.com'; // Hier deine Render URL eintragen

  useEffect(() => {
    localStorage.setItem('poke_collection', JSON.stringify(collection));
  }, [collection]);

  useEffect(() => {
    localStorage.setItem('poke_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    if (user) localStorage.setItem('poke_user', JSON.stringify(user));
    else localStorage.removeItem('poke_user');
  }, [user]);

  // Auth Handler
  const handleAuth = (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setUser({ email });
  };

  const handleLogout = () => {
    setUser(null);
  };

  // Suche ausführen
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl}/api/cards?name=${encodeURIComponent(searchTerm)}`);
      if (!res.ok) throw new Error('Fehler beim Laden');
      const data = await res.json();
      setSearchResults(data);
    } catch (err) {
      setError('Karten konnten nicht geladen werden. Bitte überprüfe die Verbindung.');
    } finally {
      setLoading(false);
    }
  };

  // Hilfsfunktionen für Preise & Trends
  const getCardmarketPrice = (card) => {
    return card.cardmarket?.prices?.averageSellPrice || card.tcgplayer?.prices?.holofoil?.market || 2.50;
  };

  const getPriceTrend = (card) => {
    const trend = card.cardmarket?.prices?.trendPrice || getCardmarketPrice(card);
    const avg = getCardmarketPrice(card);
    if (trend > avg * 1.02) return { symbol: '▲', color: '#10b981', label: 'Steigend' };
    if (trend < avg * 0.98) return { symbol: '▼', color: '#ef4444', label: 'Fallend' };
    return { symbol: '=', color: '#00f2fe', label: 'Gleichbleibend' };
  };

  // Kartensammlung erweitern
  const confirmAddToCollection = () => {
    if (!addModalCard) return;
    const basePrice = getCardmarketPrice(addModalCard);
    
    // Bedingungsfaktor für Preise anpassen
    const conditionMultipliers = {
      'Mint': 1.2,
      'Near Mint': 1.0,
      'Excellent': 0.85,
      'Good': 0.7,
      'Light Played': 0.5,
      'Played': 0.35,
      'Poor': 0.2
    };

    const finalPrice = basePrice * (conditionMultipliers[cardCondition] || 1.0);

    const newItem = {
      ...addModalCard,
      userCondition: cardCondition,
      userLanguage: cardLanguage,
      customPrice: parseFloat(finalPrice.toFixed(2)),
      addedAt: new Date().toISOString()
    };

    setCollection([...collection, newItem]);
    setAddModalCard(null);
  };

  const addToWatchlist = (card) => {
    if (!watchlist.some(item => item.id === card.id)) {
      setWatchlist([...watchlist, card]);
    }
  };

  const removeFromCollection = (id) => {
    setCollection(collection.filter(item => item.id !== id));
  };

  const removeFromWatchlist = (id) => {
    setWatchlist(watchlist.filter(item => item.id !== id));
  };

  // Profil Wert-Berechnungen
  const calculateProfileStats = () => {
    if (collection.length === 0) return { min: '0.00', median: '0.00', max: '0.00' };

    const prices = collection.map(c => c.customPrice || getCardmarketPrice(c)).sort((a, b) => a - b);
    const min = prices[0].toFixed(2);
    const max = prices[prices.length - 1].toFixed(2);

    let median;
    const mid = Math.floor(prices.length / 2);
    if (prices.length % 2 === 0) {
      median = ((prices[mid - 1] + prices[mid]) / 2).toFixed(2);
    } else {
      median = prices[mid].toFixed(2);
    }

    return { min, median, max };
  };

  // Sammlung filtern & sortieren
  const getProcessedCollection = () => {
    let list = [...collection];

    if (filterLanguage !== 'all') {
      list = list.filter(c => c.userLanguage === filterLanguage);
    }
    if (filterSet !== 'all') {
      list = list.filter(c => c.set?.name === filterSet);
    }

    switch (sortOption) {
      case 'name-asc':
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        list.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'price-asc':
        list.sort((a, b) => (a.customPrice || 0) - (b.customPrice || 0));
        break;
      case 'price-desc':
        list.sort((a, b) => (b.customPrice || 0) - (a.customPrice || 0));
        break;
      default:
        break;
    }
    return list;
  };

  // Falls nicht eingeloggt -> Auth Screen (Login / Sign Up)
  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="brand-header">
            <span className="logo-icon">⚡</span>
            <h1>PokéTracker</h1>
          </div>
          <h2>{authMode === 'login' ? 'Anmelden' : 'Konto erstellen'}</h2>
          
          <form onSubmit={handleAuth} className="auth-form">
            <input 
              type="email" 
              placeholder="E-Mail-Adresse" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required 
            />
            <input 
              type="password" 
              placeholder="Passwort" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              required 
            />
            <button type="submit" className="primary-btn">
              {authMode === 'login' ? 'Einloggen' : 'Registrieren'}
            </button>
          </form>

          <p className="auth-switch">
            {authMode === 'login' ? 'Noch kein Konto?' : 'Bereits registriert?'}
            <button onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
              {authMode === 'login' ? 'Sign Up' : 'Anmelden'}
            </button>
          </p>
        </div>
      </div>
    );
  }

  const stats = calculateProfileStats();
  const processedCollection = getProcessedCollection();

  return (
    <div className="app-layout">
      {/* Top Bar */}
      <header className="top-header">
        <div className="brand">⚡ PokéTracker</div>
        <button className="logout-btn" onClick={handleLogout}>Abmelden</button>
      </header>

      {/* Main Content Body */}
      <main className="main-content">
        
        {/* TAB 1: PROFIL */}
        {activeTab === 'profile' && (
          <div className="tab-page profile-page">
            <h2>Mein Profil</h2>
            <p className="user-email">Angemeldet als: <span>{user.email}</span></p>

            <div className="stats-grid">
              <div className="stat-card min">
                <span className="stat-label">Minimalwert</span>
                <span className="stat-value">{stats.min} €</span>
              </div>
              <div className="stat-card median">
                <span className="stat-label">Medianwert</span>
                <span className="stat-value">{stats.median} €</span>
              </div>
              <div className="stat-card max">
                <span className="stat-label">Maximalwert</span>
                <span className="stat-value">{stats.max} €</span>
              </div>
            </div>

            <div className="summary-box">
              <h3>Sammlungs-Übersicht</h3>
              <p>Gesamtanzahl Karten: <strong>{collection.length}</strong></p>
              <p>Karten auf Watchlist: <strong>{watchlist.length}</strong></p>
            </div>
          </div>
        )}

        {/* TAB 2: COLLECTION */}
        {activeTab === 'collection' && (
          <div className="tab-page">
            <div className="page-header">
              <h2>Meine Collection ({collection.length})</h2>
            </div>

            {/* Filter & Sortierung Bar */}
            <div className="controls-bar">
              <select value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
                <option value="name-asc">Name (A–Z)</option>
                <option value="name-desc">Name (Z–A)</option>
                <option value="price-asc">Preis (aufsteigend)</option>
                <option value="price-desc">Preis (absteigend)</option>
              </select>

              <select value={filterLanguage} onChange={(e) => setFilterLanguage(e.target.value)}>
                <option value="all">Alle Sprachen</option>
                <option value="Deutsch">Deutsch</option>
                <option value="Englisch">Englisch</option>
                <option value="Japanisch">Japanisch</option>
              </select>
            </div>

            {processedCollection.length === 0 ? (
              <p className="empty-msg">Deine Sammlung ist noch leer. Suche im Suche-Tab nach Karten und füge sie hinzu!</p>
            ) : (
              <div className="cards-grid">
                {processedCollection.map((item, idx) => {
                  const trend = getPriceTrend(item);
                  return (
                    <div key={idx} className="card-card" onClick={() => setSelectedCard(item)}>
                      <img src={item.images?.small} alt={item.name} />
                      <div className="card-details">
                        <h4>{item.name}</h4>
                        <p className="set-title">{item.set?.name}</p>
                        <div className="tags">
                          <span className="badge lang">{item.userLanguage || 'Deutsch'}</span>
                          <span className="badge cond">{item.userCondition || 'NM'}</span>
                        </div>
                        <div className="price-row">
                          <span className="price">{item.customPrice || getCardmarketPrice(item)} €</span>
                          <span className="trend" style={{ color: trend.color }} title={trend.label}>
                            {trend.symbol}
                          </span>
                        </div>
                      </div>
                      <button 
                        className="delete-icon" 
                        onClick={(e) => { e.stopPropagation(); removeFromCollection(item.id); }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: WATCHLIST */}
        {activeTab === 'watchlist' && (
          <div className="tab-page">
            <h2>Watchlist ({watchlist.length})</h2>
            {watchlist.length === 0 ? (
              <p className="empty-msg">Deine Watchlist ist leer.</p>
            ) : (
              <div className="cards-grid">
                {watchlist.map((item) => {
                  const basePrice = getCardmarketPrice(item);
                  const trend = getPriceTrend(item);
                  return (
                    <div key={item.id} className="card-card" onClick={() => setSelectedCard(item)}>
                      <img src={item.images?.small} alt={item.name} />
                      <div className="card-details">
                        <h4>{item.name}</h4>
                        <p className="set-title">{item.set?.name}</p>
                        <div className="price-range">
                          <span>Min: {(basePrice * 0.4).toFixed(2)} €</span>
                          <span>Max: {(basePrice * 1.3).toFixed(2)} €</span>
                        </div>
                        <div className="price-row">
                          <span className="price">~{basePrice.toFixed(2)} €</span>
                          <span className="trend" style={{ color: trend.color }}>{trend.symbol}</span>
                        </div>
                      </div>
                      <button 
                        className="delete-icon" 
                        onClick={(e) => { e.stopPropagation(); removeFromWatchlist(item.id); }}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SUCHE */}
        {activeTab === 'search' && (
          <div className="tab-page">
            <h2>Karten suchen</h2>
            <form onSubmit={handleSearch} className="search-box">
              <input 
                type="text" 
                placeholder="Pokémon Name eingeben (z.B. Glumanda, Glurak)..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <button type="submit" disabled={loading}>{loading ? 'Sucht...' : 'Suchen'}</button>
            </form>

            {error && <p className="error-text">{error}</p>}

            <div className="cards-grid">
              {searchResults.map((card) => (
                <div key={card.id} className="card-card">
                  <img src={card.images?.small} alt={card.name} onClick={() => setSelectedCard(card)} />
                  <div className="card-details">
                    <h4>{card.name}</h4>
                    <p className="set-title">{card.set?.name}</p>
                    <p className="price-label">Cardmarket: <strong>{getCardmarketPrice(card).toFixed(2)} €</strong></p>
                    
                    <div className="action-buttons">
                      <button className="add-btn" onClick={() => setAddModalCard(card)}>
                        + Collection
                      </button>
                      <button className="watch-btn" onClick={() => addToWatchlist(card)}>
                        ★ Watchlist
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* Modal: Hinzufügen mit Details */}
      {addModalCard && (
        <div className="modal-overlay" onClick={() => setAddModalCard(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Karte hinzufügen: {addModalCard.name}</h3>
            
            <label>Zustand (Condition):</label>
            <select value={cardCondition} onChange={(e) => setCardCondition(e.target.value)}>
              <option value="Mint">Mint</option>
              <option value="Near Mint">Near Mint</option>
              <option value="Excellent">Excellent</option>
              <option value="Good">Good</option>
              <option value="Light Played">Light Played</option>
              <option value="Played">Played</option>
              <option value="Poor">Poor</option>
            </select>

            <label>Sprache der Karte:</label>
            <select value={cardLanguage} onChange={(e) => setCardLanguage(e.target.value)}>
              <option value="Deutsch">Deutsch</option>
              <option value="Englisch">Englisch</option>
              <option value="Japanisch">Japanisch</option>
              <option value="Französisch">Französisch</option>
            </select>

            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setAddModalCard(null)}>Abbrechen</button>
              <button className="confirm-btn" onClick={confirmAddToCollection}>Speichern</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Karten-Preisverlauf & Details */}
      {selectedCard && (
        <div className="modal-overlay" onClick={() => setSelectedCard(null)}>
          <div className="modal-box large" onClick={e => e.stopPropagation()}>
            <button className="close-x" onClick={() => setSelectedCard(null)}>✕</button>
            <div className="modal-flex">
              <img src={selectedCard.images?.large || selectedCard.images?.small} alt={selectedCard.name} />
              <div className="modal-info">
                <h2>{selectedCard.name}</h2>
                <p><strong>Set:</strong> {selectedCard.set?.name}</p>
                <p><strong>Seltenheit:</strong> {selectedCard.rarity || 'Normal'}</p>
                <p><strong>Künstler:</strong> {selectedCard.artist || 'Unbekannt'}</p>
                
                <div className="price-trend-box">
                  <h4>Cardmarket Preistrend (30 Tage)</h4>
                  <div className="trend-line">
                    <span>Ø Verkaufspreis:</span>
                    <strong>{getCardmarketPrice(selectedCard).toFixed(2)} €</strong>
                  </div>
                  <div className="trend-line">
                    <span>Trend:</span>
                    <strong style={{ color: getPriceTrend(selectedCard).color }}>
                      {getPriceTrend(selectedCard).symbol} {getPriceTrend(selectedCard).label}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* UNTERE TAB-NAVIGATION (Bottom Navigation Bar) */}
      <nav className="bottom-nav">
        <button 
          className={activeTab === 'profile' ? 'active' : ''} 
          onClick={() => setActiveTab('profile')}
        >
          <span className="icon">👤</span>
          <span className="label">Profil</span>
        </button>
        <button 
          className={activeTab === 'collection' ? 'active' : ''} 
          onClick={() => setActiveTab('collection')}
        >
          <span className="icon">🎴</span>
          <span className="label">Collection</span>
        </button>
        <button 
          className={activeTab === 'watchlist' ? 'active' : ''} 
          onClick={() => setActiveTab('watchlist')}
        >
          <span className="icon">★</span>
          <span className="label">Watchlist</span>
        </button>
        <button 
          className={activeTab === 'search' ? 'active' : ''} 
          onClick={() => setActiveTab('search')}
        >
          <span className="icon">🔍</span>
          <span className="label">Suche</span>
        </button>
      </nav>
    </div>
  );
}

export default App;