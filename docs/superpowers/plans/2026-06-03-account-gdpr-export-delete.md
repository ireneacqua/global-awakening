# Export ed eliminazione account (GDPR) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere self-service in-app i diritti GDPR di export (JSON) ed eliminazione account, oggi gestiti manualmente.

**Architecture:** Due RPC PostgreSQL `SECURITY DEFINER` autenticate con `(nickname, password_hash)` contro `profiles` (pattern Messaggi Step B), additive e non-breaking. Il client (`app.html`, monolite React UMD) aggiunge una sezione "I tuoi dati (GDPR)" nel modal profilo: export scarica un Blob JSON, delete chiede conferma digitando il nickname poi esegue logout+pulizia. Privacy policy aggiornata. Test Playwright+REST.

**Tech Stack:** PostgreSQL/Supabase (PostgREST), React via Babel UMD inline in `app.html`, Playwright (Node) per i test.

---

## File Structure

- `supabase/sql/06_account_gdpr.sql` — **Create**: le due RPC `export_my_account` e `delete_my_account` + GRANT. Idempotente (`CREATE OR REPLACE`).
- `app.html` — **Modify**: (a) i18n IT/EN nuove chiavi; (b) nuovi stati React; (c) handler `exportMyData` / `confirmDeleteAccount`; (d) sezione GDPR nel modal profilo (~riga 4235, dopo "Change Password", prima del Save Button); (e) modal di conferma eliminazione; (f) testo privacy "I tuoi diritti" IT+EN (~righe 802 / 1059).
- `test-account-gdpr.js` — **Create**: test end-to-end via REST/RPC anon (pattern di `test-messaggi.js`).

Ordine d'esecuzione che rispetta il guardrail "no DB senza ok": prima si scrive l'SQL (Task 1), il client (Task 2-3), il test (Task 4); poi l'utente applica l'SQL in Studio e si esegue il test a verde (Task 5).

---

## Task 1: RPC SQL export + delete

**Files:**
- Create: `supabase/sql/06_account_gdpr.sql`

- [ ] **Step 1: Scrivere il file SQL completo**

