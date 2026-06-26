import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import electronUpdater from 'electron-updater';
import { startServer } from './server.js';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win;
let updatesWired = false;

async function createWindow() {
  // Start the game server inside this desktop app — the host IS the server.
  // Port 0 = let the OS pick any free port, so we never clash with whatever is
  // already using 3000 on the user's machine. We load whatever port we get.
  const { port, manager } = await startServer(process.env.PORT || 0);

  win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#6a5cff',
    title: 'Gooping with Friends',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.setMenuBarVisibility(false);
  await win.loadURL(`http://localhost:${port}`);

  // Open any external links (e.g. the deploy guide) in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (manager.lanUrl) {
    console.log(`Friends on your Wi-Fi can join at: ${manager.lanUrl}`);
  }

  setupAutoUpdates();
}

// ---- Auto-update: download in the background, then let the host restart to apply ----
function sendToWindow(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setupAutoUpdates() {
  // Only meaningful in a packaged build wired to the GitHub release feed.
  // In dev (`npm run app`) there's no newer release to fetch, so skip silently.
  if (!app.isPackaged) return;

  // Wire the global autoUpdater singleton exactly once. createWindow() can run
  // again (e.g. macOS 'activate'), and re-registering would stack event
  // listeners, duplicate the restart IPC handler (-> multiple quitAndInstall
  // calls on one click), and leak a new hourly interval each time.
  if (updatesWired) return;
  updatesWired = true;

  // Download new versions quietly in the background, but NEVER install without an
  // explicit click — closing the app must not silently swap versions mid-party.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) =>
    sendToWindow('update:available', { version: info.version }));
  autoUpdater.on('download-progress', (p) =>
    sendToWindow('update:progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) =>
    sendToWindow('update:downloaded', { version: info.version }));
  autoUpdater.on('error', (err) => {
    // Keep a main-process trail so a misconfigured feed isn't an invisible no-op.
    console.error('[updater] error:', (err && err.stack) || err);
    sendToWindow('update:error', String((err && err.message) || err));
  });

  // The renderer's "Restart to update" button asks us to install + relaunch.
  // (true, true) = silent NSIS install + auto-relaunch, so it feels like a restart.
  ipcMain.on('update:restart', () => autoUpdater.quitAndInstall(true, true));

  const check = () =>
    autoUpdater
      .checkForUpdates()
      .catch((e) => console.error('[updater] check failed:', (e && e.message) || e));

  check(); // on launch
  setInterval(check, 60 * 60 * 1000); // and hourly while the host keeps the app open
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
