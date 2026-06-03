# Rituali Step B — anti-impersonazione (B6) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chiudere VULN-4: nessuno può pubblicare un rituale o un commento spacciandosi per un utente registrato.

**Architecture:** Validazione condizionale nelle RPC `create_ritual`/`create_ritual_comment`: se il nickname dichiarato esiste in `profiles`, l'hash deve combaciare; altrimenti (guest) si procede. Overload additivi con `p_password_hash`, rollout staged (crea → deploy client → drop firme vecchie). Solo SQL + 3 modifiche client + test.

**Tech Stack:** PostgreSQL/Supabase (PostgREST RPC), React UMD inline in `app.html`, Node per i test.

---

## File Structure

- `supabase/sql/07_rituali_step_b.sql` — **Create**: overload con `p_password_hash` (BLOCCO 1) + drop firme vecchie (BLOCCO 2) + verifica (BLOCCO 3).
- `app.html` — **Modify**: 3 chiamate RPC (`createRitual` ~2854, `createTestRitual` ~2897, `createRitualComment` ~2957) aggiungono `p_password_hash: passwordHash`.
- `test-rituali-impersonation.js` — **Create**: test REST/RPC anon su impersonazione.

Ordine che rispetta "no DB senza ok": SQL scritto (Task 1) + client (Task 2) + test (Task 3) committati; poi l'utente applica BLOCCO 1, si testa, push client, l'utente applica BLOCCO 2 (Task 4).

---

## Task 1: SQL overload + drop

**Files:**
- Create: `supabase/sql/07_rituali_step_b.sql`

- [ ] **Step 1: Scrivere il file SQL**

```sql
-- ============================================================================
-- Rituali Step B — anti-impersonazione (B6 / VULN-4 RITUALI_AUDIT.md)
-- Riferimento: docs/superpowers/specs/2026-06-03-rituali-step-b-anti-impersonazione-design.md
-- Validazione CONDIZIONALE: se il nickname dichiarato esiste in profiles,
-- l'hash deve combaciare; altrimenti (guest) si procede. Contenuti pubblici.
-- Idempotente. Rollout staged: BLOCCO 1 ora, BLOCCO 2 dopo deploy client.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- BLOCCO 1 — FASE 1 (eseguire ORA): overload con p_password_hash (non-breaking)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_ritual(
  p_creator         text,
  p_creator_id      text,
  p_name            text,
  p_description     text,
  p_type            text,
  p_sacred_number   int,
  p_date            date,
  p_time            time,
  p_duration        int,
  p_password_hash   text
)
RETURNS SETOF rituals
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anti-impersonazione condizionale (solo se il creator è un nick registrato)
  IF EXISTS (SELECT 1 FROM profiles WHERE nickname = p_creator) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE nickname = p_creator AND password_hash = p_password_hash) THEN
      RAISE EXCEPTION 'Auth failed';
    END IF;
  END IF;

  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF p_duration IS NULL OR p_duration < 1 OR p_duration > 1440 THEN
    RAISE EXCEPTION 'duration_out_of_range';
  END IF;

  RETURN QUERY
    INSERT INTO rituals (
      creator, creator_id, name, description, type,
      sacred_number, date, time, duration, participants, energy
    )
    VALUES (
      coalesce(nullif(p_creator, ''), 'Anonymous'),
      p_creator_id,
      p_name,
      coalesce(p_description, ''),
      coalesce(p_type, 'consciousness'),
      coalesce(p_sacred_number, 11),
      p_date,
      p_time,
      p_duration,
      jsonb_build_array(p_creator_id),
      0
    )
    RETURNING *;
END;
$$;
GRANT EXECUTE ON FUNCTION create_ritual(text,text,text,text,text,int,date,time,int,text) TO anon;

CREATE OR REPLACE FUNCTION create_ritual_comment(
  p_ritual_id        bigint,
  p_author_nickname  text,
  p_content          text,
  p_password_hash    text
)
RETURNS SETOF ritual_comments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anti-impersonazione condizionale
  IF EXISTS (SELECT 1 FROM profiles WHERE nickname = p_author_nickname) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE nickname = p_author_nickname AND password_hash = p_password_hash) THEN
      RAISE EXCEPTION 'Auth failed';
    END IF;
  END IF;

  IF coalesce(trim(p_content), '') = '' THEN
    RAISE EXCEPTION 'content_required';
  END IF;
  IF length(p_content) > 2000 THEN
    RAISE EXCEPTION 'content_too_long';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rituals WHERE id = p_ritual_id) THEN
    RAISE EXCEPTION 'ritual_not_found';
  END IF;

  RETURN QUERY
    INSERT INTO ritual_comments (ritual_id, author_nickname, content)
    VALUES (p_ritual_id,
            coalesce(nullif(p_author_nickname, ''), 'Anonymous'),
            p_content)
    RETURNING *;
END;
$$;
GRANT EXECUTE ON FUNCTION create_ritual_comment(bigint,text,text,text) TO anon;

-- ----------------------------------------------------------------------------
-- BLOCCO 2 — FASE 3 (eseguire SOLO dopo il deploy del client): chiude VULN-4
--   rimuove le firme vecchie senza hash (impersonabili)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS create_ritual(text,text,text,text,text,int,date,time,int);
-- DROP FUNCTION IF EXISTS create_ritual_comment(bigint,text,text);

-- ----------------------------------------------------------------------------
-- BLOCCO 3 — Verifica (post FASE 3, da REST anon)
-- ----------------------------------------------------------------------------
-- POST /rpc/create_ritual (10 arg, p_creator=<nick registrato>, hash errato) -> 'Auth failed'
-- POST /rpc/create_ritual (10 arg, p_creator=<guest libero>, hash null)       -> 200, riga creata
-- POST /rpc/create_ritual (9 arg, vecchia firma)                              -> 404 (function non trovata)
```

