const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

// Official game server endpoint. Update DEFAULT_SERVER_URL to the production
// server before building for Steam (Phase 4). Dev override via SERVER_URL env.
const DEFAULT_SERVER_URL = 'http://localhost:3000';
const SERVER_URL = process.env.SERVER_URL || DEFAULT_SERVER_URL;

// Run an embedded server in-process (offline/training mode). Off by default —
// the desktop client connects to SERVER_URL. Requires node:sqlite in Electron;
// verify before enabling in packaged builds.
const START_EMBEDDED = process.env.START_EMBEDDED_SERVER === '1';

function startGameServer() {
  return new Promise((resolve, reject) => {
    try {
      const serverPath = path.join(__dirname, '..', 'server', 'index.js');
      delete require.cache[require.resolve(serverPath)];
      require(serverPath);
      // The server starts listening on import; give it a moment to bind.
      setTimeout(() => resolve(), 500);
    } catch (err) {
      console.error('Failed to start embedded game server:', err);
      reject(err);
    }
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 960,
    minHeight: 640,
    resizable: true,
    title: 'Token Wars: 算力征途',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#0a0a1a',
    show: false,
  });

  // Remove default menu bar for a game feel
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(SERVER_URL);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    app.quit();
  });
}

app.whenReady().then(async () => {
  try {
    if (START_EMBEDDED) {
      await startGameServer();
    }
    createWindow();
  } catch (err) {
    console.error('Failed to initialize:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady().then(async () => {
      if (START_EMBEDDED) {
        await startGameServer();
      }
      createWindow();
    });
  }
});
