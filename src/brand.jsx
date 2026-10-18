// Zentrale Stelle für Name und rechtlichen Hinweis. Name später ändern = nur BRAND_NAME hier anpassen.
import React from 'react';

export const BRAND_NAME = 'TCG Vault';
export const DISCLAIMER = 'Inoffizielles Fan-Projekt. Nicht mit The Pokémon Company, Nintendo oder Creatures Inc. verbunden.';

export function Disclaimer({ className = '' }) {
  return (
    <p className={`text-[10px] leading-snug text-slate-500 text-center ${className}`}>
      {DISCLAIMER}
    </p>
  );
}
