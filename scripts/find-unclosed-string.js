// Find unclosed string in AIArenaScene.js
const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, '..', 'client', 'src', 'scenes', 'AIArenaScene.js');
const code = fs.readFileSync(filepath, 'utf8');

let inString = false;
let stringChar = null;
let escape = false;
const lines = code.split('\n');

for (let ln = 0; ln < lines.length; ln++) {
  const line = lines[ln];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (inString) {
      if (c === stringChar) {
        inString = false;
        stringChar = null;
      }
    } else {
      if (c === "'" || c === '"' || c === '`') {
        inString = true;
        stringChar = c;
      }
    }
  }
  if (inString && stringChar === '`') {
    // template literals can span multiple lines intentionally
    inString = false;
    stringChar = null;
    continue;
  }
  if (inString) {
    console.log('Unclosed string starts before line', ln + 1);
    console.log('Line content:', JSON.stringify(line));
    break;
  }
}
if (!inString) console.log('No unclosed single/double-quote strings found');
