import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import electronUpdater from 'electron-updater';
import { startServer } from './server.js';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win;

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

  autoUpdater.autoDownload = true; // pull the new version quietly in the background
  autoUpdater.autoInstallOnAppQuit = true; // if they quit before clicking "Restart", install on next quit

  autoUpdater.on('update-available', (info) =>
    sendToWindow('update:available', { version: info.version }));
  autoUpdater.on('download-progress', (p) =>
    sendToWindow('update:progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) =>
    sendToWindow('update:downloaded', { version: info.version }));
  autoUpdater.on('error', (err) =>
    sendToWindow('update:error', String((err && err.message) || err)));

  // The renderer's "Restart to update" button asks us to quit & install.
  ipcMain.on('update:restart', () => autoUpdater.quitAndInstall());

  // Check on launch, then hourly in case the host keeps the app open across a release.
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
