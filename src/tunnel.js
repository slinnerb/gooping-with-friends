// Exposes the locally-run game to the internet with one click.
// Primary: Cloudflare Tunnel (trycloudflare.com) — reliable, no account, no
// interstitial. Fallback: localtunnel (pure JS) if the cloudflared binary is
// missing or fails to come up.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import localtunnel from 'localtunnel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let active = null; // { url, stop }

function cloudflaredBin() {
  const name = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const dirs = [];
  if (process.resourcesPath) dirs.push(process.resourcesPath); // packaged Electron
  dirs.push(path.join(__dirname, '..', 'vendor')); // dev / npm start
  for (const d of dirs) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Fire the death callback at most once per live tunnel, so the caller can clear
// the now-dead URL and try to bring a new one up.
function notifyDeath(onDeath) {
  if (typeof onDeath === 'function') { try { onDeath(); } catch { /* ignore */ } }
}

function startCloudflared(port, onDeath) {
  return new Promise((resolve, reject) => {
    const bin = cloudflaredBin();
    if (!bin) {
      reject(new Error('cloudflared binary not found'));
      return;
    }
    const child = spawn(
      bin,
      ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`],
      { windowsHide: true }
    );
    let settled = false;

    const onData = (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && !settled) {
        settled = true;
        active = { url: m[0], stop: () => { try { child.kill(); } catch { /* ignore */ } } };
        resolve(m[0]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      if (!settled) { settled = true; reject(err); }
    });
    child.on('exit', () => {
      if (!settled) { settled = true; reject(new Error('cloudflared exited before a URL appeared')); }
      else { active = null; notifyDeath(onDeath); } // was live and went down
    });
    setTimeout(() => {
      if (!settled) { settled = true; try { child.kill(); } catch { /* ignore */ } reject(new Error('cloudflared timed out')); }
    }, 25000);
  });
}

async function startLocaltunnel(port, onDeath) {
  const t = await localtunnel({ port });
  active = { url: t.url, stop: () => { try { t.close(); } catch { /* ignore */ } } };
  t.on('close', () => { if (active && active.url === t.url) { active = null; notifyDeath(onDeath); } });
  return t.url;
}

// onDeath (optional) is invoked if the tunnel dies AFTER handing out a URL, so
// the host UI stops advertising a dead link and can restart it.
export async function startTunnel(port, onDeath) {
  if (active) return active.url;
  try {
    return await startCloudflared(port, onDeath);
  } catch (err) {
    console.warn('Cloudflare tunnel unavailable, falling back to localtunnel:', err.message);
    return startLocaltunnel(port, onDeath);
  }
}

export function stopTunnel() {
  if (active) {
    try { active.stop(); } catch { /* ignore */ }
    active = null;
  }
}
