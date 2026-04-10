/**
 * Test tab Coscienza — Global Awakening
 *
 * Copre:
 *   - Apertura tab Coscienza e titolo feed
 *   - Pubblicazione post e visibilità immediata (A)
 *   - Visibilità post da parte di B (via polling ~10s)
 *   - Apertura commenti su un post
 *   - Commento di B e visibilità immediata in UI di B
 *   - A vede il commento di B (fresh SELECT)
 *   - Verifica in Supabase di post e commenti
 *   - Sezione Mappa (Global Network) visibile
 *   - Community list mostra utenti online
 *
 * Esecuzione: node test-coscienza.js
 * Prerequisiti: app su http://localhost:4321/app.html, npx playwright install chromium
 */

const { chromium } = require('playwright');

const APP_URL      = 'http://localhost:4321/app.html';
const SUPABASE_URL = 'https://vxzxdkcluyrcftsnxxza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4enhka2NsdXlyY2Z0c254eHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMzcyMTcsImV4cCI6MjA4NjkxMzIxN30.m_mzWHH1-ajVqeSFvuJAm8t5Kz7I7umcEKBrRPr5JXM';
const TIMEOUT      = 20000;
const POLL_WAIT    = 13000;

const TS      = Date.now();
const NICK_A  = `CosA_${TS}`;
const NICK_B  = `CosB_${TS}`;

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
  log(nick, 'Login come ospite completato');
}

async function goToConsciousness(page, nick) {
  await page.locator('button').filter({ hasText: /Coscienza|Consciousness/ }).first().click();
  await page.waitForSelector('h2:has-text("Feed Coscienza"), h2:has-text("Consciousness Feed")', { timeout: TIMEOUT });
  log(nick, 'Tab Coscienza aperto');
}

