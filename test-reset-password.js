/**
 * Test Reset Password — Global Awakening
 *
 * Copre:
 *   1. Registrazione utente con email + password
 *   2. Logout
 *   3. Apertura form "Password dimenticata?"
 *   4. Reset con nickname errato → errore
 *   5. Reset con password non coincidenti → errore
 *   6. Reset corretto (email + nickname giusti) → successo
 *   7. Login con la nuova password → accesso riuscito
 *
 * Esecuzione: node test-reset-password.js
 * Prerequisiti: app su http://localhost:4321/app.html, npx playwright install chromium
 */

const { chromium } = require('playwright');

const APP_URL      = 'http://localhost:4321/app.html';
const SUPABASE_URL = 'https://vxzxdkcluyrcftsnxxza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4enhka2NsdXlyY2Z0c254eHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMzcyMTcsImV4cCI6MjA4NjkxMzIxN30.m_mzWHH1-ajVqeSFvuJAm8t5Kz7I7umcEKBrRPr5JXM';
const TIMEOUT      = 20000;

const TS       = Date.now();
const NICK     = `ResetUser_${TS}`;
const EMAIL    = `reset_${TS}@test.ga`;
const PW1      = 'Password123!';
const PW2      = 'NuovaPassword456!';

let passed = 0;
let failed = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; process.exitCode = 1; }
function log(msg) {
  const ts = new Date().toLocaleTimeString('it-IT');
  console.log(`[${ts}] ${msg}`);
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...opts.headers,
    },
    ...opts,
  });
  if (res.status === 204) return null;
  try { return await res.json(); } catch { return null; }
}