```sql
-- ============================================================================
-- Account GDPR — D2 export + D3 eliminazione (self-service)
-- Riferimento: docs/superpowers/specs/2026-06-03-account-gdpr-export-delete-design.md
-- Pattern: RPC SECURITY DEFINER autenticate (nickname, password_hash) come Step B
--          (get_my_messages). Solo utenti registrati. Additive, non-breaking.
-- Idempotente: CREATE OR REPLACE. Eseguibile più volte senza danno.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) export_my_account — ritorna tutti i dati dell'utente come unico jsonb
--    profile esclude password_hash (mai esportato).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_my_account(
  p_nickname      text,
  p_password_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  text;
  v_sid    text;
  v_result jsonb;
BEGIN
  SELECT email, session_id INTO v_email, v_sid
    FROM profiles
   WHERE nickname = p_nickname AND password_hash = p_password_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth failed';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', now(),
    'profile', (SELECT to_jsonb(p) - 'password_hash'
                  FROM profiles p WHERE p.nickname = p_nickname),
    'private_messages', coalesce((SELECT jsonb_agg(to_jsonb(m))
                  FROM private_messages m
                 WHERE m.sender_name = p_nickname OR m.receiver_name = p_nickname), '[]'::jsonb),
    'consciousness_posts', coalesce((SELECT jsonb_agg(to_jsonb(c))
                  FROM consciousness_posts c WHERE c.author_nickname = p_nickname), '[]'::jsonb),
    'consciousness_comments', coalesce((SELECT jsonb_agg(to_jsonb(c))
                  FROM consciousness_comments c WHERE c.author_nickname = p_nickname), '[]'::jsonb),
    'ritual_comments', coalesce((SELECT jsonb_agg(to_jsonb(rc))
                  FROM ritual_comments rc WHERE rc.author_nickname = p_nickname), '[]'::jsonb),
    'rituals_created', coalesce((SELECT jsonb_agg(to_jsonb(r))
                  FROM rituals r WHERE r.creator = p_nickname OR r.creator_id = v_sid), '[]'::jsonb),
    'telepathy_scores', coalesce((SELECT jsonb_agg(to_jsonb(ts))
                  FROM telepathy_scores ts WHERE ts.user_id = v_email), '[]'::jsonb),
    'notifications', coalesce((SELECT jsonb_agg(to_jsonb(n))
                  FROM notifications n WHERE n.user_nickname = p_nickname), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.export_my_account(text, text) TO anon;

-- ----------------------------------------------------------------------------
-- 2) delete_my_account — anonimizza i contenuti pubblici, cancella i dati
--    personali/privati e la riga profiles. Tutto nel corpo unico = transazione.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_my_account(
  p_nickname      text,
  p_password_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_sid   text;
BEGIN
  SELECT email, session_id INTO v_email, v_sid
    FROM profiles
   WHERE nickname = p_nickname AND password_hash = p_password_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth failed';
  END IF;

  -- (a) Anonimizza i contenuti pubblici (preserva i thread altrui)
  UPDATE consciousness_posts    SET author_nickname = 'Utente eliminato' WHERE author_nickname = p_nickname;
  UPDATE consciousness_comments SET author_nickname = 'Utente eliminato' WHERE author_nickname = p_nickname;
  UPDATE ritual_comments        SET author_nickname = 'Utente eliminato' WHERE author_nickname = p_nickname;
  UPDATE rituals                SET creator         = 'Utente eliminato' WHERE creator = p_nickname;
  UPDATE chat_messages          SET user_name       = 'Utente eliminato' WHERE user_name = p_nickname;

  -- (b) Cancella i dati personali/privati
  DELETE FROM private_messages WHERE sender_name = p_nickname OR receiver_name = p_nickname;
  DELETE FROM notifications    WHERE user_nickname = p_nickname;

  IF v_email IS NOT NULL AND v_email <> '' THEN
    DELETE FROM telepathy_scores WHERE user_id = v_email;
    DELETE FROM magic_links      WHERE email   = v_email;
    DELETE FROM password_resets  WHERE email   = v_email;
  END IF;

  -- Effimeri telepatia/presenza con colonne note (TTL breve, session_id opachi).
  -- telepathy_matches/telepathy_chat NON toccati: si auto-puliscono a TTL <5min
  -- e contengono solo id effimeri + simboli, non PII persistente identificabile.
  IF v_sid IS NOT NULL AND v_sid <> '' THEN
    DELETE FROM online_users      WHERE id = v_sid;
    DELETE FROM telepathy_queue   WHERE id = v_sid;
    DELETE FROM telepathy_invites WHERE from_id = v_sid OR to_id = v_sid;
  END IF;

  -- (c) Cancella l'identità
  DELETE FROM profiles WHERE nickname = p_nickname AND password_hash = p_password_hash;
END $$;

GRANT EXECUTE ON FUNCTION public.delete_my_account(text, text) TO anon;

-- ----------------------------------------------------------------------------
-- VERIFICA POST-APPLY (da Studio)
--   SELECT export_my_account('NickInesistente','x');   -> errore 'Auth failed'
--   SELECT delete_my_account('NickInesistente','x');    -> errore 'Auth failed'
-- ----------------------------------------------------------------------------
```

- [ ] **Step 2: Commit**

```bash
git add supabase/sql/06_account_gdpr.sql
git commit -m "feat(sql): RPC export_my_account e delete_my_account (GDPR D2/D3)"
```

> Nota: l'applicazione effettiva in Supabase Studio avviene in Task 5 (gate utente "no DB senza ok").

---

## Task 2: UI client — i18n, stati e handler

**Files:**
- Modify: `app.html` (blocco traduzioni EN ~riga 692; IT ~riga 949; stati componente ~riga 1315; handler dopo `handleLogout` ~riga 2080)

