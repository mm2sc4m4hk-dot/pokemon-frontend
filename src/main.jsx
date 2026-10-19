import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ImpressumPage, DatenschutzPage } from './Legal.jsx'
import { currentPath, usePath } from './router'
import './index.css'

// Die Rechtsseiten (/impressum, /datenschutz) werden hier – außerhalb von App –
// gerendert. So sind sie auch ohne Anmeldung erreichbar und ein Login-Dialog
// oder eine Firebase-Session blockiert den Aufruf nicht.
function Root() {
  const [path] = usePath();
  if (path === '/impressum') return <ImpressumPage />;
  if (path === '/datenschutz') return <DatenschutzPage />;
  return <App />;
}

// Unbekannte Pfade (z. B. /irgendwas): auf die App umleiten, damit keine leere
// Seite stehen bleibt. Rechtsseiten bleiben erhalten.
const known = ['/impressum', '/datenschutz'];
if (!known.includes(currentPath()) && currentPath() !== '/') {
  window.history.replaceState({}, '', '/');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); }); }
