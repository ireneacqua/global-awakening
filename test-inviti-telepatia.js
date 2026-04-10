/**
 * Test Inviti Telepatia — Global Awakening
 *
 * Copre:
 *   1. A naviga al tab Telepatia e vede B nella lista utenti
 *   2. A clicca "Proponi" — B riceve notifica nella campanella
 *   3. B clicca "Vai" → modal "Accetta/Rifiuta" appare subito (senza attendere polling)
 *   4. B accetta → entrambi nel training, tab Telepatia attivo
 *   5. A termina sessione → B vede "Sessione Completata" (non "Ancora")
 *   6. A invia secondo invito → B riceve notifica → B rifiuta
 *   7. A riceve notifica "ha rifiutato"
 *
 * Esecuzione: node test-inviti-telepatia.js
 * Prerequisiti: app su http://localhost:4321/app.html, npx playwright install chromium
 */

const { chromium } = require('playwright');

const APP_URL      = 'http://localhost:4321/app.html';
const SUPABASE_URL = 'https://vxzxdkcluyrcftsnxxza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4enhka2NsdXlyY2Z0c254eHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMzcyMTcsImV4cCI6MjA4NjkxMzIxN30.m_mzWHH1-ajVqeSFvuJAm8t5Kz7I7umcEKBrRPr5JXM';
const TIMEOUT      = 20000;
const POLL_WAIT    = 13000; // max attesa polling notifiche (ogni 10s)

const TS     = Date.now();
const NICK_A = `InvA_${TS}`;
const NICK_B = `InvB_${TS}`;

