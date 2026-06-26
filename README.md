# 🫠 Gooping with Friends

A filthy multiplayer party-game platform you host **from your own computer** and play with friends using invite codes — Steam-style. One person hosts, everyone else joins with a code, a link, or a QR scan.

> 🔞 **18+ / NSFW.** Content is deliberately crude (sex, booze, gross-out, innuendo). War, trades, alcohol, medical and geography trivia are kept straight and factual.

## Games

| Game | What it is |
|------|-----------|
| 😈 **Filthy Trivia** | ~555 questions across **16 pickable categories** (WWII, War & History, Alcohol, Medical, USA & Canada, Plumbing, Electrical, HVAC, League of Legends, and more) — **plus "✍️ My Questions"** where the host pastes their own. Round length: Short (5) / Regular (15) / Marathon (30). |
| 🎨 **Draw & Guess** | One player draws a (filthy) secret word on a shared canvas; everyone races to guess it. **Letters reveal over time** as hints, and the host can supply **custom words**. |
| 😂 **Quip Lash** | Everyone answers the same ridiculous prompt, then votes for the funniest. Votes = points. Host can add **custom prompts**. 3+ players. |
| 🎚️ **Wavelength** | The Reader gives a clue for a hidden spot on a spectrum (e.g. Innocent ←→ Filthy); everyone slides a dial to guess it. Closer = more points. 3+ players. |
| 🫵 **Most Likely To** | A prompt drops, everyone votes for the friend it fits best. Most votes wins the round. 3+ players. |
| 🤔 **Would You Rather** | A brutal two-option dilemma — pick A or B; side with the majority to score. 3+ players. |
| 🤪 **Crazy Mode** | EVERYTHING at once — trivia and draw & guess rounds mixed into one 30-round session. |

Plus: **sound effects + background music** (🔊 / 🎵 toggles), **pick-your-emoji avatars**, a **🔞 Filthy / 🧼 Clean content toggle** (clean mode also censors profanity in typed chat/answers), **📺 TV mode** (laptop = shared big screen, phones = controllers), a **🔁 play-again** button, a **📸 shareable results card**, a **👥 standings panel** (tonight's running leaderboard across games + host can remove players), and **per-device career stats**.

> Want to remove the Windows "unknown publisher" warning on the installer? See [SIGNING.md](SIGNING.md).

## Host it permanently (no installer, no tunnel)

Want a URL that's always up so nobody has to host from their PC? This repo is deploy-ready:
- **Render:** push to GitHub → New → Blueprint → pick the repo (uses `render.yaml`). Free tier works.
- **Docker / any host:** `docker build -t gooping . && docker run -p 3000:3000 gooping` (see `Dockerfile`).

You get a permanent public URL; players just open it. The desktop installer remains the option for private/LAN/offline play.

## Run it

### Desktop app (the Steam way)
```bash
npm install
npm run app
```

### Plain web server (development)
```bash
npm start    # open http://localhost:3000   (npm run dev to auto-restart)
```

### Build the Windows installer (to send to friends)
```bash
npm run dist
```
Output lands in **`dist-app/`**:
- **`Gooping with Friends Setup <version>.exe`** — the installer to send your friends.
- `win-unpacked/Gooping with Friends.exe` — a portable build you can run without installing.

> The installer is **unsigned**, so Windows SmartScreen will say "Windows protected your PC." Click **More info → Run anyway**. (Code signing requires a paid certificate.)

## 🔄 Automatic updates

The desktop app keeps itself up to date. On launch — and hourly while it stays open — it checks this repo's [GitHub Releases](https://github.com/slinnerb/gooping-with-friends/releases) for a newer version, quietly downloads it in the background, and shows a **"Restart to update"** banner when it's ready. Nothing installs until the host clicks restart, so an update never interrupts a game in progress.

**To ship an update**, bump `version` in `package.json`, commit, then:
```bash
export GH_TOKEN=$(gh auth token)   # a token with repo scope
npm run publish                    # builds + uploads the release (installer + latest.yml)
```
Every host already running an update-capable build picks it up automatically.

> **One-time catch:** a build installed *before* auto-update existed has no updater in it, so it can't upgrade itself — install an update-capable build manually once, and every release after that flows in on its own.

> ⚠️ Updates ride the **public** GitHub Releases feed and the installer is **unsigned**, so update integrity rests on your GitHub account: anyone who can publish a release controls what installed copies download and run. Keep 2FA on and protect the default branch. Code-signing (see [SIGNING.md](SIGNING.md)) would close this gap.

## 🎮 Playing with far-away friends (different cities / public IPs)

Because home routers block incoming connections, you use the built-in tunnel:

1. **One person hosts.** Install + run the app (or `npm run app`).
2. In the lobby, click **🌍 Play online**. The app creates a public link and shows a QR.
3. **Share the link** ("Copy link") in your group chat. It already contains the room code.
4. **Friends open the link** — any phone/laptop browser, *or* paste it into the app's "Paste a friend's game link" box. They type a name and they're in. No sign-in, no reminder page.

The tunnel uses **Cloudflare Tunnel** (bundled `cloudflared`) — reliable and account-free. If Cloudflare is ever unreachable it auto-falls back to localtunnel (which shows a one-time reminder page whose password is the host's public IP, displayed in the lobby).

> Only the **host** keeps the app open — it's the server. Everyone else just needs the link.
> The link is valid only while the host's app is running. If the host restarts the app, click **Play online** again for a fresh link (the old one stops working).

## How it's built

```
electron-main.js       Desktop entry: starts the server in-process, opens the window
server.js              Express + Socket.IO (exports startServer; also runs via npm start)
src/
  rooms.js             Rooms, codes, players, reconnects, LAN + internet tunnel, state broadcasts
  tunnel.js            One-click internet tunnel (localtunnel)
  util.js              Helpers
  games/
    index.js           Game registry
    trivia.js          Trivia logic + categories
    banks-extra.js     Extra question banks (trades + topic expansions)
    drawguess.js       Draw & Guess logic
    crazy.js           Crazy Mode — mixes trivia + draw rounds
public/
  index.html, css/, js/   The client (app.js core; js/games/* per-game renderers)
```

Built with Node, Express, Socket.IO, and Electron. No build step for the web app, no database.
