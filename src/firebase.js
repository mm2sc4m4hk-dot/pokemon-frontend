// Firebase-Konfiguration für TCG Vault.
// Anmeldung: E-Mail/Passwort und Google (siehe AuthScreens.jsx). Die Daten liegen unter users/{uid}/... in Firestore,
// die Regeln stehen in firestore.rules (Firebase Console -> Firestore -> Regeln).
//
// authDomain steht fest auf der Produktions-Domain (Google-Login per Redirect). Dafür nötig:
//  - vercel.json mit den Rewrites für /__/auth/ und /__/firebase/
//  - Google Cloud Console -> OAuth-Client: Weiterleitungs-URI https://pokemon-frontend-blond.vercel.app/__/auth/handler
//  - Firebase Console -> Authentication -> Authorized domains: pokemon-frontend-blond.vercel.app

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA9vq-yuzUcR9yxaDwxIjhzrCqlf4_-q-A",
  authDomain: "pokemon-frontend-blond.vercel.app",
  projectId: "pokemon-signin",
  storageBucket: "pokemon-signin.firebasestorage.app",
  messagingSenderId: "459900531776",
  appId: "1:459900531776:web:fec45476b9f82a84559ba5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'de'; // Mails (Passwort zurücksetzen, Bestätigung) auf Deutsch
// undefined-Felder werden ignoriert statt den ganzen Schreibvorgang abzulehnen
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
