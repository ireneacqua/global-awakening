# PWA installabile + pulsante "Installa app" · Design

Data: 2026-06-03
Stato: approvato

## Obiettivo

Rendere Global Awakening **installabile** sul telefono (icona in home, apertura a
tutto schermo senza barra browser, avvio offline dell'app shell) e aggiungere un
pulsante "📲 Installa app" adattivo nel sito. **Costo zero**, resta su GitHub Pages,
nessuno store. Non rompe il flusso single-file "edita-e-deploya".

## Contesto

- Sito su GitHub Pages: `https://ireneacqua.github.io/global-awakening/` → base path
  `/global-awakening/`. `index.html` fa redirect a `app.html` (monolite React UMD).
- `app.html <head>`: solo charset, viewport, title, favicon emoji ⭐ inline. Nessun
  manifest/SW/icona oggi.
- 4 CDN pinnati (immutabili) con SRI:
  - `https://unpkg.com/react@18.3.1/umd/react.production.min.js`
  - `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js`
  - `https://unpkg.com/@babel/standalone@7.29.2/babel.min.js`
  - `https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js`
- Dati via Supabase REST (richiedono rete; errori già gestiti con toast).
- HTTPS già presente (prerequisito PWA ok).

**Path:** GitHub Pages è un *project site*, quindi i path assoluti `/` puntano alla
root del dominio, NON al progetto. Usare **path relativi** ovunque (manifest, SW,
icone, registrazione) così tutto si risolve sotto `/global-awakening/`.

## Componenti

### 1. Icone (la stella) — `icons/`
Generare 3 PNG da una stella su tondo viola (brand: viola `#a78bfa`/`#7c3aed`, stella
chiara/dorata), coerente con l'emoji ⭐ già usata come favicon:
- `icons/icon-192.png` (192×192)
- `icons/icon-512.png` (512×512)
- `icons/icon-maskable-512.png` (512×512, stella più piccola con margine ~20% per il
  "safe zone" Android che ritaglia a cerchio/squircle).

Generazione **senza tool di grafica**: script Playwright (`scripts/gen-icons.js`) che
renderizza una paginetta HTML con la stella (gradiente viola di sfondo + glyph ⭐ o un
path SVG stella) e fa `screenshot` alle dimensioni esatte. Lo script resta nel repo come
riproducibile; i PNG vengono committati.

### 2. Manifest — `manifest.webmanifest`
```json
{
  "name": "Global Awakening",
  "short_name": "Awakening",
  "description": "Piattaforma per risvegliati: rituali, telepatia, coscienza.",
  "start_url": "app.html",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0c0f14",
  "theme_color": "#a78bfa",
  "lang": "it",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 3. Service worker — `sw.js`
- `CACHE` versionato (es. `ga-pwa-v1`); su `activate` cancella le cache vecchie.
- `install`: precache dell'app shell — `app.html`, `index.html`, `manifest.webmanifest`,
  le 3 icone, i 4 CDN. `skipWaiting()`.
- `fetch`:
  - richieste di **navigazione** e `app.html` → **network-first** (online sempre
    l'ultima; offline → cache). Garantisce che i deploy futuri arrivino subito.
  - i 4 CDN (immutabili) e le icone → **cache-first**.
  - Supabase (`*.supabase.co`) e EmailJS API → **sempre network** (mai cache), così i
    dati non vengono mai serviti stantii; offline falliscono e l'app mostra i toast
    esistenti.
- `clients.claim()` su activate.

### 4. Registrazione + meta nel `<head>` di `app.html`
- `<link rel="manifest" href="manifest.webmanifest">`
- `<meta name="theme-color" content="#a78bfa">`
- iOS: `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
  `<meta name="apple-mobile-web-app-title" content="Awakening">`,
  `<link rel="apple-touch-icon" href="icons/icon-192.png">`.
- Script di registrazione (dopo il load): `navigator.serviceWorker.register('sw.js')`
  in try/catch silenzioso (se non supportato, l'app funziona comunque).

### 5. Pulsante "📲 Installa app" (nel componente React, footer)
- Stato `deferredPrompt` (null). Listener `beforeinstallprompt`: `preventDefault()` +
  salva l'evento + mostra il pulsante.
- Rileva contesto:
  - **già installata** (`window.matchMedia('(display-mode: standalone)').matches` o
    `navigator.standalone`) → non mostrare nulla.
  - **Android/Chrome** (deferredPrompt disponibile) → pulsante "📲 Installa app"; al
    click `deferredPrompt.prompt()` poi azzera lo stato.
  - **iOS Safari** (no deferredPrompt, è iOS) → pulsante che apre un piccolo overlay con
    istruzioni: "Tocca Condividi ⬆️ poi 'Aggiungi alla schermata Home'".
- i18n IT/EN: `t.pwa.install`, `t.pwa.iosTitle`, `t.pwa.iosBody`. Posizionato nel footer
  accanto a Privacy / Segnala un problema.

## Error handling
- SW non supportato / registrazione fallita → try/catch silenzioso, app invariata.
- `beforeinstallprompt` mai emesso (browser desktop, o già installata) → pulsante
  nascosto, nessun errore.
- Cache miss offline su navigazione → fallback all'`app.html` in cache.

## Testing
- `scripts/gen-icons.js` produce 3 PNG non vuoti (dimensioni corrette).
- Smoke Playwright (`test-pwa.js`): carica `app.html` su localhost, verifica
  (a) `<link rel=manifest>` presente e il manifest è JSON valido con name/icons/start_url;
  (b) nessun `pageerror`; (c) `navigator.serviceWorker.controller` o registrazione
  avvenuta entro qualche secondo; (d) le 3 icone rispondono 200.
- Verifica deploy live: manifest e icone raggiungibili su GitHub Pages; Lighthouse PWA
  "installable" la confermerai tu dal browser/telefono nel test con Claudio.
- Non-regressione: l'app continua a montare e i flussi base restano verdi (smoke).

## Note di deploy
- GitHub Pages serve file statici as-is: manifest, sw.js, icons/ vengono pubblicati al
  push. **Nessuna modifica DB.** Nessun gate Studio.
- Il SW va servito dalla stessa origin/scope: `sw.js` alla root del repo → servito da
  `/global-awakening/sw.js`, scope `/global-awakening/`. OK.

## Out of scope (YAGNI)
- Notifiche push, background sync, caching dei dati Supabase offline, schermata offline
  custom. Solo "installabile + app shell offline".
