/**
 * Test automatico della funzionalità Telepatia
 * Usa Playwright per simulare due utenti in parallelo.
 *
 * Esecuzione:
 *   node test-telepathy.js
 *
 * Prerequisiti:
 *   - App in esecuzione su http://localhost:4321/app.html
 *   - npx playwright install chromium
 */

const { chromium } = require('playwright');

const APP_URL = 'http://localhost:4321/app.html';
const SUPABASE_URL = 'https://vxzxdkcluyrcftsnxxza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4enhka2NsdXlyY2Z0c254eHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMzcyMTcsImV4cCI6MjA4NjkxMzIxN30.m_mzWHH1-ajVqeSFvuJAm8t5Kz7I7umcEKBrRPr5JXM';
const TIMEOUT = 25000;

function log(user, msg) {
  const ts = new Date().toLocaleTimeString('it-IT');
  console.log(`[${ts}] [${user}] ${msg}`);
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); process.exitCode = 1; }

async function loginAsGuest(page, nickname) {
  await page.goto(APP_URL);
  await page.waitForSelector('button:has-text("Ospite"), button:has-text("Guest")', { timeout: TIMEOUT });

  // Clicca tab Ospite (potrebbe già essere attivo)
  const guestTab = page.locator('button:has-text("Ospite"), button:has-text("Guest")').first();
  await guestTab.click();

  // Inserisci nickname
  await page.locator('input[placeholder*="username"], input[placeholder*="Username"]').first().fill(nickname);

  // Entra
  await page.locator('button:has-text("Entra come Ospite"), button:has-text("Enter as Guest")').click();

  // Aspetta che la schermata di login sparisca
  await page.waitForSelector('button:has-text("Logout"), button:has-text("Esci")', { timeout: TIMEOUT });
  log(nickname, `Login come ospite completato`);
}

async function goToTelepathy(page, nickname) {
  const tab = page.locator('button').filter({ hasText: /Telepatia|Telepathy/ }).first();
  await tab.click();
  await page.waitForSelector('text=Telepathy Training', { timeout: TIMEOUT });
  log(nickname, `Tab Telepatia aperto`);
}

async function clickFindPartner(page, nickname) {
  const btn = page.locator('button:has-text("Abbinamento Random"), button:has-text("Find Partner")').first();
  await btn.click();
  log(nickname, `Cliccato "Abbinamento Random"`);
}

async function waitForPartnerFound(page, nickname) {
  await page.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT });
  log(nickname, `Partner trovato!`);
}

async function getRole(page) {
  await page.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT });
  // Il ruolo è nel paragrafo immediatamente dopo "Il tuo ruolo"
  const roleEl = page.locator('p.text-white.font-bold').filter({ hasText: /^Sender$|^Receiver$/ }).first();
  const text = await roleEl.textContent({ timeout: TIMEOUT });
  return text.trim();
}

async function sendSymbol(page, nickname) {
  // Sceglie il primo simbolo disponibile
  const symbols = page.locator('.symbol-btn').first();
  await symbols.click();
  log(nickname, `Simbolo selezionato`);

  await page.locator('button:has-text("Invia Telepaticamente")').click();
  log(nickname, `Simbolo inviato`);
}

async function guessSymbol(page, nickname) {
  // Indovina il primo simbolo (potrebbe essere sbagliato, ma testa il flusso)
  await page.waitForSelector('.symbol-btn', { timeout: TIMEOUT });
  const symbols = page.locator('.symbol-btn').first();
  await symbols.click();
  log(nickname, `Simbolo indovinato (tentativo)`);

  await page.locator('button:has-text("Conferma")').click();
  log(nickname, `Risposta inviata`);
}

async function waitForResult(page, nickname) {
  await Promise.race([
    page.waitForSelector(':text("MATCH TELEPATICO")', { timeout: TIMEOUT }),
    page.waitForSelector(':text("Non questa volta")', { timeout: TIMEOUT }),
  ]);
  const matched = await page.locator(':text("MATCH TELEPATICO")').count() > 0;
  log(nickname, `Risultato: ${matched ? '✨ MATCH TELEPATICO!' : 'Non questa volta'}`);
  return matched;
}

