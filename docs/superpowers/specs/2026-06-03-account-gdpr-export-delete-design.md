# D2/D3 — Export ed eliminazione account (GDPR) · Design

Data: 2026-06-03
Stato: approvato (default consigliati)

## Obiettivo

Rendere self-service in-app i diritti GDPR di **export** (D2) ed **eliminazione**
(D3) dell'account, oggi gestiti "manualmente su richiesta" (vedi privacy policy in
`app.html`). Chiude il capitolo diritti-utente avviato con la privacy policy del 06-02.

## Contesto / modello dati

Identità utente in `profiles` (chiave logica `nickname` + `email`, più `session_id`;
credenziale `password_hash`). L'identità è frammentata su tre chiavi:

- `nickname` → `private_messages.sender_name/receiver_name`, `notifications.user_nickname`,
  `consciousness_posts.author_nickname`, `consciousness_comments.author_nickname`,
  `ritual_comments.author_nickname`, `rituals.creator`, `chat_messages.user_name`.
- `email` → `profiles.email`, `telepathy_scores.user_id`, `magic_links.email`,
  `password_resets.email`.
- `session_id` (`profiles.session_id`) → `rituals.creator_id` + array `participants`,
  effimeri telepatia (`telepathy_queue/matches/invites/chat`), `online_users`.

Schema rilevante (verificato vs file SQL e `app.html`):
- `profiles(session_id, nickname, email, password_hash, bio, starseed_type, avatar,
  country, interests, experience_level, telepathy_score, telepathy_best,
  show_telepathy_score)`
- `private_messages(id, sender_id, sender_name, receiver_name, content, is_read, created_at)`
- `notifications(id, user_nickname, type, message, read, created_at)`
- `consciousness_posts(id, author_nickname, content, created_at)`
- `consciousness_comments(id, post_id, author_nickname, content, created_at)`
- `rituals(id, creator, creator_id, name, description, type, sacred_number, date, time,
  duration, participants jsonb, energy)`
- `ritual_comments(id, ritual_id, author_nickname, content, created_at)`
- `chat_messages(id, user_name, content, created_at)` — chat globale (possibile codice morto)
- `telepathy_scores(user_id, rounds_count, matches_count)` — `user_id` = email per i registrati

## Pattern tecnico (riuso Step B)

RPC `SECURITY DEFINER SET search_path = public`, autenticate con `(p_nickname,
p_password_hash)` validate contro `profiles` (stesso meccanismo di `get_my_messages`).
Solo utenti **registrati** (guest esclusi: non hanno riga `profiles`). Rollout
**non-breaking**: RPC additive con `GRANT EXECUTE … TO anon`; nessuna policy da droppare.
File: `supabase/sql/06_account_gdpr.sql`, idempotente (`CREATE OR REPLACE`).

## Componenti

### 1. RPC `export_my_account(p_nickname text, p_password_hash text) RETURNS jsonb`

Valida la coppia (nickname, hash) → altrimenti `RAISE EXCEPTION 'Auth failed'`.
Ritorna un singolo `jsonb` con le sezioni:
`profile`, `private_messages` (inviati + ricevuti), `consciousness_posts`,
`consciousness_comments`, `ritual_comments`, `rituals_created`, `telepathy_scores`,
`notifications`. `profile` esclude `password_hash` (mai esportato).

### 2. RPC `delete_my_account(p_nickname text, p_password_hash text) RETURNS void`

Valida (nickname, hash). In transazione (corpo unico plpgsql):

**Anonimizza contenuti pubblici** (preserva thread/conversazioni altrui), sentinella
`'Utente eliminato'`:
- `consciousness_posts.author_nickname`, `consciousness_comments.author_nickname`,
  `ritual_comments.author_nickname`, `rituals.creator`, `chat_messages.user_name`.
- `rituals.creator_id` e l'array `participants`: lasciati invariati (id opaco, non PII
  identificabile; toglierlo dall'array sballerebbe il conteggio partecipanti).

**Cancella dati personali/privati:**
- `private_messages` dove `sender_name = nick OR receiver_name = nick` (chat 1:1 intera).
- `notifications` dove `user_nickname = nick`.
- `telepathy_scores` dove `user_id = email`.
- effimeri per `session_id`: `telepathy_queue`, `telepathy_matches` (dove coinvolto),
  `telepathy_invites` (from/to), `telepathy_chat` (se legato), `online_users`.
- `magic_links` e `password_resets` dove `email = …`.

**Cancella l'identità:** `DELETE FROM profiles WHERE nickname = … AND email = …`.

### 3. UI in `app.html` (modal profilo)

Nuova sezione "I tuoi dati (GDPR)", solo per registrati (`!isGuest`):
- **Esporta i miei dati**: chiama `export_my_account`, serializza il JSON, forza il
  download come `global-awakening-dati-<nickname>.json` (Blob + anchor). Loading + toast
  d'errore (pattern robustezza scritture già adottato).
- **Elimina account**: apre conferma con campo "digita il tuo nickname per confermare";
  a match → chiama `delete_my_account` → logout completo + pulizia `localStorage`
  (`ga_nickname`, `ga_email`, `ga_is_guest`, `ga_pwhash`, …) + redirect allo stato login.
  Loading + toast d'errore. Testo i18n IT/EN.

### 4. Privacy policy

Aggiornare il paragrafo "I tuoi diritti" / "Your rights" (IT+EN) in `app.html`:
rimuovere "deletion and export are currently handled manually on request" → indicare che
sono self-service dal profilo. Mantenere il riferimento GitHub per gli altri diritti.

## Error handling

- Auth fallita → eccezione `Auth failed`; il client mostra toast d'errore, nessun dato.
- Errori di rete/RPC → toast d'errore, nessuna pulizia `localStorage` né logout (delete).
- Delete idempotente: ri-chiamata dopo cancellazione → `Auth failed` (profilo già assente).

## Testing (`test-account-gdpr.js`, Playwright + REST anon)

1. Setup: registra un utente di prova con contenuti (post, commento, messaggio, rituale).
2. Export con hash corretto → JSON contiene tutte le sezioni attese; `profile` senza hash.
3. Export con hash errato → errore `Auth failed`.
4. Delete con hash corretto → `profiles` rimosso; `private_messages` dell'utente assenti;
   `consciousness_posts/comments`, `ritual_comments`, `rituals.creator` → `'Utente eliminato'`;
   `telepathy_scores`/`notifications` rimossi.
5. Guest/hash errato → delete negato.
6. Nessuna regressione su suite esistenti (auth, messaggi, rituali, coscienza, privacy).

> Nota backlog: come per `test-messaggi`, il test può lasciare dati residui da pulire a
> mano da Studio se non auto-purga.

## Rollout

1. Eseguire `supabase/sql/06_account_gdpr.sql` in Supabase Studio (additivo, non-breaking).
2. Push del client (`app.html`) con UI + privacy policy aggiornata.
3. Eseguire `test-account-gdpr.js` a verde.

## Out of scope (YAGNI)

- Periodo di grazia / soft-delete con ripristino.
- Export in formati diversi dal JSON (no CSV/PDF).
- Scelta per-utente anonimizza-vs-cancella (default: anonimizza i pubblici).
