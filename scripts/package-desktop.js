// Electron Desktop Packaging for Steam Distribution
// Usage: node scripts/package-desktop.js
const packager = require('electron-packager');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const appName = 'Token Wars';
const appDir = 'token-wars-desktop';

// 1. Create Electron main entry
const electronMain = `
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let mainWindow;
let serverProcess;

function startServer() {
  serverProcess = fork(path.join(__dirname, 'server', 'index.js'), [], {
    env: { ...process.env, PORT: '3000', CORS_ORIGIN: '*' },
    silent: true,
  });

  serverProcess.stdout.on('data', (data) => {
    console.log('[Server]', data.toString().trim());
  });

  serverProcess.stderr.on('data', (data) => {
    console.error('[Server Error]', data.toString().trim());
  });

  return new Promise((resolve) => {
    setTimeout(resolve, 2000); // wait for server to start
  });
}

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Token Wars: 算力征途',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
`;

// 2. Create package.json for Electron
const electronPkg = {
  name: 'token-wars-desktop',
  version: '0.3.0',
  main: 'main.js',
  description: 'Token Wars: 算力征途 - Cyberpunk Multiplayer Browser Game',
  author: 'Token Wars Team',
  license: 'MIT',
};

// 3. Prepare directories
const prepareDir = path.join(projectRoot, appDir);
if (fs.existsSync(prepareDir)) {
  fs.rmSync(prepareDir, { recursive: true, force: true });
}
fs.mkdirSync(prepareDir, { recursive: true });

// Copy client files
const clientDir = path.join(projectRoot, 'client');
['public', 'src', 'shared'].forEach((dir) => {
  const src = path.join(clientDir, dir);
  const dest = path.join(prepareDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`  Copied: ${dir}/`);
  }
});

// Copy server files
const serverDir = path.join(projectRoot, 'server');
fs.cpSync(serverDir, path.join(prepareDir, 'server'), { recursive: true });
console.log('  Copied: server/');

// Copy shared constants (Node version)
const sharedDir = path.join(projectRoot, 'shared');
if (fs.existsSync(sharedDir)) {
  fs.cpSync(sharedDir, path.join(prepareDir, 'shared'), { recursive: true });
  console.log('  Copied: shared/');
}

// Copy node_modules (production only)
// Note: in production, you'd use 'npm ci --omit=dev' instead
const nodeModules = path.join(projectRoot, 'node_modules');
if (fs.existsSync(nodeModules)) {
  console.log('  Copying node_modules/ (this may take a moment)...');
  fs.cpSync(nodeModules, path.join(prepareDir, 'node_modules'), { recursive: true });
}

// Write Electron files
fs.writeFileSync(path.join(prepareDir, 'main.js'), electronMain.trim());
fs.writeFileSync(path.join(prepareDir, 'package.json'), JSON.stringify(electronPkg, null, 2));
console.log('  Written: main.js, package.json');

// 4. Package with electron-packager
console.log('\nPackaging Electron app...\n');

packager({
  dir: prepareDir,
  name: appName,
  out: distDir,
  overwrite: true,
  platform: process.platform,
  arch: 'x64',
  asar: true,
  prune: true,
  ignore: [
    /\.git/,
    /\.workbuddy/,
    /dist/,
  ],
  appCopyright: '© 2026 Token Wars Team',
  appVersion: '0.3.0',
  win32metadata: {
    CompanyName: 'Token Wars Team',
    FileDescription: 'Token Wars: 算力征途',
    OriginalFilename: 'Token Wars.exe',
    ProductName: 'Token Wars',
    InternalName: 'Token Wars',
  },
})
  .then((appPaths) => {
    console.log('\nPackaging complete!');
    console.log('Output:', appPaths);
    // Clean up prepare directory
    fs.rmSync(prepareDir, { recursive: true, force: true });
  })
  .catch((err) => {
    console.error('Packaging failed:', err);
    process.exit(1);
  });
