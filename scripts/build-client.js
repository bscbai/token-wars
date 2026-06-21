// Build script for production: copies client files to dist/client
// Usage: node scripts/build-client.js
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const clientDir = path.join(projectRoot, 'client');
const distDir = path.join(projectRoot, 'dist', 'client');

// Create dist directory
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Copy directory recursively
function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Building client for production...');

// Clean dist
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}

// Copy public (index.html, assets)
copyDir(path.join(clientDir, 'public'), path.join(distDir, 'public'));
// Copy source (scenes, systems)
copyDir(path.join(clientDir, 'src'), path.join(distDir, 'src'));
// Copy shared constants (browser version)
copyDir(path.join(clientDir, 'shared'), path.join(distDir, 'shared'));

console.log('Build complete! Output: dist/client/');