- [ ] **Step 1: Aggiungere le chiavi i18n EN** (nel blocco `en` dove c'è `logout: "Logout"`, ~riga 692)

```javascript
            gdprTitle: "Your data (GDPR)",
            gdprExport: "Export my data",
            gdprExporting: "Preparing…",
            gdprDelete: "Delete account",
            gdprDeleteTitle: "Delete your account?",
            gdprDeleteBody: "This permanently deletes your profile, private messages and scores. Your public posts and comments are kept but shown as \"Utente eliminato\". This cannot be undone.",
            gdprDeleteConfirmLabel: "Type your nickname to confirm:",
            gdprDeleteConfirmBtn: "Delete forever",
            gdprDeleteCancel: "Cancel",
            gdprDeleting: "Deleting…",
            gdprExportError: "Export failed. Please try again.",
            gdprDeleteError: "Deletion failed. Please try again.",
```

- [ ] **Step 2: Aggiungere le chiavi i18n IT** (nel blocco `it` dove c'è `logout: "Esci"`, ~riga 949)

```javascript
            gdprTitle: "I tuoi dati (GDPR)",
            gdprExport: "Esporta i miei dati",
            gdprExporting: "Preparazione…",
            gdprDelete: "Elimina account",
            gdprDeleteTitle: "Vuoi eliminare l'account?",
            gdprDeleteBody: "Questo elimina definitivamente profilo, messaggi privati e punteggi. I tuoi post e commenti pubblici restano ma appariranno come \"Utente eliminato\". L'operazione non è reversibile.",
            gdprDeleteConfirmLabel: "Digita il tuo nickname per confermare:",
            gdprDeleteConfirmBtn: "Elimina per sempre",
            gdprDeleteCancel: "Annulla",
            gdprDeleting: "Eliminazione…",
            gdprExportError: "Export non riuscito. Riprova.",
            gdprDeleteError: "Eliminazione non riuscita. Riprova.",
```

- [ ] **Step 3: Aggiungere gli stati React** (vicino a `const [showEditProfile, setShowEditProfile] = useState(false);`, ~riga 1315)

```javascript
          const [showDeleteAccount, setShowDeleteAccount] = useState(false);
          const [deleteConfirmText, setDeleteConfirmText] = useState('');
          const [gdprBusy, setGdprBusy] = useState(false);
```

- [ ] **Step 4: Aggiungere gli handler** (subito dopo la chiusura di `handleLogout`, ~riga 2080)

```javascript
          // Export GDPR: chiama la RPC, scarica il risultato come file JSON.
          const exportMyData = async () => {
            if (gdprBusy) return;
            setGdprBusy(true);
            const { data, error } = await supabase.rpc('export_my_account', {
              p_nickname: nickname,
              p_password_hash: passwordHash
            });
            setGdprBusy(false);
            if (error || !data) { showErrorToast(t.gdprExportError); return; }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `global-awakening-dati-${nickname}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          };

          // Delete GDPR: chiama la RPC; a successo logout completo + chiusura modali.
          const confirmDeleteAccount = async () => {
            if (gdprBusy) return;
            setGdprBusy(true);
            const { error } = await supabase.rpc('delete_my_account', {
              p_nickname: nickname,
              p_password_hash: passwordHash
            });
            setGdprBusy(false);
            if (error) { showErrorToast(t.gdprDeleteError); return; }
            setShowDeleteAccount(false);
            setDeleteConfirmText('');
            setShowEditProfile(false);
            handleLogout();
          };
```

- [ ] **Step 5: Commit**

```bash
git add app.html
git commit -m "feat(gdpr): i18n, stati e handler export/delete account"
```

---

## Task 3: UI client — sezione GDPR nel modal + modal di conferma + privacy policy

**Files:**
- Modify: `app.html` (sezione nel modal profilo ~riga 4235; nuovo modal conferma vicino al modal logout ~riga 4495; testo privacy IT+EN ~righe 802/1059)

- [ ] **Step 1: Inserire la sezione GDPR nel modal profilo** — subito dopo la chiusura del blocco "Change Password" `{!isGuest && ( … )}` e PRIMA del commento `{/* Save Button */}` (~riga 4236)

```javascript
                      {/* I tuoi dati (GDPR) — solo registrati */}
                      {!isGuest && (
                        <div style={{borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.25rem'}}>
                          <label className="text-white text-sm mb-2" style={{display: 'block'}}>{t.gdprTitle}</label>
                          <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                            <button
                              className="btn-secondary w-full"
                              disabled={gdprBusy}
                              onClick={exportMyData}
                            >
                              {gdprBusy ? t.gdprExporting : t.gdprExport}
                            </button>
                            <button
                              className="w-full"
                              style={{padding: '0.6rem', borderRadius: '0.75rem', border: '1px solid rgba(248,113,113,0.5)', background: 'rgba(248,113,113,0.12)', color: '#fca5a5', cursor: 'pointer', fontWeight: 600}}
                              onClick={() => { setDeleteConfirmText(''); setShowDeleteAccount(true); }}
                            >
                              {t.gdprDelete}
                            </button>
                          </div>
                        </div>
                      )}

```

- [ ] **Step 2: Inserire il modal di conferma eliminazione** — subito dopo la chiusura del blocco `{showLogoutConfirm && ( … )}` (~riga 4515, dopo il `)}` di chiusura)

```javascript
              {showDeleteAccount && (
                <div className="modal-overlay" onClick={() => !gdprBusy && setShowDeleteAccount(false)} style={{zIndex: 60}}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{maxWidth: '26rem'}}>
                    <h3 className="text-xl font-bold text-white mb-2">{t.gdprDeleteTitle}</h3>
                    <p className="text-secondary text-sm mb-4">{t.gdprDeleteBody}</p>
                    <label className="text-white text-sm mb-2" style={{display: 'block'}}>{t.gdprDeleteConfirmLabel}</label>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={nickname}
                      style={{marginBottom: '1rem'}}
                    />
                    <div style={{display: 'flex', gap: '0.5rem'}}>
                      <button className="btn-secondary" style={{flex: 1}} disabled={gdprBusy} onClick={() => setShowDeleteAccount(false)}>
                        {t.gdprDeleteCancel}
                      </button>
                      <button
                        style={{flex: 1, padding: '0.6rem', borderRadius: '0.75rem', border: 'none', background: '#dc2626', color: '#fff', fontWeight: 700, cursor: (deleteConfirmText === nickname && !gdprBusy) ? 'pointer' : 'not-allowed', opacity: (deleteConfirmText === nickname && !gdprBusy) ? 1 : 0.5}}
                        disabled={deleteConfirmText !== nickname || gdprBusy}
                        onClick={confirmDeleteAccount}
                      >
                        {gdprBusy ? t.gdprDeleting : t.gdprDeleteConfirmBtn}
                      </button>
                    </div>
                  </div>
                </div>
              )}