async function cleanup() {
  try {
    await sbFetch(`consciousness_posts?author_nickname=eq.${encodeURIComponent(NICK_A)}`, { method: 'DELETE' });
    await sbFetch(`consciousness_posts?author_nickname=eq.${encodeURIComponent(NICK_B)}`, { method: 'DELETE' });
    await sbFetch(`consciousness_comments?author_nickname=eq.${encodeURIComponent(NICK_A)}`, { method: 'DELETE' });
    await sbFetch(`consciousness_comments?author_nickname=eq.${encodeURIComponent(NICK_B)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('  Cleanup parzialmente fallito:', e.message);
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  TEST COSCIENZA — Global Awakening');
  console.log(`  Utenti: ${NICK_A} ↔ ${NICK_B}`);
  console.log('══════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  for (const [p, label] of [[pageA, 'BROWSER-A'], [pageB, 'BROWSER-B']]) {
    p.on('console', msg => { if (msg.type() === 'error') log(label, `error: ${msg.text()}`); });
  }

  const POST_TEXT    = `Post di test da ${NICK_A} — ${TS}`;
  const COMMENT_TEXT = `Commento di ${NICK_B} — ${TS}`;

  try {
    // ── Setup ──────────────────────────────────────────────────────────────
    console.log('📋 Setup: login e navigazione');
    await Promise.all([
      loginAsGuest(pageA, NICK_A),
      loginAsGuest(pageB, NICK_B),
    ]);
    await Promise.all([
      goToConsciousness(pageA, NICK_A),
      goToConsciousness(pageB, NICK_B),
    ]);

    // ── Test 1: Titolo e struttura tab ────────────────────────────────────
    console.log('\n📋 Test 1: Titolo tab Coscienza visibile per entrambi');
    const titleA = await pageA.locator('h2').filter({ hasText: /Feed Coscienza|Consciousness Feed/ }).count();
    const titleB = await pageB.locator('h2').filter({ hasText: /Feed Coscienza|Consciousness Feed/ }).count();
    if (titleA > 0 && titleB > 0) {
      pass('Titolo "Feed Coscienza" visibile per entrambi');
    } else {
      fail(`Titolo mancante — A:${titleA} B:${titleB}`);
    }

    // Verifica textarea e bottone "Pubblica" presenti
    const textareaA = await pageA.locator('textarea').count();
    const publishBtn = await pageA.locator('button:has-text("Pubblica"), button:has-text("Post")').first().count();
    if (textareaA > 0 && publishBtn > 0) {
      pass('Textarea e bottone "Pubblica" presenti');
    } else {
      fail(`Form post mancante — textarea:${textareaA} btn:${publishBtn}`);
    }

    // ── Test 2: Bottone "Pubblica" disabilitato con textarea vuota ─────────
    console.log('\n📋 Test 2: Bottone "Pubblica" disabilitato se textarea vuota');
    const btnDisabled = await pageA.locator('button:has-text("Pubblica"), button:has-text("Post")').first().isDisabled();
    if (btnDisabled) {
      pass('Bottone "Pubblica" disabilitato con textarea vuota');
    } else {
      fail('Bottone "Pubblica" NON disabilitato con textarea vuota');
    }

    // ── Test 3: A pubblica un post → appare subito in UI ──────────────────
    console.log('\n📋 Test 3: A pubblica un post');
    await pageA.locator('textarea').first().fill(POST_TEXT);
    const btnEnabled = await pageA.locator('button:has-text("Pubblica"), button:has-text("Post")').first().isEnabled();
    if (btnEnabled) {
      pass('Bottone "Pubblica" si abilita dopo aver scritto');
    } else {
      fail('Bottone "Pubblica" rimane disabilitato dopo input');
    }

    await pageA.locator('button:has-text("Pubblica"), button:has-text("Post")').first().click();
    log(NICK_A, `Post pubblicato: "${POST_TEXT.substring(0, 40)}..."`);

    // Post deve apparire subito (fix .select() aggiunto)
    try {
      await pageA.locator('div.bg-glass').filter({ hasText: POST_TEXT.substring(0, 30) }).waitFor({ timeout: 5000 });
      pass('Post appare subito in UI di A (aggiornamento locale)');
    } catch {
      fail('Post NON appare entro 5s in UI di A');
    }

    // Textarea deve essere vuota dopo invio (polling sul DOM per evitare race con React)
    const textareaCleared = await pageA.waitForFunction(
      () => { const ta = document.querySelector('textarea'); return ta && ta.value === ''; },
      { timeout: 3000 }
    ).then(() => true).catch(() => false);
    if (textareaCleared) {
      pass('Textarea svuotata dopo pubblicazione');
    } else {
      fail('Textarea non svuotata dopo pubblicazione');
    }

    // ── Test 4: B vede il post di A ───────────────────────────────────────
    console.log('\n📋 Test 4: B vede il post di A');
    log(NICK_B, `Aspetto il post di ${NICK_A} (max ${POLL_WAIT / 1000}s)...`);
    try {
      await pageB.locator('div.bg-glass').filter({ hasText: POST_TEXT.substring(0, 30) }).waitFor({ timeout: POLL_WAIT });
      pass(`${NICK_B} vede il post di ${NICK_A}`);
    } catch {
      fail(`${NICK_B} NON vede il post di ${NICK_A} dopo ${POLL_WAIT / 1000}s`);
    }

    // Verifica DB
    await pageA.waitForTimeout(1000);
    const postsDB = await sbFetch(`consciousness_posts?author_nickname=eq.${encodeURIComponent(NICK_A)}&select=id,content`);
    let postId = null;
    if (postsDB && postsDB.length > 0) {
      postId = postsDB[0].id;
      pass(`Post trovato in DB — id: ${postId}`);
    } else {
      fail('Post NON trovato in Supabase');
    }

    // ── Test 5: B apre commenti e scrive un commento ──────────────────────
    console.log('\n📋 Test 5: B apre commenti e scrive un commento');
    const postCardB = pageB.locator('div.bg-glass').filter({ hasText: POST_TEXT.substring(0, 30) }).first();
    const commentsToggleB = postCardB.locator('button.btn-secondary').filter({ hasText: /commenti|comments/ }).first();
    await commentsToggleB.click();
    log(NICK_B, 'Sezione commenti aperta');

    const commentInputB = postCardB.locator('input[placeholder*="commento"], input[placeholder*="comment"]').first();
    await commentInputB.waitFor({ timeout: TIMEOUT });
    await commentInputB.fill(COMMENT_TEXT);
    await commentInputB.press('Enter');
    log(NICK_B, `Commento inviato: "${COMMENT_TEXT}"`);

    // Commento deve apparire subito in UI di B (fix .select() aggiunto)
    await pageB.waitForTimeout(1500);
    const commentInB = await postCardB.locator('p').filter({ hasText: COMMENT_TEXT.substring(0, 20) }).count();
    if (commentInB > 0) {
      pass('Commento appare subito in UI di B');
    } else {
      fail('Commento NON appare in UI di B dopo invio');
    }

    // Input svuotato
    const commentInputValue = await commentInputB.inputValue();
    if (!commentInputValue) {
      pass('Input commento svuotato dopo invio');
    } else {
      fail('Input commento non svuotato dopo invio');
    }

    // ── Test 6: Verifica commento in Supabase ─────────────────────────────
    console.log('\n📋 Test 6: Commento salvato in Supabase');
    const commentsDB = await sbFetch(`consciousness_comments?author_nickname=eq.${encodeURIComponent(NICK_B)}&select=content,post_id`);
    if (commentsDB && commentsDB.length > 0) {
      pass(`Commento trovato in DB: "${commentsDB[0].content.substring(0, 40)}"`);
    } else {
      fail('Commento NON trovato in Supabase');
    }

    // ── Test 7: A vede il commento di B ───────────────────────────────────
    console.log('\n📋 Test 7: A vede il commento di B');
    // Usa locator con has: per trovare la card del post specifico di A
    const postCardA = pageA.locator('div.bg-glass').filter({
      has: pageA.locator('p.text-white', { hasText: POST_TEXT.substring(0, 25) })
    }).first();
    // Prendi il primo btn-secondary nella card (è sempre il toggle commenti)
    const commentsToggleA = postCardA.locator('button.btn-secondary').first();
    await pageA.waitForTimeout(500); // stabilizza dopo poll
    await commentsToggleA.click();
    log(NICK_A, 'Sezione commenti aperta');

    // Fresh SELECT da DB — deve trovare il commento di B
    await pageA.waitForTimeout(2000);
    const commentInA = await postCardA.locator('p').filter({ hasText: COMMENT_TEXT.substring(0, 20) }).count();
    if (commentInA > 0) {
      pass(`${NICK_A} vede il commento di ${NICK_B}`);
    } else {
      fail(`${NICK_A} NON vede il commento di ${NICK_B}`);
    }

    // Verifica counter commenti nel bottone toggle
    await commentsToggleA.click(); // chiudi
    await pageA.waitForTimeout(500);
    await commentsToggleA.click(); // riapri — ora deve mostrare count
    await pageA.waitForTimeout(1000);
    const toggleText = await commentsToggleA.textContent();
    if (toggleText && toggleText.includes('(')) {
      pass(`Bottone toggle mostra counter commenti: "${toggleText.trim()}"`);
    } else {
      fail(`Bottone toggle non mostra counter — testo: "${toggleText?.trim()}"`);
    }

    // ── Test 8: Sezione Mappa (Global Network) visibile ───────────────────
    console.log('\n📋 Test 8: Sezione Mappa (Global Network)');
    const mapTitleA = await pageA.locator('h2').filter({ hasText: /Rete Globale|Global Network/ }).count();
    if (mapTitleA > 0) {
      pass('Sezione "Rete Globale" visibile nel tab Coscienza');
    } else {
      fail('Sezione "Rete Globale" NON trovata');
    }

    // Mappa SVG presente
    const mapContainer = await pageA.locator('.map-container').count();
    if (mapContainer > 0) {
      pass('Mappa SVG (.map-container) presente');
    } else {
      fail('Mappa SVG (.map-container) non trovata');
    }

    // ── Test 9: Community list visibile ───────────────────────────────────
    console.log('\n📋 Test 9: Community list visibile');
    const communityLabel = await pageA.locator('h3').filter({ hasText: /Community|Comunita/ }).count();
    if (communityLabel > 0) {
      pass('Label "Community" visibile nella sezione mappa');
    } else {
      fail('Label "Community" non trovata');
    }

    // Contatore starseeds presenti
    const starseedsText = await pageA.locator('span').filter({ hasText: /starseeds/ }).count();
    if (starseedsText > 0) {
      pass('Contatore starseeds visibili presente');
    } else {
      fail('Contatore starseeds non trovato');
    }

  } catch (err) {
    fail(`Errore imprevisto: ${err.message}`);
    console.error(err);
  } finally {
    console.log('\n  (Pulizia post e commenti test da Supabase...)');
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
