// Firebase-Konfiguration für PokéTracker.
//
// So bekommst du deine eigenen Werte (kostenlos):
// 1. https://console.firebase.google.com öffnen -> "Projekt hinzufügen"
// 2. Im Projekt: Symbol "</>" (Web-App hinzufügen) -> App registrieren
// 3. Firebase zeigt dir ein Objekt "firebaseConfig" -> genau das hier unten einfügen
// 4. Im Firebase-Menü links: "Authentication" -> "Sign-in method" ->
//    "E-Mail/Passwort" aktivieren (das nutzen wir intern, auch wenn die
//    App den Nutzer nur nach einem Benutzernamen fragt, siehe App.jsx)
// 5. Im Firebase-Menü links: "Firestore Database" -> "Datenbank erstellen"
//    (Produktivmodus reicht, die Regeln unten machen es sicher)
// 6. Die Datei firestore.rules mit den Regeln aus diesem Projekt in der
//    Firebase Console unter Firestore -> "Regeln" einfügen und veröffentlichen

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA9vq-yuzUcR9yxaDwxIjhzrCqlf4_-q-A",
  authDomain: "pokemon-signin.firebaseapp.com",
  projectId: "pokemon-signin",
  storageBucket: "pokemon-signin.firebasestorage.app",
  messagingSenderId: "459900531776",
  appId: "1:459900531776:web:fec45476b9f82a84559ba5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
