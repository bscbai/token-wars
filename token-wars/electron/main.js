const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;
const GAME_PORT = 3000;

function startGameServer() {
  return new Promise((resolve, reject) => {
    try {
      // __dirname = <app>/electron/
      // server is at <app>/server/
      const serverPath = path.join(__dirname, '..', 'server', 'index.js');
      delete require.cache[require.resolve(serverPath)];
      require(serverPath);
      // The server starts listening on import; give it a moment to bind
      setTimeout(() => resolve(), 500);
    } catch (err) {
      console.error('Failed to start game server:', err);
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

  mainWindow.loadURL(`http://localhost:${GAME_PORT}`);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    app.quit();
  });
}

app.whenReady().then(async () => {
  try {
    await startGameServer();
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
      await startGameServer();
      createWindow();
    });
  }
});