```

- [ ] **Step 3: Aggiornare il testo privacy "Your rights" (EN)** — sostituire il body al ~riga 802

Vecchio (cercare e sostituire):
```
{ heading: "Your rights", body: "Under the GDPR you can ask to access, correct, delete or export your data, or object to its use. To exercise any of these, open an issue on our public GitHub repository (github.com/ireneacqua/global-awakening). Please note: deletion and export are currently handled manually on request, as they are not yet automated in the app." },
```
Nuovo:
```
{ heading: "Your rights", body: "Under the GDPR you can access, correct, delete or export your data, or object to its use. Export and account deletion are available self-service from your profile (open your profile → \"Your data (GDPR)\"). For correction or objection, open an issue on our public GitHub repository (github.com/ireneacqua/global-awakening)." },
```

- [ ] **Step 4: Aggiornare il testo privacy "I tuoi diritti" (IT)** — sostituire il body al ~riga 1059

Vecchio (cercare e sostituire):
```
{ heading: "I tuoi diritti", body: "In base al GDPR puoi chiedere di accedere, rettificare, cancellare o esportare i tuoi dati, oppure opporti al loro utilizzo. Per esercitarli, apri una issue sul nostro repository GitHub pubblico (github.com/ireneacqua/global-awakening). Nota: cancellazione ed export sono attualmente gestiti manualmente su richiesta, perché non ancora automatizzati nell'app." },
```
Nuovo:
```
{ heading: "I tuoi diritti", body: "In base al GDPR puoi accedere, rettificare, cancellare o esportare i tuoi dati, oppure opporti al loro utilizzo. Export ed eliminazione dell'account sono disponibili in autonomia dal tuo profilo (apri il profilo → \"I tuoi dati (GDPR)\"). Per rettifica o opposizione, apri una issue sul nostro repository GitHub pubblico (github.com/ireneacqua/global-awakening)." },
```

- [ ] **Step 5: Verifica sintassi JSX** — aprire l'app servita e controllare che non ci siano errori Babel in console

Run: avviare il server statico (se non già attivo) e aprire `http://localhost:4321/app.html`; aprire la console del browser.
Expected: nessun errore di parsing Babel; il modal profilo si apre e mostra la sezione "I tuoi dati (GDPR)" per un utente registrato.

