// Asset gap detection — what Steam requires vs what we have
const fs = require('fs');
const path = require('path');

const SHOTS_DIR = path.join(__dirname, '..', 'dist', 'screenshots');
const BUILD_DIR = path.join(__dirname, '..', 'build');

const required = [
  // Capsule art
  { name: 'Library Capsule', file: '01-steam-library-capsule.png', size: '616x353', required: true },
  { name: 'Library Hero Capsule (Portrait)', file: 'library-hero-capsule.png', size: '3840x1240', required: true },
  { name: 'Header Capsule', file: '02-steam-header-capsule.png', size: '460x215', required: true },
  { name: 'Small Capsule', file: '03-steam-small-capsule.png', size: '231x87', required: true },
  { name: 'Main Capsule', file: '04-steam-main-capsule.png', size: '616x353', required: true },
  { name: 'Vertical Capsule', file: 'vertical-capsule.png', size: '748x896', required: true },

  // Screenshots (minimum 5)
  { name: 'Screenshot 1 - Combat', file: '05-screenshot-combat.png', size: '1920x1080', required: true },
  { name: 'Screenshot 2 - Lobby', file: '06-screenshot-lobby.png', size: '1920x1080', required: true },
  { name: 'Screenshot 3 - AI Arena', file: 'screenshot-ai-arena.png', size: '1920x1080', required: true },
  { name: 'Screenshot 4 - Combat Action', file: 'screenshot-combat-action.png', size: '1920x1080', required: true },
  { name: 'Screenshot 5 - Token Collection', file: 'screenshot-tokens.png', size: '1920x1080', required: true },

  // Icons & branding
  { name: 'Application Icon (ICO)', file: 'icon.ico', size: '256x256', required: true, path: BUILD_DIR },
  { name: 'Application Icon (PNG)', file: 'icon.png', size: '256x256', required: true, path: BUILD_DIR },
  { name: 'Page Background', file: 'page-background.png', size: '1438x2300', required: false, recommended: true },

  // Video (optional but recommended)
  { name: 'Trailer (MP4/WebM)', file: 'trailer.mp4', size: '1920x1080', required: false, recommended: true },
];

console.log('\n=== Steam Asset Status ===\n');

let hasAll = true;
const missing = [];
const present = [];

for (const asset of required) {
  const dir = asset.path || SHOTS_DIR;
  const filepath = path.join(dir, asset.file);
  const exists = fs.existsSync(filepath);

  if (exists) {
    const size = fs.statSync(filepath).size;
    console.log(`  [OK]   ${asset.name.padEnd(40)} ${asset.size.padEnd(12)} ${(size / 1024).toFixed(1)}KB`);
    present.push(asset);
  } else {
    const tag = asset.required ? '[MISS]' : '[ -- ]';
    if (asset.required) hasAll = false;
    console.log(`  ${tag} ${asset.name.padEnd(40)} ${asset.size.padEnd(12)} ${asset.recommended ? '推荐' : '必选'}`);
    if (asset.required) missing.push(asset);
  }
}

console.log(`\n状态: ${hasAll ? '✓ 全部就绪' : `✗ 缺少 ${missing.length} 个必选素材`}`);
if (missing.length > 0) {
  console.log('\n缺什么:');
  for (const m of missing) {
    console.log(`  - ${m.name} (${m.size})`);
  }
}
process.exit(hasAll ? 0 : 1);
