/**
 * Debug CORS su telepathy_invites — intercetta ogni request/response
 * sulle chiamate a telepathy_invites e logga status, headers, body.
 *
 * Esecuzione: node debug-cors.js
 */

const { chromium } = require('playwright');

const APP_URL = 'http://localhost:4321/app.html';
const TIMEOUT = 25000;

function ts() { return new Date().toLocaleTimeString('it-IT'); }

async function loginAsGuest(page, nick) {
  await page.goto(APP_URL);
  await page.waitForSelector('button:has-text("Ospite"), button:has-text("Guest")', { timeout: TIMEOUT });
  await page.locator('button:has-text("Ospite"), button:has-text("Guest")').first().click();
  await page.locator('input[placeholder*="username"], input[placeholder*="Username"]').first().fill(nick);
  await page.locator('button:has-text("Entra come Ospite"), button:has-text("Enter as Guest")').click();
  await page.waitForSelector('button:has-text("Logout"), button:has-text("Esci")', { timeout: TIMEOUT });
}

(async () => {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  DEBUG CORS — telepathy_invites request detail');
  console.log('═══════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // Intercetta ogni request a telepathy_invites su pageA
  pageA.on('request', req => {
    if (req.url().includes('telepathy_invites')) {
      console.log(`\n[${ts()}] ▶ REQUEST  ${req.method()} ${req.url()}`);
    }
  });

  pageA.on('response', async resp => {
    if (resp.url().includes('telepathy_invites')) {
      let body = '';
      try { body = await resp.text(); } catch {}
      const status = resp.status();
      const ok = status >= 200 && status < 300;
      const icon = ok ? '✅' : '❌';
      console.log(`[${ts()}] ${icon} RESPONSE ${status} ${resp.url()}`);
      if (!ok || body) console.log(`         body: ${body.substring(0, 300)}`);
    }
  });

  // Cattura richieste fallite (CORS/network error)
  pageA.on('requestfailed', req => {
    if (req.url().includes('telepathy_invites')) {
      console.log(`\n[${ts()}] 🚨 REQUEST FAILED`);
      console.log(`         URL:    ${req.url()}`);
      console.log(`         Method: ${req.method()}`);
      console.log(`         Reason: ${req.failure()?.errorText}`);
    }
  });

  try {
    await Promise.all([
      loginAsGuest(pageA, 'CorsA'),
      loginAsGuest(pageB, 'CorsB'),
    ]);

    // Tab Telepatia
    for (const p of [pageA, pageB]) {
      await p.locator('button').filter({ hasText: /Telepatia|Telepathy/ }).first().click();
      await p.waitForSelector('text=Telepathy Training', { timeout: TIMEOUT });
    }

    // Abbinamento
    await pageA.locator('button:has-text("Abbinamento Random"), button:has-text("Find Partner")').first().click();
    await pageA.waitForTimeout(500);
    await pageB.locator('button:has-text("Abbinamento Random"), button:has-text("Find Partner")').first().click();
    await Promise.all([
      pageA.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT }),
      pageB.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT }),
    ]);
    console.log(`\n[${ts()}] Partner trovato — aspetto 30s di polling per osservare le chiamate...`);

    // Aspetta abbastanza a lungo da vedere almeno 2-3 cicli di updatePresence (ogni 10s)
    await pageA.waitForTimeout(35000);

  } catch (err) {
    console.error('Errore:', err.message);
  } finally {
    console.log('\n═══════════════════════════════════════════════');
    console.log('  Fine osservazione');
    console.log('═══════════════════════════════════════════════\n');
    await browser.close();
  }
})();