- [ ] **Step 6: Commit**

```bash
git add app.html
git commit -m "feat(gdpr): sezione export/elimina nel profilo + privacy policy self-service"
```

---

## Task 4: Test end-to-end

**Files:**
- Create: `test-account-gdpr.js`

- [ ] **Step 1: Scrivere il test** (riusa il pattern REST/RPC di `test-messaggi.js`)

```javascript
/**
 * Test GDPR export + eliminazione account — Global Awakening
 *
 * Copre:
 *   - export_my_account: auth ok ritorna tutte le sezioni; auth errata -> Auth failed
 *   - delete_my_account: anonimizza i contenuti pubblici, cancella privati+profilo;
 *     auth errata -> Auth failed
 *
 * Esecuzione: node test-account-gdpr.js
 * Prerequisito: aver applicato supabase/sql/06_account_gdpr.sql in Studio.
 */
const SUPABASE_URL = 'https://vxzxdkcluyrcftsnxxza.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4enhka2NsdXlyY2Z0c254eHphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMzcyMTcsImV4cCI6MjA4NjkxMzIxN30.m_mzWHH1-ajVqeSFvuJAm8t5Kz7I7umcEKBrRPr5JXM';

const TS    = Date.now();
const NICK  = `Gdpr_${TS}`;
const EMAIL = `gdpr_${TS}@test.com`;
const SID   = `gdpr-sid-${TS}`;
const HASH  = `hash-${TS}`;
const OTHER = `GdprOther_${TS}`;

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

async function seed() {
  await sb('profiles', { method: 'POST', body: JSON.stringify({
    session_id: SID, nickname: NICK, email: EMAIL, password_hash: HASH,
    bio: 'test', country: '', interests: [], telepathy_score: 0, telepathy_best: 0,
    show_telepathy_score: true }) });
  await sb('consciousness_posts', { method: 'POST', body: JSON.stringify({ author_nickname: NICK, content: 'post di test' }) });
  await sb('private_messages', { method: 'POST', body: JSON.stringify({ sender_id: SID, sender_name: NICK, receiver_name: OTHER, content: 'ciao', is_read: false }) });
}

async function cleanup() {
  await sb(`profiles?email=eq.${encodeURIComponent(EMAIL)}`, { method: 'DELETE' });
  await sb(`consciousness_posts?author_nickname=eq.${encodeURIComponent(NICK)}`, { method: 'DELETE' });
  await sb(`consciousness_posts?author_nickname=eq.${encodeURIComponent('Utente eliminato')}&content=eq.${encodeURIComponent('post di test')}`, { method: 'DELETE' });
  await sb(`private_messages?sender_name=eq.${encodeURIComponent(NICK)}`, { method: 'DELETE' });
}

(async () => {
  console.log('— Setup —');
  await cleanup();
  await seed();

  console.log('— Export —');
  const exp = await rpc('export_my_account', { p_nickname: NICK, p_password_hash: HASH });
  if (exp && exp.profile && exp.profile.nickname === NICK) pass('export ritorna il profilo');
  else fail(`export profilo mancante: ${JSON.stringify(exp)}`);
  if (exp && exp.profile && exp.profile.password_hash === undefined) pass('export NON contiene password_hash');
  else fail('export espone password_hash');
  if (exp && Array.isArray(exp.private_messages) && exp.private_messages.length >= 1) pass('export include i messaggi privati');
  else fail('export messaggi privati mancanti');
  if (exp && Array.isArray(exp.consciousness_posts) && exp.consciousness_posts.length >= 1) pass('export include i post');
  else fail('export post mancanti');

  const expBad = await rpc('export_my_account', { p_nickname: NICK, p_password_hash: 'sbagliato' });
  if (expBad && /Auth failed/.test(JSON.stringify(expBad))) pass('export con hash errato -> Auth failed');
  else fail(`export hash errato non rifiutato: ${JSON.stringify(expBad)}`);

  console.log('— Delete —');
  const delBad = await rpc('delete_my_account', { p_nickname: NICK, p_password_hash: 'sbagliato' });
  if (delBad && /Auth failed/.test(JSON.stringify(delBad))) pass('delete con hash errato -> Auth failed');
  else fail(`delete hash errato non rifiutato: ${JSON.stringify(delBad)}`);

  await rpc('delete_my_account', { p_nickname: NICK, p_password_hash: HASH });
  const prof = await sb(`profiles?nickname=eq.${encodeURIComponent(NICK)}&select=nickname`);
  if (Array.isArray(prof) && prof.length === 0) pass('delete rimuove la riga profiles');
  else fail(`profiles ancora presente: ${JSON.stringify(prof)}`);

  const msgs = await sb(`private_messages?sender_name=eq.${encodeURIComponent(NICK)}&select=id`);
  if (Array.isArray(msgs) && msgs.length === 0) pass('delete rimuove i messaggi privati');
  else fail(`messaggi ancora presenti: ${JSON.stringify(msgs)}`);

  const posts = await sb(`consciousness_posts?content=eq.${encodeURIComponent('post di test')}&select=author_nickname`);
  if (Array.isArray(posts) && posts.length >= 1 && posts[0].author_nickname === 'Utente eliminato') pass('delete anonimizza i post pubblici');
  else fail(`post non anonimizzato: ${JSON.stringify(posts)}`);

  console.log('— Teardown —');
  await cleanup();
  console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
})();
```

