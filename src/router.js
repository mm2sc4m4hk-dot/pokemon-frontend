import React from 'react';

// Minimales Routing für die SPA (ohne zusätzliche Bibliothek).
//
// Die App hat bisher nur Tabs (activeTab). Für die Rechtsseiten (/impressum,
// /datenschutz) brauchen wir echte Pfade, damit die URLs auch ausdrucken und
// verlinkt werden können (Impressum und Datenschutzerklärung müssen jederzeit
// direkt aufrufbar sein – auch ohne Anmeldung).
//
// Vercel liefert für /impressum und /datenschutz die index.html aus
// (Rewrites in vercel.json), der Service Worker lädt Navigationen immer frisch
// vom Netz. Deshalb genügt hier Pathname + pushState.

// Pfad, der gerade angezeigt wird (ohne Query/Hash, ohne Slash am Ende).
export const currentPath = () => {
  const p = window.location.pathname || '/';
  return p.length > 1 ? p.replace(/\/+$/, '') : '/';
};

// Wechselt die Seite ohne vollständigen Reload.
export const navigate = (to) => {
  const target = to === '/' ? '/' : (to.startsWith('/') ? to : `/${to}`);
  if (currentPath() === target) return;
  window.history.pushState({}, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

// React-Hook: liefert den aktuellen Pfad und meldet sich bei Back/Forward.
export const usePath = () => {
  const [path, setPath] = React.useState(currentPath);
  React.useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return [path, navigate];
};
