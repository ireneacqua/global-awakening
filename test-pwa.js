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
  const swr = await fetch(`${BASE}/sw.js`);
  if (swr.ok) pass('sw.js raggiungibile'); else fail(`sw.js HTTP ${swr.status}`);

  // 2. pagina: no pageerror, link manifest, SW registrato
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/app.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(':text("Register"), input', { timeout: 20000 }).catch(() => {});
  const hasManifest = await page.locator('link[rel="manifest"]').count();
  if (hasManifest > 0) pass('<link rel=manifest> presente'); else fail('manca <link rel=manifest>');
  // attende la registrazione del SW (avviene su window load)
  const reg = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    try { const r = await navigator.serviceWorker.ready; return !!r; } catch { return false; }
  }).catch(() => false);
  if (reg) pass('service worker registrato e attivo'); else fail('service worker NON registrato');
  if (errors.length === 0) pass('nessun pageerror'); else fail('pageerror: ' + errors.join(' | '));
  await browser.close();
  console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
})();
