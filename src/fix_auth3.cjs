const fs = require('fs');
let c = fs.readFileSync('c:\\Users\\steng\\OneDrive\\Desktop\\pokemon-Projekt\\pokemon-frontend\\src\\AuthScreens.jsx', 'utf8');
const oldStr = '      if (err.code === \\'auth/popup-blocked\\') {\\n        try { await signInWithRedirect(auth, provider); return; } catch (e2) { setError(authErrorMessage(e2.code)); }}\\n';
const newStr = '      if (err.code === \\'auth/popup-blocked\\') {\\n        setError("Pop-up wurde blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.");\\n      }\\n';
if (c.includes(oldStr)) {
  c = c.replace(oldStr, newStr);
  fs.writeFileSync('c:\\Users\\steng\\OneDrive\\Desktop\\pokemon-Projekt\\pokemon-frontend\\src\\AuthScreens.jsx', c);
  console.log('Ersetzung durchgeführt');
} else {
  console.log('String nicht gefunden');
  // Debug: zeige was um Index 7269 steht
  console.log('Rohzeichen um 7269:', JSON.stringify(c.substring(7240, 7320)));
}