- [ ] **Step 2: Commit**

```bash
git add supabase/sql/07_rituali_step_b.sql
git commit -m "feat(sql): Rituali Step B overload anti-impersonazione (B6/VULN-4)"
```

> Applicazione in Studio: Task 4 (gate utente).

---

## Task 2: Client — passare l'hash alle 3 chiamate RPC

**Files:**
- Modify: `app.html` (`createRitual` ~2854, `createTestRitual` ~2897, `createRitualComment` ~2957)

- [ ] **Step 1: `createRitual` — aggiungere p_password_hash**

Cercare:
```javascript
              const { data, error } = await supabase.rpc('create_ritual', {
                p_creator: ritualData.creator,
                p_creator_id: ritualData.creator_id,
                p_name: ritualData.name,
                p_description: ritualData.description,
                p_type: ritualData.type,
                p_sacred_number: ritualData.sacred_number,
                p_date: ritualData.date,
                p_time: ritualData.time,
                p_duration: ritualData.duration
              });
```
Sostituire con (aggiunta ultima riga prima di `});`):
```javascript
              const { data, error } = await supabase.rpc('create_ritual', {
                p_creator: ritualData.creator,
                p_creator_id: ritualData.creator_id,
                p_name: ritualData.name,
                p_description: ritualData.description,
                p_type: ritualData.type,
                p_sacred_number: ritualData.sacred_number,
                p_date: ritualData.date,
                p_time: ritualData.time,
                p_duration: ritualData.duration,
                p_password_hash: passwordHash
              });
```

- [ ] **Step 2: `createTestRitual` — aggiungere p_password_hash**

Cercare:
```javascript
            await supabase.rpc('create_ritual', {
              p_creator: nickname || 'Anonymous',
              p_creator_id: sessionId,
              p_name: '⚡ Test Ritual',
              p_description: 'Rituale di test — scade in 3 minuti',
              p_type: 'consciousness',
              p_sacred_number: 11,
              p_date: utcDate,
              p_time: utcTime,
              p_duration: 3
            });
```
Sostituire con (aggiunta ultima riga prima di `});`):
```javascript
            await supabase.rpc('create_ritual', {
              p_creator: nickname || 'Anonymous',
              p_creator_id: sessionId,
              p_name: '⚡ Test Ritual',
              p_description: 'Rituale di test — scade in 3 minuti',
              p_type: 'consciousness',
              p_sacred_number: 11,
              p_date: utcDate,
              p_time: utcTime,
              p_duration: 3,
              p_password_hash: passwordHash
            });
```

- [ ] **Step 3: `createRitualComment` — aggiungere p_password_hash**

Cercare:
```javascript
            const { data, error } = await supabase.rpc('create_ritual_comment', {
              p_ritual_id: ritualId,
              p_author_nickname: nickname,
              p_content: content
            });
```
Sostituire con:
```javascript
            const { data, error } = await supabase.rpc('create_ritual_comment', {
              p_ritual_id: ritualId,
              p_author_nickname: nickname,
              p_content: content,
              p_password_hash: passwordHash
            });
```

- [ ] **Step 4: Verifica montaggio JSX**