async function clickAncora(page, nickname) {
  await page.locator('button:has-text("Ancora")').click();
  log(nickname, `Cliccato "Ancora"`);
}

async function clickTerminaSessione(page, nickname) {
  await page.locator('button:has-text("Termina Sessione")').click();
  log(nickname, `Cliccato "Termina Sessione"`);
}

async function waitForLobby(page, nickname) {
  await page.waitForSelector('button:has-text("Abbinamento Random"), button:has-text("Find Partner")', { timeout: TIMEOUT });
  log(nickname, `Tornato in lobby`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST TELEPATIA — Global Awakening');
  console.log('═══════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false, slowMo: 300 });

  // Due contesti separati = due "utenti" indipendenti
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // ── Test 1: Login ──────────────────────────────────────────────────────
    console.log('📋 Test 1: Login come ospite');
    await Promise.all([
      loginAsGuest(pageA, 'TestUserA'),
      loginAsGuest(pageB, 'TestUserB'),
    ]);
    pass('Entrambi gli utenti hanno fatto login');

    // ── Test 2: Navigazione Telepatia ──────────────────────────────────────
    console.log('\n📋 Test 2: Apertura tab Telepatia');
    await Promise.all([
      goToTelepathy(pageA, 'TestUserA'),
      goToTelepathy(pageB, 'TestUserB'),
    ]);
    pass('Entrambi nel tab Telepatia');

    // ── Test 3: Lista utenti online ────────────────────────────────────────
    console.log('\n📋 Test 3: Lista utenti online');
    // Aspetta che il polling popoli la lista (10s intervallo)
    await pageA.waitForTimeout(11000);
    const onlineList = await pageA.locator('button:has-text("Proponi")').count();
    if (onlineList > 0) {
      pass(`TestUserA vede ${onlineList} utente/i con bottone "Proponi"`);
    } else {
      fail('TestUserA non vede nessun utente con bottone "Proponi"');
    }

    // ── Test 4: Abbinamento random ─────────────────────────────────────────
    console.log('\n📋 Test 4: Abbinamento random (Find Partner)');
    await clickFindPartner(pageA, 'TestUserA');
    await pageA.waitForTimeout(500);
    await clickFindPartner(pageB, 'TestUserB');

    await Promise.all([
      waitForPartnerFound(pageA, 'TestUserA'),
      waitForPartnerFound(pageB, 'TestUserB'),
    ]);
    pass('Match trovato — entrambi vedono il partner');

    // ── Test 5: Gioco (sender invia, receiver indovina) ───────────────────
    console.log('\n📋 Test 5: Round di telepatia');

    // Determina chi è sender e chi receiver
    const roleA = await pageA.locator('p:has-text("Sender"), p:has-text("Receiver")').first().textContent();
    const isSenderA = roleA.includes('Sender');
    log('TestUserA', `Ruolo: ${isSenderA ? 'Sender' : 'Receiver'}`);
    log('TestUserB', `Ruolo: ${isSenderA ? 'Receiver' : 'Sender'}`);

    const senderPage = isSenderA ? pageA : pageB;
    const receiverPage = isSenderA ? pageB : pageA;
    const senderName = isSenderA ? 'TestUserA' : 'TestUserB';
    const receiverName = isSenderA ? 'TestUserB' : 'TestUserA';

    await sendSymbol(senderPage, senderName);
    await guessSymbol(receiverPage, receiverName);

    const [matchA] = await Promise.all([
      waitForResult(pageA, 'TestUserA'),
      waitForResult(pageB, 'TestUserB'),
    ]);
    pass('Entrambi vedono il risultato del round');

    // ── Test 6: Ancora ─────────────────────────────────────────────────────
    console.log('\n📋 Test 6: Pulsante "Ancora"');
    await clickAncora(pageA, 'TestUserA');
    await clickAncora(pageB, 'TestUserB');

    // Dopo "Ancora" entrambi devono tornare al gioco (sender picker o receiver wait)
    await pageA.waitForTimeout(3000);
    const symbolsA = await pageA.locator('.symbol-btn').count();
    const waitingA = await pageA.locator(':text("Simbolo inviato"), :text("Aspetta")').count();
    if (symbolsA > 0 || waitingA > 0) {
      pass('TestUserA tornato in gioco dopo "Ancora"');
    } else {
      fail('TestUserA NON è tornato in gioco dopo "Ancora"');
    }

    // ── Test 7: Termina Sessione ───────────────────────────────────────────
    console.log('\n📋 Test 7: "Termina Sessione"');

    // Prima invia un nuovo simbolo per avere il bottone Termina Sessione
    await sendSymbol(senderPage, senderName);
    await guessSymbol(receiverPage, receiverName);
    await waitForResult(pageA, 'TestUserA');

    await clickTerminaSessione(pageA, 'TestUserA');
    await pageA.waitForSelector('text=Sessione Completata!', { timeout: TIMEOUT });
    pass('TestUserA vede la schermata "Sessione Completata"');

    // L'altro browser deve tornare in lobby entro 4 secondi (match eliminato)
    await waitForLobby(pageB, 'TestUserB');
    pass('TestUserB tornato in lobby automaticamente dopo che il partner ha terminato');

    // ── Test 8: Invito diretto ────────────────────────────────────────────
    console.log('\n📋 Test 8: Invito diretto (Proponi → Accetta)');

    // TestUserA torna in lobby (potrebbe essere in "Sessione Completata" o già in lobby)
    try {
      await pageA.locator('button:has-text("Torna alla Lobby")').click({ timeout: 5000 });
    } catch { /* già in lobby */ }
    await waitForLobby(pageA, 'TestUserA');

    // Aspetta che la lista utenti si aggiorni (fino a 12s)
    await pageA.waitForTimeout(12000);
    // Trova il bottone "Proponi" per TestUserB tramite valutazione DOM diretta
    const proponiCount = await pageA.evaluate(() => {
      const spans = [...document.querySelectorAll('span.text-white.text-sm.font-medium')];
      return spans.filter(s => s.textContent.trim() === 'TestUserB').length;
    });
    if (proponiCount === 0) {
      fail('TestUserA non vede il bottone "Proponi" per TestUserB');
    } else {
      // Clicca il Proponi della riga TestUserB tramite DOM
      await pageA.evaluate(() => {
        const spans = [...document.querySelectorAll('span.text-white.text-sm.font-medium')];
        for (const span of spans) {
          if (span.textContent.trim() === 'TestUserB') {
            const row = span.closest('div[style*="space-between"]') || span.parentElement?.parentElement;
            const btn = row?.querySelector('button');
            if (btn) btn.click();
            return;
          }
        }
      });
      log('TestUserA', 'Invito diretto inviato a TestUserB');
      await pageA.waitForTimeout(1000);

      // Debug: verifica che l'invito sia nel DB
      const invResp = await fetch(`${SUPABASE_URL}/rest/v1/telepathy_invites?select=*&status=eq.pending&order=created_at.desc&limit=5`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const invites = await invResp.json();
      log('DEBUG', `Inviti pending nel DB: ${JSON.stringify(invites.map(i => ({ from: i.from_name, to: i.to_name, to_id: i.to_id })))}`);

      // Debug: verifica sessionId di TestUserB nel DB
      const ouResp = await fetch(`${SUPABASE_URL}/rest/v1/online_users?select=id,nickname&nickname=eq.TestUserB`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const ouData = await ouResp.json();
      log('DEBUG', `TestUserB in online_users: ${JSON.stringify(ouData)}`);

      // TestUserB vede il banner nell'updatePresence (ogni 10s) — timeout esteso
      await pageB.waitForSelector(':text("ti vuole fare training telepatico")', { timeout: 35000 });
      log('TestUserB', 'Banner invito ricevuto');
      await pageB.locator('button:has-text("Accetta")').click();
      log('TestUserB', 'Invito accettato');

      // Entrambi devono essere in sessione
      await Promise.all([
        pageA.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT }),
        pageB.waitForSelector('text=Il tuo ruolo', { timeout: TIMEOUT }),
      ]);
      pass('Invito diretto funziona — entrambi in sessione');

      // Pulisci: gioca un round e termina la sessione
      const roleA2 = await pageA.locator('p.text-white.font-bold').filter({ hasText: /^Sender$|^Receiver$/ }).first().textContent();
      const isSenderA2 = roleA2.trim() === 'Sender';
      await sendSymbol(isSenderA2 ? pageA : pageB, 'S2');
      await guessSymbol(isSenderA2 ? pageB : pageA, 'R2');
      await Promise.all([waitForResult(pageA, 'TestUserA'), waitForResult(pageB, 'TestUserB')]);
      await pageA.locator('button:has-text("Termina Sessione")').click();
      await Promise.all([
        pageA.waitForSelector(':text("Sessione Completata!")', { timeout: TIMEOUT }),
        waitForLobby(pageB, 'TestUserB'),
      ]);
    }

    // ── Test 9: Chat durante sessione ────────────────────────────────────
    console.log('\n📋 Test 9: Chat durante sessione');

    // Assicura che entrambi siano in lobby
    try { await pageA.locator('button:has-text("Torna alla Lobby")').click({ timeout: 3000 }); } catch {}
    await waitForLobby(pageA, 'TestUserA');

    // Avvia nuova sessione random
    await clickFindPartner(pageA, 'TestUserA');
    await pageA.waitForTimeout(500);
    await clickFindPartner(pageB, 'TestUserB');
    await Promise.all([
      waitForPartnerFound(pageA, 'TestUserA'),
      waitForPartnerFound(pageB, 'TestUserB'),
    ]);

    // Invia un messaggio dalla chat
    const chatMsg = 'Ciao dal test automatico!';
    await pageA.locator('input[placeholder="Scrivi..."]').fill(chatMsg);
    await pageA.locator('button:has-text("➤")').click();
    log('TestUserA', `Messaggio inviato: "${chatMsg}"`);

    // TestUserB deve vedere il messaggio entro qualche secondo (polling chat)
    await pageB.waitForSelector(`:text("${chatMsg}")`, { timeout: TIMEOUT });
    pass('Chat funziona — messaggio ricevuto dal partner');

    // ── Test 10: Score persistente in Supabase ───────────────────────────
    console.log('\n📋 Test 10: Score persistente in Supabase');

    // Gioca un round e termina la sessione per triggerare endSession
    const roleA3 = await pageA.locator('p.text-white.font-bold').filter({ hasText: /^Sender$|^Receiver$/ }).first().textContent();
    const isSenderA3 = roleA3.trim() === 'Sender';
    const sp3 = isSenderA3 ? pageA : pageB;
    const rp3 = isSenderA3 ? pageB : pageA;
    await sendSymbol(sp3, 'S3');
    await guessSymbol(rp3, 'R3');
    await waitForResult(pageA, 'TestUserA');
    await pageA.locator('button:has-text("Termina Sessione")').click();
    await pageA.waitForSelector(':text("Sessione Completata!")', { timeout: TIMEOUT });

    // Controlla Supabase via fetch
    await pageA.waitForTimeout(2000); // attendi che il DB sia scritto
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/telepathy_scores?select=*&order=updated_at.desc&limit=5`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const scores = await resp.json();
    if (scores && scores.length > 0) {
      pass(`Score salvato in Supabase — ${scores.length} record trovati (ultimo: ${scores[0].nickname}, sessioni: ${scores[0].sessions_count})`);
    } else {
      fail('Nessun record trovato in telepathy_scores dopo endSession');
    }

    // ── Test 11: Cambio livello dopo 7 round ────────────────────────────
    console.log('\n📋 Test 11: Cambio livello dopo 7 round');

    // Nuova sessione per TestUserB (che è tornato in lobby)
    await waitForLobby(pageB, 'TestUserB');
    await pageA.locator('button:has-text("Torna alla Lobby")').click();
    await waitForLobby(pageA, 'TestUserA');

    await clickFindPartner(pageA, 'TestUserA');
    await pageA.waitForTimeout(500);
    await clickFindPartner(pageB, 'TestUserB');
    await Promise.all([
      waitForPartnerFound(pageA, 'TestUserA'),
      waitForPartnerFound(pageB, 'TestUserB'),
    ]);
    log('TestUserA', 'Sessione avviata per test cambio livello (7 round)');

    const roleA4 = await pageA.locator('p.text-white.font-bold').filter({ hasText: /^Sender$|^Receiver$/ }).first().textContent();
    const isSenderA4 = roleA4.trim() === 'Sender';
    const sp4 = isSenderA4 ? pageA : pageB;
    const rp4 = isSenderA4 ? pageB : pageA;
    const sName4 = isSenderA4 ? 'TestUserA' : 'TestUserB';
    const rName4 = isSenderA4 ? 'TestUserB' : 'TestUserA';

    // Gioca 7 round
    for (let i = 1; i <= 7; i++) {
      await sendSymbol(sp4, sName4);
      await guessSymbol(rp4, rName4);
      await Promise.all([
        waitForResult(pageA, 'TestUserA'),
        waitForResult(pageB, 'TestUserB'),
      ]);
      log('TestUserA', `Round ${i}/7 completato`);
      // Clicca "Ancora" dopo ogni round (anche il 7°) per tornare alla schermata di gioco
      await Promise.all([
        pageA.locator('button:has-text("Ancora")').click(),
        pageB.locator('button:has-text("Ancora")').click(),
      ]);
      // Attendi che il DB venga aggiornato (clear simboli + round_count avanzato dopo 4s)
      await pageA.waitForTimeout(5000);
    }

    // Dopo il 7° round + "Ancora" il banner deve essere visibile (showLevelBanner=true, showResult=false)
    await Promise.all([
      pageA.waitForSelector(':text("Vuoi cambiare tipo di telepatia")', { timeout: TIMEOUT }),
      pageB.waitForSelector(':text("Vuoi cambiare tipo di telepatia")', { timeout: TIMEOUT }),
    ]);
    pass('Banner cambio livello apparso dopo 7 round');

    // Entrambi scelgono "Numeri"
    await Promise.all([
      pageA.locator('button').filter({ hasText: 'Numeri' }).first().click(),
      pageB.locator('button').filter({ hasText: 'Numeri' }).first().click(),
    ]);
    log('TestUserA', 'Scelta: Numeri');
    log('TestUserB', 'Scelta: Numeri');

    // Verifica che il livello sia cambiato a "Numeri"
    // Dopo la scelta il banner scompare e si è direttamente in gioco (nessun "Ancora")
    await pageA.waitForTimeout(3000); // attendi sync DB
    const livelloText = await pageA.locator(':text("Numeri")').count();
    if (livelloText > 0) {
      pass('Livello cambiato a "Numeri" con successo');
    } else {
      fail('Livello NON cambiato a Numeri');
    }

  } catch (err) {
    fail(`Errore imprevisto: ${err.message}`);
    console.error(err);
  } finally {
    console.log('\n═══════════════════════════════════════');
    console.log(process.exitCode === 1 ? '  RISULTATO: ❌ FALLITO' : '  RISULTATO: ✅ PASSATO');
    console.log('═══════════════════════════════════════\n');

    await browser.close();
  }
})();
