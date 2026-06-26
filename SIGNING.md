# Code-signing the installer (removing the SmartScreen warning)

Right now the installer is **unsigned**, so Windows shows *"Windows protected your PC — unknown publisher"* and your friends have to click **More info → Run anyway**. That's normal for unsigned apps and harmless, but signing makes it disappear (and builds reputation so SmartScreen stops warning entirely).

You need a **code-signing certificate** (this is the part that costs money / requires identity verification — there's no free way to fully clear SmartScreen). Pick one:

| Option | Cost | Notes |
|---|---|---|
| **Azure Trusted Signing** | ~$10/month | Microsoft-run, easiest modern path, works great with electron-builder. Requires a verified org/individual. **Recommended.** |
| **SignPath.io** | Free for open-source | If you make the repo public/OSS, they sign releases for free. |
| **EV cert** (DigiCert/Sectigo) | ~$250–500/yr | EV (Extended Validation) gives **instant** SmartScreen reputation — no warning from day one. On a USB token. |
| **OV cert** (standard) | ~$150–300/yr | Cheaper, but SmartScreen may still warn until the app builds download reputation. |

## Wiring it into the build

electron-builder reads signing config from `package.json` `build.win` and/or environment variables.

**With a `.pfx` file (OV/EV file-based):**
```powershell
$env:CSC_LINK = "C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "your-cert-password"
npm run dist
```
electron-builder auto-detects these and signs both the app `.exe` and the installer. No code change needed.

**With Azure Trusted Signing**, add to `package.json` under `build.win`:
```json
"azureSignOptions": {
  "publisherName": "Your Name or Org",
  "endpoint": "https://eus.codesigning.azure.net/",
  "certificateProfileName": "your-profile",
  "codeSigningAccountName": "your-account"
}
```
and authenticate via the Azure CLI / env vars per electron-builder's docs.

## Quick sanity check

After signing, right-click the built `dist-app\Gooping with Friends Setup 0.1.0.exe` → **Properties → Digital Signatures** — you should see your certificate listed. At that point friends won't see the "unknown publisher" warning (EV: immediately; OV: after some downloads).

> Until you sign: just tell friends to click **More info → Run anyway**. It works fine.
