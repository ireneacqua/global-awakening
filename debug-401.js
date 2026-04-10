/**
 * Debug 401 — intercetta le richieste Supabase che ritornano 401
 * durante una sessione di telepatia (match + risultato).
 *
 * Esecuzione: node debug-401.js
 */

const { chromium } = require('playwright');

const APP_URL = 'http://localhost:4321/app.html';
const TIMEOUT = 25000;

function log(user, msg) {
  const ts = new Date().toLocaleTimeString('it-IT');
  console.log(`[${ts}] [${user}] ${msg}`);
}

async function loginAsGuest(page, nickname) {
  await page.goto(APP_URL);
  await page.waitForSelector('button:has-text("Ospite"), button:has-text("Guest")', { timeout: TIMEOUT });
  await page.locator('button:has-text("Ospite"), button:has-text("Guest")').first().click();
  await page.locator('input[placeholder*="username"], input[placeholder*="Username"]').first().fill(nickname);
  await page.locator('button:has-text("Entra come Ospite"), button:has-text("Enter as Guest")').click();
  await page.waitForSelector('button:has-text("Logout"), button:has-text("Esci")', { timeout: TIMEOUT });
}

async function goToTelepathy(page) {
  await page.locator('button').filter({ hasText: /Telepatia|Telepathy/ }).first().click();
  await page.waitForSelector('text=Telepathy Training', { timeout: TIMEOUT });
}

(async () => {
  console.log('\n═══════════════════════════════════════');
  console.log('  DEBUG 401 — intercetta richieste fallite');
  console.log('═══════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const errors401 = [];

  // Intercetta tutte le response su entrambe le pagine
  for (const [page, label] of [[pageA, 'A'], [pageB, 'B']]) {
    page.on('response', async (response) => {
      if (response.status() === 401) {
        const url = response.url();
        let body = '';
        try { body = await response.text(); } catch {}
        const entry = { label, url, body: body.substring(0, 200) };
        errors401.push(entry);
        console.log(`\n🚨 [Page${label}] 401 su: ${url}`);
        if (body) console.log(`   body: ${body.substring(0, 200)}`);
      }
    });
  }

  try {
    // Setup: login ospite per entrambi
    await Promise.all([
      loginAsGuest(pageA, 'DebugA'),
      loginAsGuest(pageB, 'DebugB'),
    ]);
    log('SETUP', 'Login completato per entrambi');

    await Promise.all([
      goToTelepathy(pageA),
      goToTelepathy(pageB),
    ]);

    // Abbinamento random
    await pageA.locator('button:has-text("Abbinamento Random"), button:has-text("Find Partner")').first().click();
    await pageA.waitForTimeout(500);
    await pageB.locator('button:has-text("Abbinamento Random"), button:has-text("Find Partner")').first().click();
    await Promise.all([
      pageA.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT }),
      pageB.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT }),
    ]);
    log('SETUP', 'Partner trovato — inizio round');

    // Determina ruoli
    const roleA = await pageA.locator('p.text-white.font-bold').filter({ hasText: /^Sender$|^Receiver$/ }).first().textContent();
    const senderPage   = roleA.trim() === 'Sender' ? pageA : pageB;
    const receiverPage = roleA.trim() === 'Sender' ? pageB : pageA;

    // Round completo
    log('ROUND', 'Sender seleziona e invia...');
    await senderPage.locator('.symbol-btn').first().click();
    await senderPage.locator('button:has-text("Invia Telepaticamente")').click();

    await receiverPage.waitForSelector('.symbol-btn', { timeout: TIMEOUT });
    await receiverPage.locator('.symbol-btn').first().click();
    await receiverPage.locator('button:has-text("Conferma")').click();

    log('ROUND', 'Aspetto risultato...');
    await Promise.race([
      pageA.waitForSelector(':text("MATCH TELEPATICO")', { timeout: TIMEOUT }),
      pageA.waitForSelector(':text("Non questa volta")', { timeout: TIMEOUT }),
    ]);
    log('ROUND', 'Risultato ricevuto');

    // Aspetta eventuali richieste post-risultato
    await pageA.waitForTimeout(6000);
    log('ROUND', 'Termina Sessione...');
    await pageA.locator('button:has-text("Termina Sessione")').click();
    await pageA.waitForTimeout(3000);

  } catch (err) {
    console.error('\nErrore durante il test:', err.message);
  } finally {
    console.log('\n═══════════════════════════════════════');
    console.log(`  TOTALE errori 401 catturati: ${errors401.length}`);
    if (errors401.length > 0) {
      console.log('\n  Dettaglio:');
      errors401.forEach((e, i) => {
        console.log(`\n  [${i + 1}] Page${e.label}`);
        console.log(`       URL:  ${e.url}`);
        if (e.body) console.log(`       Body: ${e.body}`);
      });
    } else {
      console.log('  Nessun 401 rilevato.');
    }
    console.log('═══════════════════════════════════════\n');
    await browser.close();
  }
})();