- [ ] **Step 2: Commit**

```bash
git add test-account-gdpr.js
git commit -m "test(gdpr): export e delete account end-to-end via RPC"
```

---

## Task 5: Applicazione DB + verifica verde (gate utente)

**Files:** nessuna modifica codice.

- [ ] **Step 1: Far applicare l'SQL in Supabase Studio**

Chiedere all'utente di eseguire `supabase/sql/06_account_gdpr.sql` nello SQL editor di Studio (guardrail "no DB senza ok"). Confermare che entrambe le `CREATE FUNCTION` vadano a buon fine.

- [ ] **Step 2: Avviare il server statico locale (se non attivo)**

Run: servire la cartella su `http://localhost:4321` (come per gli altri test).
Expected: `app.html` raggiungibile.

- [ ] **Step 3: Eseguire il test GDPR**

Run: `node test-account-gdpr.js`
Expected: tutte le asserzioni `✅`, `0 falliti`.

- [ ] **Step 4: Non-regressione suite esistenti**

Run: `node test-messaggi.js` e `node test-privacy.js`
Expected: verdi come prima (nessuna regressione).

- [ ] **Step 5: Aggiornare la memoria di progetto**

Aggiornare `project_global_awakening.md` + `MEMORY.md` con l'intervento D2/D3 (export+delete account, file SQL `06_`, RPC `export_my_account`/`delete_my_account`, anonimizzazione pubblici) e rimuovere D2-D3 dal "Prossimo".

---

## Note di verifica del piano (self-review)

- **Copertura spec:** export (Task 1+2+4), delete con anonimizzazione (Task 1+4), UI profilo (Task 2+3), modal conferma (Task 3), privacy policy IT+EN (Task 3), test (Task 4), rollout non-breaking + gate DB (Task 5). ✔
- **Scelta consapevole:** `telepathy_matches`/`telepathy_chat` esclusi dalla delete perché effimeri a TTL <5min con id opachi; documentato nel SQL. Coerente con lo spec ("effimeri auto-puliti").
- **Coerenza nomi:** RPC `export_my_account`/`delete_my_account`, param `p_nickname`/`p_password_hash`, stati `showDeleteAccount`/`deleteConfirmText`/`gdprBusy`, handler `exportMyData`/`confirmDeleteAccount` usati in modo identico tra i task.
- **Da verificare in apply:** nomi colonna effimeri (`online_users.id`, `telepathy_queue.id`, `telepathy_invites.from_id/to_id`) ricavati dagli usi in `app.html`; se Studio segnala colonna inesistente, rimuovere la singola `DELETE` (non bloccante: dati effimeri).
