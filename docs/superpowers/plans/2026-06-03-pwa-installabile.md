# PWA installabile + pulsante installa · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Rendere l'app installabile (manifest + icone stella + service worker) e aggiungere un pulsante "Installa app" adattivo. Niente DB, niente store.

**Architecture:** File statici nuovi (`manifest.webmanifest`, `sw.js`, `icons/*`) serviti da GitHub Pages sotto `/global-awakening/` (path relativi). `app.html` registra il SW + meta PWA + pulsante installa nel footer. SW: network-first per app.html, cache-first per i CDN immutabili, no-cache per Supabase.

**Tech Stack:** HTML/JSON statici, service worker API, React UMD inline, Playwright per generare icone e per lo smoke.

---

## Task 1: Icone stella

**Files:** Create `scripts/gen-icons.js`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`

- [ ] **Step 1: Scrivere `scripts/gen-icons.js`**

```javascript
// Genera le icone PWA (stella su tondo viola) con Playwright. Niente tool grafici.
// Uso: node scripts/gen-icons.js
const { chromium } = require('playwright');
const path = require('path');

const STAR = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <polygon points="50,8 61,38 93,38 67,57 77,90 50,70 23,90 33,57 7,38 39,38"
           fill="url(#g)" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" stroke-linejoin="round"/>
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#fef9c3"/><stop offset="100%" stop-color="#fbbf24"/>
  </linearGradient></defs></svg>`;

function page(starScalePct) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    .bg{width:512px;height:512px;display:flex;align-items:center;justify-content:center;
        background:radial-gradient(circle at 50% 40%, #7c3aed 0%, #4c1d95 100%)}
    .star{width:${starScalePct}%;height:${starScalePct}%;filter:drop-shadow(0 6px 18px rgba(0,0,0,0.35))}
  </style></head><body><div class="bg"><div class="star">${STAR}</div></div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  const out = path.join(__dirname, '..', 'icons');
  require('fs').mkdirSync(out, { recursive: true });

  // any: stella grande (78% della tela)
  await p.setContent(page(78));
  await p.locator('.bg').screenshot({ path: path.join(out, 'icon-512.png') });
  await p.setViewportSize({ width: 192, height: 192 });
  await p.evaluate(() => { document.querySelector('.bg').style.width='192px'; document.querySelector('.bg').style.height='192px'; });
  await p.locator('.bg').screenshot({ path: path.join(out, 'icon-192.png') });

  // maskable: stella piccola (52%) per la safe-zone Android
  await p.setViewportSize({ width: 512, height: 512 });
  await p.setContent(page(52));
  await p.locator('.bg').screenshot({ path: path.join(out, 'icon-maskable-512.png') });

  await browser.close();
  console.log('Icone generate in icons/');
})();
```

- [ ] **Step 2: Generare le icone**

Run: `node scripts/gen-icons.js`
Expected: 3 PNG in `icons/`, non vuoti. Verificare con `ls -la icons/`.

- [ ] **Step 3: Commit** — `git add scripts/gen-icons.js icons/ && git commit -m "feat(pwa): icone stella generate con Playwright"`

---

## Task 2: Manifest

**Files:** Create `manifest.webmanifest`

- [ ] **Step 1: Scrivere il file** (path relativi per GitHub Pages project site)

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

- [ ] **Step 2: Commit** — `git add manifest.webmanifest && git commit -m "feat(pwa): web app manifest"`

---

## Task 3: Service worker

**Files:** Create `sw.js`

- [ ] **Step 1: Scrivere `sw.js`**

```javascript
// Service worker PWA Global Awakening.
// Strategia: network-first per la navigazione/app.html (deploy sempre freschi),
// cache-first per i CDN immutabili e le icone, no-cache per Supabase/EmailJS.
const CACHE = 'ga-pwa-v1';
const PRECACHE = [
  'app.html', 'index.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.2/babel.min.js',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll fallirebbe tutto se un CDN non risponde: aggiungo singolarmente, tollerante.
    await Promise.allSettled(PRECACHE.map((u) => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase / EmailJS: sempre rete, mai cache (dati freschi; offline -> errore gestito dall'app)
  if (/supabase\.co$/.test(url.hostname) || /emailjs\.com$/.test(url.hostname)) return;

  // Navigazione o app.html: network-first, fallback cache
  const isNav = req.mode === 'navigate' || url.pathname.endsWith('/app.html') || url.pathname.endsWith('/');
  if (isNav) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch (_) {
        const cached = await caches.match(req) || await caches.match('app.html');
        if (cached) return cached;
        throw _;
      }
    })());
    return;
  }

  // Resto (CDN immutabili, icone, manifest): cache-first
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    try { const c = await caches.open(CACHE); c.put(req, fresh.clone()); } catch (_) {}
    return fresh;
  })());
});
```

