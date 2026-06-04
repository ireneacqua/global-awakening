# Precompilazione JSX + CSP — Design

**Data:** 2026-06-04 · **Stato:** approvato (design), in attesa di review spec
**Origine:** raccomandazioni #1+#2 di `DIPENDENZE_AUDIT.md` (L4)

## Obiettivo

Rimuovere la trasformazione Babel **a runtime** (oggi `@babel/standalone` traduce
~4300 righe di JSX nel browser a ogni caricamento) facendola **una volta a build-time**,
e attivare una **Content-Security-Policy forte**.

Benefici: LCP migliore (niente ~3 MB di transformer + compile a runtime → si lega a G3) e
difesa-in-profondità contro XSS (CSP senza `'unsafe-eval'`, possibile solo tolto Babel).

## Stato attuale (rilevato)

- `app.html` (~4871 righe) single-file. Il cuore è **un `<script type="text/babel">`**
  (righe 558→fine) trasformato a runtime. Nessun `data-presets` sul tag.
- Script inline aggiuntivi (JS normale, niente JSX):
  - riga 14: registrazione service worker
  - riga 25: `emailjs.init({...})`
  - riga 26: costanti `SUPABASE_URL`/`SUPABASE_KEY`/`SB_HEADERS` + client `supabase` (wrapper REST fatto a mano)
  - riga 492: animazione starfield (IIFE su canvas)
- CDN (tutti con SRI): react 18.3.1, react-dom 18.3.1, @babel/standalone 7.29.2, @emailjs/browser 4.4.1.
- PWA `sw.js`: precache include `@babel/standalone`; `CACHE = 'ga-pwa-v1'`.
- Deploy: GitHub Pages project-site, path relativi, serve da root.

## Design

### Componenti
1. **`src/app.jsx`** (nuovo, sorgente): contiene il JSX oggi nel blocco `text/babel`.
   Diventa il file che si modifica per la logica dell'app.
2. **`app.html`** (guscio servito): rimosso il blocco `text/babel` e lo script CDN di
   `@babel/standalone`; aggiunto `<script src="app.js"></script>` (classic, NON module) e
   il `<meta http-equiv="Content-Security-Policy">`. Restano head, `<style>`, gli inline
   script (14/25/26/492) e il root React.
3. **`app.js`** (generato, committato): output compilato di `src/app.jsx`.
4. **`build.js`** (nuovo, dev): compila `src/app.jsx` → `app.js` con `@babel/core` +
   `@babel/preset-react` (dev-deps locali); calcola gli hash `sha256` degli script inline
   rimasti e li inietta nel meta CSP di `app.html`.
5. **`sw.js`**: rimosso `@babel/standalone` dal precache, aggiunto `app.js`, `CACHE` → `ga-pwa-v2`.

### CSP (via meta tag, GitHub Pages non permette header)
Direttive previste (da rifinire in implementazione):
- `default-src 'self'`
- `script-src 'self' https://unpkg.com https://cdn.jsdelivr.net 'sha256-<hash inline>'…`
  (niente `'unsafe-eval'`, niente `'unsafe-inline'`: gli inline coperti da hash)
- `connect-src 'self' https://vxzxdkcluyrcftsnxxza.supabase.co https://api.emailjs.com`
- `style-src 'self' 'unsafe-inline'` (CSS inline nel `<style>`; gli stili inline non sono
  un vettore XSS critico → `'unsafe-inline'` accettabile qui)
- `img-src 'self' data:` · `manifest-src 'self'` · `worker-src 'self'`
- `base-uri 'self'` · `object-src 'none'`

### Vincoli critici (da rispettare nell'implementazione)
- **Ordine di caricamento invariato:** React/ReactDOM UMD → inline costanti/`supabase` (riga 26)
  → `app.js`. `app.js` accede a `SUPABASE_URL`/`SB_HEADERS`/`supabase` come globali del
  *global lexical scope* condiviso tra classic script → `app.js` DEVE essere classic, non module.
- **Preset Babel corretti:** `preset-react` certo; valutare `preset-env` (target browser
  moderni). Equivalenza verificata empiricamente (vedi sotto), non per reverse-engineering.

### Flusso di lavoro nuovo
Modifica `src/app.jsx` (logica) o `app.html` (guscio/stili) → `node build.js` →
`npx serve . -p 4321` per provare → push. README/commento aggiornato.

## Verifica (rete di sicurezza)
1. **Suite E2E** dev'essere verde dopo la build (auth, messaggi 15, rituali 18, telepatia 28,
   coscienza, privacy, ecc.) — è la prova di equivalenza funzionale del compilato.
2. **Smoke manuale** dell'app servita (`npx serve`) + check console: nessun errore, nessuna
   violazione CSP (le violazioni CSP compaiono in console → utili per rifinire le direttive).
3. **PWA**: verificare che il nuovo `sw.js` (v2) si installi e che `app.js` sia in cache.
4. Push SOLO a suite verde + smoke ok (guardrail).

## Fuori scope
- Migrazione a React 19, bundler completi (Vite/webpack), minificazione spinta.
- Restrizioni anti-abuso EmailJS (raccomandazione #3 audit, separata).
- Altri item di backlog (B5/B9/I1).

## Rischi
- **Divergenza preset** → mitigata dalla suite E2E + smoke prima del push.
- **CSP troppo stretta rompe l'app** → si rifinisce leggendo le violazioni in console PRIMA
  del push; in caso, `report-only` come fallback temporaneo.
- **PWA cache vecchia** → bump `CACHE` a `v2` forza l'aggiornamento.
- **Live app** → nessun push finché E2E non è verde e lo smoke non è pulito.
