// Syntax check for AIArenaScene.js
const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, '..', 'client', 'src', 'scenes', 'AIArenaScene.js');
const code = fs.readFileSync(filepath, 'utf8');

console.log(`File: ${filepath}`);
console.log(`Lines: ${code.split('\n').length}`);
console.log(`Bytes: ${code.length}`);

// Try Node.js acorn-style parsing via vm
const vm = require('vm');
try {
  new vm.Script(code, { filename: filepath });
  console.log('✓ Syntax OK (via vm.Script)');
} catch (e) {
  console.error('✗ Syntax error:', e.message);
  const match = e.message.match(/:(\d+)/);
  if (match) {
    const lines = code.split('\n');
    const ln = parseInt(match[1]);
    console.error(`\nContext around line ${ln}:`);
    for (let i = Math.max(0, ln - 3); i < Math.min(lines.length, ln + 2); i++) {
      const marker = (i + 1 === ln) ? '>>>' : '   ';
      console.error(`${marker} ${i + 1}: ${lines[i]}`);
    }
  }
  process.exit(1);
}
