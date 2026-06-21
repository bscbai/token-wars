// Find unpaired quotes per line
const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, '..', 'client', 'src', 'scenes', 'AIArenaScene.js');
const code = fs.readFileSync(filepath, 'utf8');
const lines = code.split('\n');
const issues = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let singles = 0;
  let doubles = 0;
  let backticks = 0;
  let escape = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === "'") singles++;
    else if (c === '"') doubles++;
    else if (c === '`') backticks++;
  }
  if (singles % 2 !== 0) issues.push((i+1) + ': unpaired SINGLE: ' + JSON.stringify(line));
  if (doubles % 2 !== 0) issues.push((i+1) + ': unpaired DOUBLE: ' + JSON.stringify(line));
  if (backticks % 2 !== 0) issues.push((i+1) + ': unpaired BACKTICK: ' + JSON.stringify(line));
}

console.log('Issues found:', issues.length);
issues.forEach(i => console.log(i));