- [ ] **Step 2: Commit** — `git add sw.js && git commit -m "feat(pwa): service worker (network-first app, cache-first CDN)"`

---

## Task 4: `<head>` + registrazione SW in `app.html`

**Files:** Modify `app.html` (`<head>`, ~righe 3-7)

- [ ] **Step 1: Aggiungere meta + manifest dopo il favicon** (dopo la riga `<link rel="icon" ...>`)

```html
    <link rel="manifest" href="manifest.webmanifest">
    <meta name="theme-color" content="#a78bfa">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Awakening">
    <link rel="apple-touch-icon" href="icons/icon-192.png">
```

- [ ] **Step 2: Registrare il service worker** — aggiungere uno `<script>` subito prima di `</head>` (o dopo i meta):

```html
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('sw.js').catch(() => { /* PWA non disponibile: app invariata */ });
        });
      }
    </script>
```

- [ ] **Step 3: Verifica montaggio JSX** (Playwright headless: nessun pageerror, React monta).

- [ ] **Step 4: Commit** — `git add app.html && git commit -m "feat(pwa): manifest + meta iOS + registrazione service worker"`

---

## Task 5: Pulsante "Installa app" (React, footer)

**Files:** Modify `app.html` (i18n EN/IT, stati, listener effect, footer)

- [ ] **Step 1: i18n** — aggiungere nel blocco EN (vicino a `reportIssue`) e IT:

EN:
```javascript
            pwaInstall: "📲 Install app",
            pwaIosTitle: "Install on iPhone",
            pwaIosBody: "Tap Share ⬆️ then \"Add to Home Screen\".",
            pwaIosClose: "Got it",
```
IT:
```javascript
            pwaInstall: "📲 Installa app",
            pwaIosTitle: "Installa su iPhone",
            pwaIosBody: "Tocca Condividi ⬆️ poi \"Aggiungi alla schermata Home\".",
            pwaIosClose: "Ho capito",
```

- [ ] **Step 2: Stati** (vicino agli altri useState del componente principale):

```javascript
          const [deferredPrompt, setDeferredPrompt] = useState(null);
          const [showIosInstall, setShowIosInstall] = useState(false);
          const isStandalone = (typeof window !== 'undefined') &&
            (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
          const isIos = (typeof navigator !== 'undefined') && /iphone|ipad|ipod/i.test(navigator.userAgent);
```

- [ ] **Step 3: Listener `beforeinstallprompt`** (nuovo useEffect, vicino agli altri effect):

```javascript
          useEffect(() => {
            const onBip = (e) => { e.preventDefault(); setDeferredPrompt(e); };
            window.addEventListener('beforeinstallprompt', onBip);
            return () => window.removeEventListener('beforeinstallprompt', onBip);
          }, []);

          const handleInstall = async () => {
            if (deferredPrompt) {
              deferredPrompt.prompt();
              await deferredPrompt.userChoice.catch(() => {});
              setDeferredPrompt(null);
            } else if (isIos) {
              setShowIosInstall(true);
            }
          };
```

- [ ] **Step 4: Pulsante nel footer** — accanto al link Privacy / Segnala un problema. Mostrare se `!isStandalone && (deferredPrompt || isIos)`:

```javascript
                      {!isStandalone && (deferredPrompt || isIos) && (
                        <button
                          onClick={handleInstall}
                          style={{ background: 'none', border: 'none', color: '#a78bfa', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit', padding: 0 }}
                        >
                          {t.pwaInstall}
                        </button>
                      )}
```

- [ ] **Step 5: Overlay istruzioni iOS** — vicino agli altri modali:

```javascript
              {showIosInstall && (
                <div className="modal-overlay" onClick={() => setShowIosInstall(false)} style={{zIndex: 70}}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{maxWidth: '22rem'}}>
                    <h3 className="text-xl font-bold text-white mb-2">{t.pwaIosTitle}</h3>
                    <p className="text-secondary text-sm mb-4">{t.pwaIosBody}</p>
                    <button className="btn-primary w-full" onClick={() => setShowIosInstall(false)}>{t.pwaIosClose}</button>
                  </div>
                </div>
              )}
```

- [ ] **Step 6: Verifica montaggio JSX** (Playwright headless).

- [ ] **Step 7: Commit** — `git add app.html && git commit -m "feat(pwa): pulsante Installa app adattivo (Android prompt / iOS istruzioni)"`

---

## Task 6: Test + deploy

**Files:** Create `test-pwa.js`

- [ ] **Step 1: Scrivere `test-pwa.js`**

```javascript
/**
 * Smoke PWA — Global Awakening. node test-pwa.js (server su :4321)
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:4321';
let passed = 0, failed = 0;
const pass = (m) => { console.log('  ✅ ' + m); passed++; };
const fail = (m) => { console.log('  ❌ ' + m); failed++; process.exitCode = 1; };

(async () => {
  // 1. manifest + icone via HTTP
  const mres = await fetch(`${BASE}/manifest.webmanifest`);
  if (mres.ok) { pass('manifest raggiungibile'); } else { fail(`manifest HTTP ${mres.status}`); }
  let manifest = {};
  try { manifest = await mres.json(); pass('manifest è JSON valido'); } catch { fail('manifest non è JSON'); }
  if (manifest.name && manifest.start_url && Array.isArray(manifest.icons) && manifest.icons.length >= 2) pass('manifest ha name/start_url/icons');
  else fail(`manifest incompleto: ${JSON.stringify(manifest)}`);
  for (const ic of (manifest.icons || [])) {
    const r = await fetch(`${BASE}/${ic.src}`);
    if (r.ok) pass(`icona ${ic.src} 200`); else fail(`icona ${ic.src} HTTP ${r.status}`);
  }

  // 2. pagina: no pageerror, link manifest, SW registrato
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/app.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(':text("Register"), input', { timeout: 20000 }).catch(() => {});
  const hasManifest = await page.locator('link[rel="manifest"]').count();
  if (hasManifest > 0) pass('<link rel=manifest> presente'); else fail('manca <link rel=manifest>');
  const reg = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const r = await navigator.serviceWorker.getRegistration().catch(() => null);
    return !!r;
  });
  if (reg) pass('service worker registrato'); else fail('service worker NON registrato');
  if (errors.length === 0) pass('nessun pageerror'); else fail('pageerror: ' + errors.join(' | '));
  await browser.close();
  console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
})();
```

- [ ] **Step 2: Run** — `node test-pwa.js` (server attivo) → tutti ✅.
- [ ] **Step 3: Non-regressione smoke** — `node test-privacy.js` (verifica footer/modali non rotti) → 5/5.
- [ ] **Step 4: Commit + push** — `git add test-pwa.js && git commit -m "test(pwa): smoke manifest + SW + icone" && git push origin main`.
- [ ] **Step 5: Verifica deploy live** — `manifest.webmanifest`, `sw.js`, `icons/icon-192.png` raggiungibili su `https://ireneacqua.github.io/global-awakening/...`. Aggiornare memoria (PWA fatta).

---

## Self-review
- **Copertura spec:** icone (Task 1), manifest (Task 2), SW (Task 3), head+registrazione (Task 4), pulsante adattivo (Task 5), test+deploy (Task 6). ✔
- **Path relativi** ovunque (GitHub Pages project site). ✔
- **Coerenza:** `manifest.webmanifest`, `sw.js`, `icons/icon-{192,512,maskable-512}.png`, stati `deferredPrompt`/`showIosInstall`, i18n `pwa*`. ✔
- **Rischi:** nessun DB; SW potrebbe servire app.html cache su deploy → mitigato da network-first. Cache CDN tollerante (`allSettled`). Pulsante nascosto se standalone o desktop senza prompt.