Run: con server su `http://localhost:4321`, caricare `app.html` in Playwright headless e controllare `pageerror`/`console.error`.
Expected: nessun errore, React monta.

- [ ] **Step 5: Commit**

```bash
git add app.html
git commit -m "feat(rituali): client passa password_hash a create_ritual/comment (Step B)"
```

---

## Task 3: Test impersonazione

**Files:**
- Create: `test-rituali-impersonation.js`

- [ ] **Step 1: Scrivere il test**

```javascript
/**
 * Test anti-impersonazione Rituali Step B — Global Awakening
 *
 * Copre create_ritual / create_ritual_comment (overload con p_password_hash):
 *   - registrato + hash giusto -> ok
 *   - registrato + hash errato/assente -> Auth failed
 *   - guest (nick non in profiles) + hash null -> ok
 *
 * Esecuzione: node test-rituali-impersonation.js
 * Prerequisito: aver applicato il BLOCCO 1 di supabase/sql/07_rituali_step_b.sql.
 */
const SUPABASE_URL = 'https://vxzxdkcluyrcftsnxxza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4enhka2NsdXlyY2Z0c254eHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMzcyMTcsImV4cCI6MjA4NjkxMzIxN30.m_mzWHH1-ajVqeSFvuJAm8t5Kz7I7umcEKBrRPr5JXM';

const TS    = Date.now();
const REG   = `RitB_${TS}`;
const EMAIL = `ritb_${TS}@test.com`;
const SID   = `ritb-sid-${TS}`;
const HASH  = `hash-${TS}`;
const GUEST = `RitGuest_${TS}`;
// Date già scadute (UTC ieri) così cleanup_expired_rituals rimuove i rituali di test.
const PAST_DATE = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

let passed = 0, failed = 0;
function pass(m) { console.log(`  ✅ ${m}`); passed++; }
function fail(m) { console.log(`  ❌ ${m}`); failed++; process.exitCode = 1; }

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
               'Content-Type': 'application/json', Prefer: 'return=representation', ...opts.headers },
    ...opts,
  });
  if (res.status === 204) return null;
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return txt; }
}
async function rpc(fn, params) {
  return sb(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) });
}
const ritParams = (creator, hash, name) => ({
  p_creator: creator, p_creator_id: SID, p_name: name,
  p_description: 'test', p_type: 'consciousness', p_sacred_number: 11,
  p_date: PAST_DATE, p_time: '12:00:00', p_duration: 5, p_password_hash: hash,
});

async function cleanup() {
  await sb(`profiles?email=eq.${encodeURIComponent(EMAIL)}`, { method: 'DELETE' });
  await rpc('cleanup_expired_rituals', {});
}

(async () => {
  console.log('— Setup —');
  await cleanup();
  await sb('profiles', { method: 'POST', body: JSON.stringify({
    session_id: SID, nickname: REG, email: EMAIL, password_hash: HASH,
    bio: '', country: '', interests: [], telepathy_score: 0, telepathy_best: 0, show_telepathy_score: true }) });

  console.log('— create_ritual —');
  const okReg = await rpc('create_ritual', ritParams(REG, HASH, `R-ok-${TS}`));
  if (Array.isArray(okReg) && okReg[0] && okReg[0].creator === REG) pass('registrato + hash giusto -> rituale creato');
  else fail(`registrato+hash giusto fallito: ${JSON.stringify(okReg)}`);

  const badReg = await rpc('create_ritual', ritParams(REG, 'sbagliato', `R-bad-${TS}`));
  if (badReg && /Auth failed/.test(JSON.stringify(badReg))) pass('registrato + hash errato -> Auth failed');
  else fail(`registrato+hash errato non rifiutato: ${JSON.stringify(badReg)}`);

  const nullReg = await rpc('create_ritual', ritParams(REG, null, `R-null-${TS}`));
  if (nullReg && /Auth failed/.test(JSON.stringify(nullReg))) pass('registrato + hash null -> Auth failed');
  else fail(`registrato+hash null non rifiutato: ${JSON.stringify(nullReg)}`);

  const guestOk = await rpc('create_ritual', ritParams(GUEST, null, `G-ok-${TS}`));
  if (Array.isArray(guestOk) && guestOk[0] && guestOk[0].creator === GUEST) pass('guest (nick libero) + hash null -> rituale creato');
  else fail(`guest non ha potuto creare: ${JSON.stringify(guestOk)}`);

  console.log('— create_ritual_comment —');
  const ritId = (Array.isArray(guestOk) && guestOk[0]) ? guestOk[0].id : (Array.isArray(okReg) && okReg[0] ? okReg[0].id : null);
  if (ritId == null) { fail('nessun ritual_id per testare i commenti'); }
  else {
    const cOk = await rpc('create_ritual_comment', { p_ritual_id: ritId, p_author_nickname: REG, p_content: 'ciao', p_password_hash: HASH });
    if (Array.isArray(cOk) && cOk[0] && cOk[0].author_nickname === REG) pass('commento registrato + hash giusto -> ok');
    else fail(`commento registrato+hash giusto fallito: ${JSON.stringify(cOk)}`);

    const cBad = await rpc('create_ritual_comment', { p_ritual_id: ritId, p_author_nickname: REG, p_content: 'spoof', p_password_hash: 'sbagliato' });
    if (cBad && /Auth failed/.test(JSON.stringify(cBad))) pass('commento registrato + hash errato -> Auth failed');
    else fail(`commento impersonato non rifiutato: ${JSON.stringify(cBad)}`);

    const cGuest = await rpc('create_ritual_comment', { p_ritual_id: ritId, p_author_nickname: GUEST, p_content: 'guest', p_password_hash: null });
    if (Array.isArray(cGuest) && cGuest[0] && cGuest[0].author_nickname === GUEST) pass('commento guest (nick libero) -> ok');
    else fail(`commento guest fallito: ${JSON.stringify(cGuest)}`);
  }

  console.log('— Teardown —');
  await cleanup();
  console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
})();
```

