const fs = require('fs');
const lines = fs.readFileSync('c:\\Users\\steng\\OneDrive\\Desktop\\pokemon-Projekt\\pokemon-frontend\\src\\AuthScreens.jsx', 'utf8').split('\\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('signInWithRedirect')) {
    // Zeile i ist die problematische Zeile, Zeile i-1 ist das "if", Zeile i+1 ist das "} else if"
    lines[i] = '        setError("Pop-up wurde blockiert. Bitte Pop-ups für diese Seite erlauben und erneut versuchen.");';
    console.log('Zeile', i, 'ersetzt');
    break;
  }
}
fs.writeFileSync('c:\\Users\\steng\\OneDrive\\Desktop\\pokemon-Projekt\\pokemon-frontend\\src\\AuthScreens.jsx', lines.join('\\n'));
console.log('Fertig');