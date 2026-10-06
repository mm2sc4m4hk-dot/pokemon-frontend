import React, { useState, useRef } from 'react';

export default function CardScanner({ onSelectCard }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const fileInputRef = useRef(null);

  // Bilddatei in Base64 umwandeln und schrumpfen (um Upload-Zeit zu sparen)
  const processImage = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1024;
          const MAX_HEIGHT = 1024;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setScanResult(null);

    try {
      const base64Image = await processImage(file);

      const response = await fetch(`${api || ''}/api/scan-genai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: base64Image }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Scannen der Karte.');
      }

      setScanResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="scanner-container" style={{ padding: '1rem', border: '1px dashed #ccc', borderRadius: '8px' }}>
      <h3>Pokémon Karte Scannen</h3>

      {/* Verstecktes File-Input (unterstützt sowohl Foto-Upload als auch direkte Smartphone-Kamera) */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem' }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          style={{ padding: '10px 16px', cursor: 'pointer' }}
        >
          {loading ? 'Analysiere Bild...' : '📷 Foto aufnehmen / hochladen'}
        </button>
      </div>

      {loading && <p>🤖 KI analysiert die Karte und sucht Datenbank-Treffer...</p>}

      {error && <p style={{ color: 'red' }}>⚠️ {error}</p>}

      {scanResult && (
        <div className="scan-results" style={{ marginTop: '1rem' }}>
          <h4>Erkannte Kartendaten:</h4>
          <p>
            <strong>Name:</strong> {scanResult.aiAnalysis?.name || 'Unbekannt'} |{' '}
            <strong>Nummer:</strong> {scanResult.aiAnalysis?.number || 'Keine'} |{' '}
            <strong>Sprache:</strong> {scanResult.aiAnalysis?.language || '-'}
          </p>

          <h4 style={{ marginTop: '1rem' }}>Gefundene Treffer ({scanResult.results?.length || 0}):</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
            {scanResult.results?.map((card) => (
              <div
                key={card.id}
                onClick={() => onSelectCard && onSelectCard(card)}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  padding: '8px',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                {card.images?.small && (
                  <img src={card.images.small} alt={card.name} style={{ width: '100%', borderRadius: '4px' }} />
                )}
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginTop: '4px' }}>{card.name}</div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                  {card.set?.name} ({card.number})
                </div>
                {card.cardmarket?.prices?.trendPrice > 0 && (
                  <div style={{ color: '#2e7d32', fontWeight: 'bold', marginTop: '4px' }}>
                    €{card.cardmarket.prices.trendPrice.toFixed(2)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}