// Preload bridge for the desktop app: relays auto-update events from the main
// process to the web UI, and lets the UI ask the app to restart-and-install.
// CommonJS (.cjs) on purpose — the package is "type": "module", and Electron
// preload scripts are simplest as CommonJS. contextIsolation is on, so the page
// only ever sees this small, explicit `window.updater` surface.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  onAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
  onDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, info) => cb(info)),
  onError: (cb) => ipcRenderer.on('update:error', (_e, msg) => cb(msg)),
  restart: () => ipcRenderer.send('update:restart'),
});