- [ ] **Step 2: Commit**

```bash
git add test-rituali-impersonation.js
git commit -m "test(rituali): anti-impersonazione create_ritual/comment (Step B)"
```

---

## Task 4: Applicazione DB staged + verifica (gate utente)

**Files:** nessuna modifica codice.

- [ ] **Step 1: Far applicare il BLOCCO 1 in Supabase Studio**

Chiedere all'utente di eseguire il BLOCCO 1 di `supabase/sql/07_rituali_step_b.sql`
(i due `CREATE OR REPLACE FUNCTION` con `p_password_hash`). Confermare successo.

- [ ] **Step 2: Eseguire il test impersonazione (overload attivo, firma vecchia ancora presente)**

Run: `node test-rituali-impersonation.js`
Expected: tutte `✅`, `0 falliti`.

- [ ] **Step 3: Verificare che il client già pushato usi gli overload + non-regressione**

Avviare server `npx serve . -p 4321` se non attivo.
Run: `node test-rituali.js`
Expected: 18/18 (i rituali/commenti creati dal client via UI usano ora gli overload con hash; per utenti registrati di test l'hash combacia, per i nick di test non in profiles passa il ramo guest).

- [ ] **Step 4: Far applicare il BLOCCO 2 in Studio (drop firme vecchie)**

Decommentare ed eseguire i due `DROP FUNCTION` del BLOCCO 2. Da qui VULN-4 è chiusa
(la firma a 9/3 parametri impersonabile non esiste più).

- [ ] **Step 5: Verifica finale post-drop**

Run: `node test-rituali-impersonation.js` e `node test-rituali.js`
Expected: entrambi verdi (il client e il test usano gli overload a 10/4 parametri).
Probe vecchia firma: `POST /rpc/create_ritual` con 9 arg → errore function-not-found.

- [ ] **Step 6: Push (se non già fatto) + verifica deploy live + aggiornare memoria**

Push `main`, verifica GitHub Pages, aggiornare `project_global_awakening.md` + `MEMORY.md`
(B6 chiusa, VULN-4 chiusa, SQL `07_`) e `RITUALI_AUDIT.md` (segnare VULN-4 risolta).

---

## Note di verifica del piano (self-review)

- **Copertura spec:** overload condizionali (Task 1), client 3 chiamate (Task 2), test impersonazione (Task 3), rollout staged + drop + deploy (Task 4). ✔
- **Coerenza firme:** nuovi overload `create_ritual(...,text)` a 10 param e `create_ritual_comment(bigint,text,text,text)` a 4 param; drop delle firme a 9/3 param; il client passa `p_password_hash` in tutte e 3 le chiamate. ✔
- **Edge case documentato:** se `p_creator`/`p_author_nickname` coincide con un nick registrato, serve l'hash; un guest che digita il nick di un registrato viene bloccato (atteso, è l'anti-impersonazione).
- **Rollback:** SQL idempotente; se il BLOCCO 2 causasse problemi, ri-creare le firme vecchie da `01_create_rpc.sql`. Il client funziona solo con gli overload (post-deploy).