let passed = 0;
let failed = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; process.exitCode = 1; }
function log(who, msg) {
  const ts = new Date().toLocaleTimeString('it-IT');
  console.log(`[${ts}] [${who}] ${msg}`);
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

async function loginAsGuest(page, nick) {
  await page.goto(APP_URL);
  await page.waitForSelector('button:has-text("Ospite"), button:has-text("Guest")', { timeout: TIMEOUT });
  await page.locator('button:has-text("Ospite"), button:has-text("Guest")').first().click();
  await page.locator('input[placeholder*="username"], input[placeholder*="Username"]').first().fill(nick);
  await page.locator('button:has-text("Entra come Ospite"), button:has-text("Enter as Guest")').click();
  await page.waitForSelector('button:has-text("Logout"), button:has-text("Esci")', { timeout: TIMEOUT });
  log(nick, 'Login ospite completato');
}

async function goToTelepathy(page, nick) {
  await page.locator('button').filter({ hasText: /Telepatia|Telepathy/ }).first().click();
  await page.waitForSelector('text=Telepathy Training', { timeout: TIMEOUT });
  log(nick, 'Tab Telepatia aperto');
}

async function cleanup() {
  try {
    await sbFetch(`online_users?nickname=eq.${encodeURIComponent(NICK_A)}`, { method: 'DELETE' });
    await sbFetch(`online_users?nickname=eq.${encodeURIComponent(NICK_B)}`, { method: 'DELETE' });
    await sbFetch(`notifications?user_nickname=eq.${encodeURIComponent(NICK_A)}`, { method: 'DELETE' });
    await sbFetch(`notifications?user_nickname=eq.${encodeURIComponent(NICK_B)}`, { method: 'DELETE' });
    await sbFetch(`telepathy_invites?from_name=eq.${encodeURIComponent(NICK_A)}`, { method: 'DELETE' });
    await sbFetch(`telepathy_invites?from_name=eq.${encodeURIComponent(NICK_B)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('  Cleanup parzialmente fallito:', e.message);
  }
}

(async () => {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  TEST INVITI TELEPATIA — Global Awakening');
  console.log(`  Utenti: ${NICK_A} ↔ ${NICK_B}`);
  console.log('══════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  for (const [p, label] of [[pageA, 'BROWSER-A'], [pageB, 'BROWSER-B']]) {
    p.on('console', msg => { if (msg.type() === 'error') log(label, `error: ${msg.text()}`); });
  }

  try {
    // ── Setup ──────────────────────────────────────────────────────────────
    console.log('📋 Setup: login ospite per entrambi');
    await Promise.all([
      loginAsGuest(pageA, NICK_A),
      loginAsGuest(pageB, NICK_B),
    ]);

    // A va al tab Telepatia, B rimane in home (così riceve notifica sul campanello)
    await goToTelepathy(pageA, NICK_A);

    // ── Test 1: B compare nella lista utenti di A ─────────────────────────
    console.log(`\n📋 Test 1: ${NICK_B} compare nella lista utenti di A`);
    log(NICK_A, `Aspetto ${NICK_B} nella lista (polling presenza ogni 10s)...`);
    let proponiBtn = null;
    try {
      // Aspetta che B appaia nella lista utenti di A
      await pageA.waitForFunction(
        (nick) => {
          const spans = Array.from(document.querySelectorAll('span'));
          return spans.some(s => s.textContent.trim() === nick);
        },
        NICK_B,
        { timeout: POLL_WAIT }
      );
      // Trova il bottone "Proponi" nella riga di B
      const bRow = pageA.locator('div').filter({ has: pageA.locator(`span:text-is("${NICK_B}")`) }).first();
      proponiBtn = bRow.locator('button:has-text("Proponi")');
      await proponiBtn.waitFor({ timeout: 5000 });
      pass(`${NICK_B} visibile nella lista di ${NICK_A} con bottone "Proponi"`);
    } catch {
      fail(`${NICK_B} NON compare nella lista di ${NICK_A} entro ${POLL_WAIT / 1000}s`);
    }

    // ── Test 2: A invia invito a B ─────────────────────────────────────────
    console.log(`\n📋 Test 2: A invia invito a B`);
    await proponiBtn.click();
    log(NICK_A, 'Invito inviato');

    // "Invito inviato..." deve comparire nella riga di B
    await pageA.waitForTimeout(1000);
    const inviteSentText = await pageA.locator('span').filter({ hasText: 'Invito inviato' }).count();
    if (inviteSentText > 0) {
      pass('"Invito inviato..." visibile nella lista di A');
    } else {
      fail('"Invito inviato..." NON visibile nella lista di A');
    }

    // ── Test 3: B riceve notifica nella campanella ─────────────────────────
    console.log(`\n📋 Test 3: B riceve notifica nella campanella`);
    log(NICK_B, `Aspetto notifica campanella (max ${POLL_WAIT / 1000}s)...`);
    let notifBadge = pageB.locator('button').filter({ has: pageB.locator('span').filter({ hasText: /^[1-9]/ }) }).first();
    try {
      await notifBadge.waitFor({ timeout: POLL_WAIT });
      pass('Notifica (badge campanella) ricevuta da B');
    } catch {
      // Prova approccio alternativo: apre il pannello e cerca il testo direttamente
      log(NICK_B, 'Badge non rilevato — provo aprendo il pannello notifiche');
    }

    // Apri pannello notifiche di B
    await pageB.locator('button').filter({ hasText: /🔔|notif/i }).first().click().catch(async () => {
      // Cerca il bottone campanella in modo diverso
      const btns = await pageB.locator('button').all();
      for (const btn of btns) {
        const txt = await btn.textContent();
        if (txt && (txt.includes('🔔') || txt.match(/\d/))) {
          await btn.click();
          break;
        }
      }
    });
    await pageB.waitForTimeout(500);

    const inviteNotif = pageB.locator('span').filter({ hasText: /training telepatico|telepathy/i });
    try {
      await inviteNotif.waitFor({ timeout: 3000 });
      pass('Notifica invito telepatico visibile nel pannello di B');
    } catch {
      fail('Notifica invito telepatico NON trovata nel pannello di B');
    }

    // ── Test 4: B clicca "Vai" → modal appare subito ───────────────────────
    console.log('\n📋 Test 4: B clicca "Vai" → modal Accetta/Rifiuta appare immediatamente');
    const t0 = Date.now();
    await pageB.locator('button:has-text("Vai")').first().click();
    log(NICK_B, 'Cliccato "Vai"');

    try {
      await pageB.locator('button:has-text("Accetta")').waitFor({ timeout: 3000 });
      const elapsed = Date.now() - t0;
      pass(`Modal "Accetta/Rifiuta" apparso in ${elapsed}ms (< 3s — senza attendere polling)`);
    } catch {
      fail('Modal "Accetta/Rifiuta" NON apparso entro 3s dopo "Vai"');
    }

    // ── Test 5: B accetta → entrambi nel training ──────────────────────────
    console.log('\n📋 Test 5: B accetta → entrambi nel training (tab Telepatia attivo)');
    await pageB.locator('button:has-text("Accetta")').click();
    log(NICK_B, 'Invito accettato');

    // B deve essere nel tab Telepatia con il training attivo
    try {
      await pageB.waitForSelector('text=Telepathy Training', { timeout: TIMEOUT });
      pass('B nel tab Telepatia dopo aver accettato');
    } catch {
      fail('B NON nel tab Telepatia dopo aver accettato');
    }

    // A deve aver trovato il match (via polling sendDirectInvite)
    try {
      await pageA.waitForFunction(
        () => document.querySelector('text=Il tuo ruolo') !== null ||
              document.body.innerText.includes('Il tuo ruolo') ||
              document.body.innerText.includes('Your role') ||
              document.body.innerText.includes('Sender') ||
              document.body.innerText.includes('Mittente'),
        { timeout: TIMEOUT }
      );
      pass('A nel training telepatico (ruolo assegnato)');
    } catch {
      // Verifica alternativa: A ha partner settato (sessione attiva)
      const hasPartner = await pageA.locator('button:has-text("Termina Sessione")').count();
      if (hasPartner > 0) {
        pass('A nel training telepatico (bottone "Termina Sessione" visibile)');
      } else {
        fail('A NON nel training telepatico dopo che B ha accettato');
      }
    }

    // ── Test 6: A termina sessione → B vede "Sessione Completata" ─────────
    console.log('\n📋 Test 6: A termina sessione → B NON vede "Ancora"');
    const terminaBtn = pageA.locator('button:has-text("Termina Sessione")');
    try {
      await terminaBtn.waitFor({ timeout: TIMEOUT });
      await terminaBtn.click();
      log(NICK_A, '"Termina Sessione" cliccato');
    } catch {
      fail('Bottone "Termina Sessione" non trovato su A');
    }

    // B deve vedere "Sessione Completata" e NON il bottone "Ancora"
    await pageB.waitForTimeout(7000); // attesa max checkPartnerLeft (5s)

    const sessionEndedB = await pageB.locator('h3').filter({ hasText: /Sessione Completata|Session Complete/ }).count();
    if (sessionEndedB > 0) {
      pass('B vede "Sessione Completata" dopo che A ha terminato');
    } else {
      fail('B NON vede "Sessione Completata" dopo che A ha terminato');
    }

    const ancoraBtn = await pageB.locator('button:has-text("Ancora")').count();
    if (ancoraBtn === 0) {
      pass('Bottone "Ancora" NON disponibile per B (corretto)');
    } else {
      fail('Bottone "Ancora" ancora visibile per B — bug non risolto');
    }

    // ── Test 7: A invia secondo invito → B riceve → B rifiuta ────────────
    console.log('\n📋 Test 7: Secondo invito → B rifiuta → A riceve notifica');
    // A torna alla lobby
    await pageA.locator('button:has-text("Torna alla Lobby"), button:has-text("Torna alla lobby")').first().click();
    log(NICK_A, 'Tornato alla lobby');
    await pageA.waitForTimeout(1000);

    // A invia secondo invito
    const bRow2 = pageA.locator('div').filter({ has: pageA.locator(`span:text-is("${NICK_B}")`) }).first();
    const proponi2 = bRow2.locator('button:has-text("Proponi")');
    try {
      await proponi2.waitFor({ timeout: POLL_WAIT });
      await proponi2.click();
      log(NICK_A, 'Secondo invito inviato');
      pass('A ha inviato il secondo invito');
    } catch {
      fail('A non riesce ad inviare il secondo invito');
    }

    // B riceve la notifica del secondo invito (è ancora sulla schermata "Sessione Completata")
    log(NICK_B, `Aspetto seconda notifica (max ${POLL_WAIT / 1000}s)...`);
    try {
      await pageB.waitForFunction(
        () => document.body.innerText.includes('training telepatico'),
        { timeout: POLL_WAIT }
      );
    } catch {}

    // Apri pannello notifiche di B e clicca "Vai"
    await pageB.locator('button').nth(0).click().catch(() => {});
    await pageB.waitForTimeout(500);
    const vaiBtn2 = pageB.locator('button:has-text("Vai")');
    try {
      await vaiBtn2.waitFor({ timeout: 3000 });
      await vaiBtn2.click();
      log(NICK_B, 'Cliccato "Vai" su secondo invito');
    } catch {
      fail('B non ha ricevuto il secondo invito nella campanella');
    }

    // Modal deve apparire — B rifiuta
    try {
      await pageB.locator('button:has-text("Rifiuta")').waitFor({ timeout: 5000 });
      await pageB.locator('button:has-text("Rifiuta")').click();
      log(NICK_B, 'Invito rifiutato');
      pass('B ha rifiutato il secondo invito');
    } catch {
      fail('Modal Accetta/Rifiuta non apparso per secondo invito');
    }

    // A riceve notifica "ha rifiutato"
    log(NICK_A, `Aspetto notifica rifiuto (max ${POLL_WAIT / 1000}s)...`);
    try {
      await pageA.waitForFunction(
        () => document.body.innerText.includes('rifiutato'),
        { timeout: POLL_WAIT }
      );
      pass('A riceve notifica "ha rifiutato il tuo invito"');
    } catch {
      // Verifica diretta nel DB
      const notifs = await sbFetch(`notifications?user_nickname=eq.${encodeURIComponent(NICK_A)}&type=eq.telepathy_declined&select=message`);
      if (notifs && notifs.length > 0) {
        pass(`A ha notifica rifiuto in DB: "${notifs[0].message}"`);
      } else {
        fail('A NON ha ricevuto notifica di rifiuto');
      }
    }

  } catch (err) {
    fail(`Errore imprevisto: ${err.message}`);
    console.error(err);
  } finally {
    console.log('\n  (Pulizia dati test da Supabase...)');
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
