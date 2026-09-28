import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [cards, setCards] = useState([]);
  const [collection, setCollection] = useState(() => {
    const saved = localStorage.getItem('poke_collection');
    return saved ? JSON.parse(saved) : [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('search'); // 'search' | 'collection'
  const [selectedCard, setSelectedCard] = useState(null); // Für Modal
  const [sortBy, setSortBy] = useState('default'); // 'default' | 'price-asc' | 'price-desc'
  const [rarityFilter, setRarityFilter] = useState('all');

  const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';

  useEffect(() => {
    localStorage.setItem('poke_collection', JSON.stringify(collection));
  }, [collection]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl}/api/cards?name=${encodeURIComponent(searchTerm)}`);
      if (!res.ok) throw new Error('Netzwerkfehler');
      const data = await res.json();
      setCards(data);
    } catch (err) {
      setError('Karten konnten nicht geladen werden. Bitte versuche es erneut.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCollection = (card) => {
    if (collection.some((item) => item.id === card.id)) {
      setCollection(collection.filter((item) => item.id !== card.id));
    } else {
      setCollection([...collection, card]);
    }
  };

  const isCollected = (cardId) => collection.some((item) => item.id === cardId);

  const getPrice = (card) => {
    return card.cardmarket?.prices?.averageSellPrice || card.tcgplayer?.prices?.holofoil?.market || 0;
  };

  // Sortierung & Filterung verarbeiten
  const processCards = (cardList) => {
    let filtered = [...cardList];

    if (rarityFilter !== 'all') {
      filtered = filtered.filter((c) => c.rarity === rarityFilter);
    }

    if (sortBy === 'price-asc') {
      filtered.sort((a, b) => getPrice(a) - getPrice(b));
    } else if (sortBy === 'price-desc') {
      filtered.sort((a, b) => getPrice(b) - getPrice(a));
    }

    return filtered;
  };

  const currentCards = processCards(activeTab === 'search' ? cards : collection);
  const totalValue = collection.reduce((acc, card) => acc + getPrice(card), 0).toFixed(2);

  return (
    <div className="app-container">
      <header className="header">
        <div className="brand">
          <span className="brand-icon">⚡</span>
          <h1>Pokémon Karten Tracker</h1>
        </div>
        
        <nav className="nav-tabs">
          <button 
            className={activeTab === 'search' ? 'active' : ''} 
            onClick={() => setActiveTab('search')}
          >
            🔍 Suche ({cards.length})
          </button>
          <button 
            className={activeTab === 'collection' ? 'active' : ''} 
            onClick={() => setActiveTab('collection')}
          >
            ⭐ Meine Sammlung ({collection.length})
          </button>
        </nav>
      </header>

      {activeTab === 'collection' && (
        <div className="collection-summary">
          <span>Geschätzter Gesamtwert deiner Sammlung:</span>
          <strong>{totalValue} €</strong>
        </div>
      )}

      <div className="controls-section">
        {activeTab === 'search' && (
          <form onSubmit={handleSearch} className="search-form">
            <input
              type="text"
              placeholder="Pokémon suchen (z. B. Glumanda, Glurak, Rayquaza)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Sucht...' : 'Suchen'}
            </button>
          </form>
        )}

        <div className="filter-bar">
          <div className="filter-group">
            <label>Sortieren nach Preis:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="default">Standard</option>
              <option value="price-asc">Preis: Aufsteigend</option>
              <option value="price-desc">Preis: Absteigend</option>
            </select>
          </div>
        </div>
      </div>

      {error && <p className="error-message">{error}</p>}

      {currentCards.length === 0 && !loading && (
        <div className="empty-state">
          {activeTab === 'search' 
            ? 'Keine Karten gefunden. Gib oben einen Namen ein!' 
            : 'Deine Sammlung ist noch leer. Füge Karten aus der Suche hinzu!'}
        </div>
      )}

      <div className="cards-grid">
        {currentCards.map((card) => {
          const price = getPrice(card);
          const collected = isCollected(card.id);

          return (
            <div key={card.id} className="card-item">
              <div className="card-image-wrapper" onClick={() => setSelectedCard(card)}>
                <img src={card.images.small} alt={card.name} loading="lazy" />
                <div className="zoom-overlay">🔍 Vergrößern</div>
              </div>

              <div className="card-info">
                <h3>{card.name}</h3>
                <p className="set-name">{card.set.name}</p>
                
                <div className="card-details">
                  <span className="rarity">{card.rarity || 'Normal'}</span>
                  <span className="price">{price > 0 ? `${price.toFixed(2)} €` : 'k.A.'}</span>
                </div>

                <button 
                  className={`collect-btn ${collected ? 'remove' : 'add'}`}
                  onClick={() => toggleCollection(card)}
                >
                  {collected ? '✖ Aus Sammlung' : '✚ Zur Sammlung'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal für Karten-Vergrößerung & Details */}
      {selectedCard && (
        <div className="modal-overlay" onClick={() => setSelectedCard(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedCard(null)}>✕</button>
            <div className="modal-body">
              <img src={selectedCard.images.large} alt={selectedCard.name} />
              <div className="modal-info">
                <h2>{selectedCard.name}</h2>
                <p className="modal-set"><strong>Set:</strong> {selectedCard.set.name}</p>
                <p><strong>Seltenheit:</strong> {selectedCard.rarity || 'Unbekannt'}</p>
                <p><strong>Künstlerin/Künstler:</strong> {selectedCard.artist || 'k.A.'}</p>
                <p className="modal-price">
                  <strong>Durchschnittspreis:</strong> {getPrice(selectedCard).toFixed(2)} €
                </p>
                <button 
                  className={`collect-btn ${isCollected(selectedCard.id) ? 'remove' : 'add'}`}
                  onClick={() => toggleCollection(selectedCard)}
                >
                  {isCollected(selectedCard.id) ? 'Aus Sammlung entfernen' : 'Zur Sammlung hinzufügen'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;