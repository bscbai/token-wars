// Check syntax of all client JS files
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = [
  'client/src/scenes/LobbyScene.js',
  'client/src/scenes/CombatScene.js',
  'client/src/scenes/AIArenaScene.js',
  'client/src/systems/NetworkManager.js',
  'client/shared/constants.js',
];

let allOk = true;
for (const f of files) {
  const filepath = path.join(__dirname, '..', f);
  const code = fs.readFileSync(filepath, 'utf8');
  try {
    new vm.Script(code, { filename: f });
    console.log('✓', f);
  } catch (e) {
    console.log('✗', f, '-', e.message);
    allOk = false;
  }
}

process.exit(allOk ? 0 : 1);
