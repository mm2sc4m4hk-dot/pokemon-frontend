// Zentrale Stelle für Name und rechtlichen Hinweis. Name später ändern = nur BRAND_NAME hier anpassen.
import React from 'react';
import { navigate } from './router';

export const BRAND_NAME = 'TCG Vault';
export const DISCLAIMER = 'Inoffizielles Fan-Projekt. Nicht mit The Pokémon Company, Nintendo oder Creatures Inc. verbunden.';

export function Disclaimer({ className = '' }) {
  return (
    <p className={`text-[10px] leading-snug text-slate-500 text-center ${className}`}>
      {DISCLAIMER}
    </p>
  );
}

// Links zu den Rechtsseiten (Impressum/Datenschutz).
//
// Bewusst echte <a href> statt <button>: so funktionieren auch "In neuem Tab
// öffnen", Rechtsklick → Link kopieren und Screenreader. Der Klick wird
// abgefangen und per pushState geroutet, damit die App nicht neu lädt
// (Strg/Cmd/Mittelklick bleiben dem Browser überlassen).
function LegalLink({ to, children, className }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function LegalLinks({ className = '', align = 'center' }) {
  const link = 'text-[11px] text-slate-400 hover:text-cyan-400 underline underline-offset-2 transition-colors';
  const justify = align === 'start' ? 'justify-start' : 'justify-center';
  return (
    <nav className={`flex items-center ${justify} gap-3 flex-wrap ${className}`}>
      <LegalLink to="/impressum" className={link}>Impressum</LegalLink>
      <span className="text-slate-700 text-[11px]">·</span>
      <LegalLink to="/datenschutz" className={link}>Datenschutz</LegalLink>
    </nav>
  );
}

// Gemeinsamer Fußbereich der App: Rechtslinks + Fan-Hinweis.
export function Footer({ className = '' }) {
  return (
    <footer className={`space-y-2 pt-4 pb-2 border-t border-slate-800 ${className}`}>
      <LegalLinks />
      <Disclaimer />
    </footer>
  );
}

