const fs = require('fs');
let c = fs.readFileSync('c:\\Users\\steng\\OneDrive\\Desktop\\pokemon-Projekt\\pokemon-frontend\\src\\AuthScreens.jsx', 'utf8');
// Ersetze alles zwischen "if (REDIRECT_FALLBACK" und dem schließenden "}} else if"
const before = c;
c = c.replace(
  /if \(REDIRECT_FALLBACK\.includes\(err\.code\)\) \{\s*try \{ await signInWithRedirect\(auth, provider\); return; \} catch \(e2\) \{ setError\(authErrorMessage\(e2\.code\)\); \}\}/,
  'setError("Pop-up wurde blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.");'
);
if (c === before) {
  console.log('Keine Änderung - String nicht gefunden');
} else {
  fs.writeFileSync('c:\\Users\\steng\\OneDrive\\Desktop\\pokemon-Projekt\\pokemon-frontend\\src\\AuthScreens.jsx', c);
  console.log('Ersetzung durchgeführt');
}