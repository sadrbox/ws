const fs = require('fs');
const path = require('path');
const tr = JSON.parse(fs.readFileSync('src/i18/translations.json', 'utf8'));

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(f => {
    const p = path.join(d, f.name);
    return f.isDirectory() ? walk(p) : f.name.endsWith('olumns.json') ? [p] : [];
  });
}

const files = walk('src/models');
const missing = {};

files.forEach(file => {
  const cols = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rel = file.replace('src\\models\\', '').replace('src/models/', '');
  cols.forEach(c => {
    if (c.identifier && !tr[c.identifier]) {
      if (!missing[c.identifier]) missing[c.identifier] = [];
      missing[c.identifier].push(rel);
    }
  });
});

console.log('=== НЕТ В TRANSLATIONS ===');
Object.entries(missing).forEach(([k, v]) => console.log(k, ' -> ', v.join(', ')));
console.log('\nВсего отсутствует:', Object.keys(missing).length, 'идентификаторов');
