import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import electronUpdater from 'electron-updater';
import { startServer } from './server.js';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let win;
let updatesWired = false;
let pendingDeepLink = null; // a gooping:// link that arrived before the window existed

// Register so an invite link can open this installed app instead of the browser.
// The NSIS installer also writes the registry entry; this covers the dev/runtime case.
app.setAsDefaultProtocolClient('gooping');

// A deep link should only ever open a *game* URL: our own localhost, a LAN
// address, or one of the tunnel providers we actually use. This narrows the
// attack surface — but note a *.trycloudflare.com / *.loca.lt page is still
// attacker-registerable, so the real safety net is the localhost-only gate on
// the update:restart IPC below (a joined remote page can never trigger it).
function isTrustedTarget(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h === 'trycloudflare.com' || h.endsWith('.trycloudflare.com')) return true;
  if (h === 'loca.lt' || h.endsWith('.loca.lt')) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;             // private LAN
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  return false;
}

// Pull the target URL out of a gooping:// deep link, rejecting anything that
// isn't a trusted game URL (no file://, javascript:, or arbitrary websites).
function targetFromDeepLink(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^gooping:\/\/(.*)$/i);
  if (!m) return null;
  let enc;
  const q = m[1].indexOf('u=');
  if (q !== -1) enc = m[1].slice(q + 2);
  else { const s = m[1].indexOf('/'); enc = s !== -1 ? m[1].slice(s + 1) : m[1]; }
  if (!enc) return null;
  let decoded;
  try { decoded = decodeURIComponent(enc); } catch { return null; }
  return isTrustedTarget(decoded) ? decoded : null;
}

function deepLinkFromArgv(argv) {
  const hit = (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith('gooping://'));
  return hit || null;
}

// Point the app window at the host's game (or stash it until the window exists).
function handleDeepLink(raw) {
  const target = targetFromDeepLink(raw);
  if (!target) return;
  if (win && !win.isDestroyed()) {
    win.loadURL(target);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingDeepLink = target;
  }
}

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

  const localUrl = `http://localhost:${port}`;
  // Block in-page navigation to anything that isn't a normal web URL (no file://,
  // javascript:, gooping:// etc. smuggled in by a loaded page).
  win.webContents.on('will-navigate', (e, url) => {
    if (!/^https?:\/\//i.test(url)) e.preventDefault();
  });
  // If a deep-link target is unreachable (e.g. a stale tunnel URL), don't leave
  // the window stuck on an error page — fall back to our own local server.
  win.webContents.on('did-fail-load', (_e, code, _desc, failedUrl, isMainFrame) => {
    if (isMainFrame && code !== -3 && failedUrl !== localUrl) win.loadURL(localUrl);
  });

  // If we were launched by clicking an invite link, go straight to that game;
  // otherwise load our own local server (this machine can host too).
  const launchLink = pendingDeepLink || deepLinkFromArgv(process.argv);
  pendingDeepLink = null;
  const target = targetFromDeepLink(launchLink) || localUrl;
  await win.loadURL(target);

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
  // SECURITY: only honor this from our own local UI. When the window is showing a
  // joined friend's game (a remote tunnel page loaded via a deep link), that page
  // also has the preload bridge — but it must never be able to force-install/quit
  // the app. So we ignore the request unless it came from localhost.
  ipcMain.on('update:restart', (e) => {
    let host = '';
    try { host = new URL(e.sender.getURL()).hostname.toLowerCase(); } catch (err) { /* ignore */ }
    if (host !== 'localhost' && host !== '127.0.0.1') return;
    autoUpdater.quitAndInstall(true, true);
  });

  const check = () =>
    autoUpdater
      .checkForUpdates()
      .catch((e) => console.error('[updater] check failed:', (e && e.message) || e));

  check(); // on launch
  setInterval(check, 60 * 60 * 1000); // and hourly while the host keeps the app open
}

// Only one copy of the app may run — a second launch (e.g. clicking another
// invite link) hands its deep link to the already-running instance instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    handleDeepLink(deepLinkFromArgv(argv));
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  // macOS delivers protocol links via this event rather than argv.
  app.on('open-url', (e, url) => { e.preventDefault(); handleDeepLink(url); });

  app.whenReady().then(createWindow);
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