async function cleanup() {
  try {
    await sbFetch(`profiles?email=eq.${encodeURIComponent(EMAIL)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('  Cleanup parzialmente fallito:', e.message);
  }
}

(async () => {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  TEST RESET PASSWORD — Global Awakening');
  console.log(`  Utente: ${NICK} / ${EMAIL}`);
  console.log('══════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type() === 'error') log(`browser error: ${msg.text()}`); });

  try {
    // ── Step 1: Registra utente ───────────────────────────────────────────
    console.log('📋 Step 1: Registrazione utente');
    await page.goto(APP_URL);
    await page.waitForSelector('button:has-text("Registrati"), button:has-text("Register")', { timeout: TIMEOUT });
    await page.locator('button:has-text("Registrati"), button:has-text("Register")').first().click();

    await page.locator('input[placeholder*="username"], input[placeholder*="Username"]').first().fill(NICK);
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PW1);
    await page.locator('button:has-text("Registrati"), button:has-text("Register")').last().click();

    await page.waitForSelector('button:has-text("Logout"), button:has-text("Esci")', { timeout: TIMEOUT });
    pass('Registrazione completata — utente loggato');

    // ── Step 2: Logout ────────────────────────────────────────────────────
    console.log('\n📋 Step 2: Logout');
    await page.locator('button:has-text("Logout"), button:has-text("Esci")').click();
    await page.waitForSelector('button:has-text("Ospite"), button:has-text("Guest")', { timeout: TIMEOUT });
    pass('Logout riuscito — schermata login visibile');

    // ── Step 3: Apertura form reset ────────────────────────────────────────
    console.log('\n📋 Step 3: Apertura form "Password dimenticata?"');
    await page.locator('button:has-text("Accedi"), button:has-text("Login")').first().click();
    const forgotLink = page.locator('p').filter({ hasText: /Password dimenticata|Forgot password/ });
    await forgotLink.waitFor({ timeout: TIMEOUT });
    await forgotLink.click();
    const resetTitle = await page.locator('p').filter({ hasText: /Reimposta Password|Reset Password/ }).count();
    if (resetTitle > 0) {
      pass('Form "Password dimenticata" aperto');
    } else {
      fail('Form reset non visibile');
    }

    // ── Step 4: Errore con nickname sbagliato ─────────────────────────────
    console.log('\n📋 Step 4: Reset con nickname errato → errore atteso');
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="text"]').first().fill('NicknameErrato');
    const pwInputs = page.locator('input[type="password"]');
    await pwInputs.nth(0).fill(PW2);
    await pwInputs.nth(1).fill(PW2);
    await page.locator('button').filter({ hasText: /Reimposta|Reset Password/ }).last().click();

    await page.waitForTimeout(2000);
    const errorMsg = await page.locator('p').filter({ hasText: /non trovato|not found/i }).count();
    if (errorMsg > 0) {
      pass('Errore corretto mostrato con nickname sbagliato');
    } else {
      fail('Errore atteso non mostrato con nickname sbagliato');
    }

    // ── Step 5: Errore con password non coincidenti ────────────────────────
    console.log('\n📋 Step 5: Reset con password non coincidenti → errore atteso');
    await page.locator('input[type="text"]').first().fill(NICK);
    await pwInputs.nth(0).fill(PW2);
    await pwInputs.nth(1).fill('DiversaDaConfirm!');
    await page.locator('button').filter({ hasText: /Reimposta|Reset Password/ }).last().click();

    await page.waitForTimeout(1000);
    const pwMismatch = await page.locator('p').filter({ hasText: /non coincidono|do not match/i }).count();
    if (pwMismatch > 0) {
      pass('Errore "password non coincidono" mostrato correttamente');
    } else {
      fail('Errore password mismatch non mostrato');
    }

    // ── Step 6: Reset corretto ─────────────────────────────────────────────
    console.log('\n📋 Step 6: Reset corretto (email + nickname validi)');
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="text"]').first().fill(NICK);
    await pwInputs.nth(0).fill(PW2);
    await pwInputs.nth(1).fill(PW2);
    await page.locator('button').filter({ hasText: /Reimposta|Reset Password/ }).last().click();

    try {
      await page.locator('p').filter({ hasText: /aggiornata|updated/i }).waitFor({ timeout: 5000 });
      pass('Messaggio di successo reset visibile');
    } catch {
      fail('Messaggio di successo reset NON visibile');
    }

    // Attende redirect automatico al login (2.5s)
    await page.waitForTimeout(3000);

    // ── Step 7: Login con nuova password ──────────────────────────────────
    console.log('\n📋 Step 7: Login con la nuova password');
    // Deve essere tornato al form login
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PW2);
    await page.locator('button:has-text("Accedi"), button:has-text("Login")').last().click();

    try {
      await page.waitForSelector('button:has-text("Logout"), button:has-text("Esci")', { timeout: TIMEOUT });
      pass('Login con nuova password riuscito');
    } catch {
      fail('Login con nuova password FALLITO');
    }

    // Verifica che la vecchia password non funzioni più
    console.log('\n📋 Step 8: Verifica vecchia password non funziona');
    await page.locator('button:has-text("Logout"), button:has-text("Esci")').click();
    await page.waitForSelector('button:has-text("Ospite"), button:has-text("Guest")', { timeout: TIMEOUT });
    await page.locator('button:has-text("Accedi"), button:has-text("Login")').first().click();
    await page.locator('input[type="email"]').first().fill(EMAIL);
    await page.locator('input[type="password"]').first().fill(PW1); // vecchia password
    await page.locator('button:has-text("Accedi"), button:has-text("Login")').last().click();
    await page.waitForTimeout(2000);
    const loginErr = await page.locator('p').filter({ hasText: /errata|wrong/i }).count();
    if (loginErr > 0) {
      pass('Vecchia password rifiutata correttamente');
    } else {
      fail('Vecchia password accettata — reset non ha funzionato correttamente');
    }

  } catch (err) {
    fail(`Errore imprevisto: ${err.message}`);
    console.error(err);
  } finally {
    console.log('\n  (Pulizia profilo test da Supabase...)');
    await cleanup();

    console.log('\n══════════════════════════════════════════════════');
    const totale = passed + failed;
    console.log(`  ${passed}/${totale} test passati`);
    console.log(process.exitCode === 1
      ? '  RISULTATO: ❌ FALLITO'
      : '  RISULTATO: ✅ PASSATO');
    console.log('══════════════════════════════════════════════════\n');

    await browser.close();
  }
})();
