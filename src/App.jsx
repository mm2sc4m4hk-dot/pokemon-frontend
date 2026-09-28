import React, { useState } from 'react';

const API_BASE_URL = 
  (import.meta.env && import.meta.env.VITE_API_URL) || 
  process.env.REACT_APP_API_URL || 
  'http://localhost:5000';

function App() {
  const [searchTerm, setSearchTerm] = useState('');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/cards?search=${encodeURIComponent(searchTerm)}`
      );
      
      if (!response.ok) {
        throw new Error('Fehler beim Abrufen der Daten.');
      }

      const result = await response.json();
      setCards(result.data || []);
    } catch (err) {
      console.error(err);
      setError('Karten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '900px', margin: '0 auto' }}>
      <h1>Pokémon Karten Tracker</h1>
      
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Karte suchen (z. B. Charizard, Pikachu)..."
          style={{ flex: 1, padding: '10px', fontSize: '16px' }}
        />
        <button type="submit" style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }}>
          Suchen
        </button>
      </form>

      {loading && <p>Lade Cardmarket-Preise und Kartendaten...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}

      {!loading && !error && (
        <div style={{ display: 'grid', gap: '20px' }}>
          {cards.length === 0 ? (
            <p>Keine Ergebnisse gefunden. Starte eine Suche!</p>
          ) : (
            cards.map((card) => (
              <div 
                key={card.id} 
                style={{ 
                  display: 'flex', 
                  gap: '20px', 
                  border: '1px solid #ccc', 
                  borderRadius: '8px', 
                  padding: '15px', 
                  backgroundColor: '#f9f9f9',
                  alignItems: 'center'
                }}
              >
                {card.image && (
                  <img src={card.image} alt={card.name} style={{ width: '100px', height: 'auto', borderRadius: '4px' }} />
                )}
                
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, color: '#333' }}>{card.name}</h3>
                    <a href={card.cardmarketUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85em', color: '#1976d2' }}>
                      Auf Cardmarket öffnen ↗
                    </a>
                  </div>
                  <p style={{ color: '#666', margin: '5px 0 15px 0' }}>Set: {card.expansion}</p>
                  
                  {/* Cardmarket Preistrends */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px' }}>
                    <div style={{ background: '#fff', padding: '6px', borderRadius: '4px', textAlign: 'center', border: '1px solid #ddd' }}>
                      <small style={{ color: '#666' }}>Günstigster</small>
                      <div style={{ fontWeight: 'bold', color: '#2e7d32' }}>{card.prices.lowPrice}</div>
                    </div>
                    <div style={{ background: '#fff', padding: '6px', borderRadius: '4px', textAlign: 'center', border: '1px solid #ddd' }}>
                      <small style={{ color: '#666' }}>Trendpreis</small>
                      <div style={{ fontWeight: 'bold', color: '#1976d2' }}>{card.prices.trendPrice}</div>
                    </div>
                    <div style={{ background: '#fff', padding: '6px', borderRadius: '4px', textAlign: 'center', border: '1px solid #ddd' }}>
                      <small style={{ color: '#666' }}>Ø 1 Tag</small>
                      <div style={{ color: '#333' }}>{card.prices.avg1}</div>
                    </div>
                    <div style={{ background: '#fff', padding: '6px', borderRadius: '4px', textAlign: 'center', border: '1px solid #ddd' }}>
                      <small style={{ color: '#666' }}>Ø 7 Tage</small>
                      <div style={{ color: '#333' }}>{card.prices.avg7}</div>
                    </div>
                    <div style={{ background: '#fff', padding: '6px', borderRadius: '4px', textAlign: 'center', border: '1px solid #ddd' }}>
                      <small style={{ color: '#666' }}>Ø 30 Tage</small>
                      <div style={{ color: '#333' }}>{card.prices.avg30}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default App;