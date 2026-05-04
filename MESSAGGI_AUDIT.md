# Audit di sicurezza — `private_messages`

**Data:** 2026-05-04
**Modalità:** report-only — **nessuna modifica applicata al DB**, nessun commit di codice.
**Tester:** Claude (sessione autonoma).
**Scope:** tabella `private_messages` su Supabase progetto `vxzxdkcluyrcftsnxxza` + path d'accesso lato client (`global-awakening/app.html`, righe ~2407–2505 e ~3960–3980).
**Metodo:** black-box via REST anon (`apikey` + `Authorization: Bearer <anon JWT>`), nessun accesso privilegiato al DB. Tutte le richieste eseguite con la stessa anon key che chiunque può estrarre dal sorgente di GitHub Pages (`app.html:16`).

---

## TL;DR

5 vulnerabilità trovate, tutte direttamente sfruttabili da chiunque abbia preso l'anon key (visibile in chiaro nel sorgente — è normale per la anon key, ma significa che le difese devono stare nel DB, non nel client).

| # | Severity | Cosa | Vettore |
|---|---|---|---|
| **VULN-1** | **CRITICA** | Lettura di **tutte** le conversazioni private | `GET /rest/v1/private_messages?select=*` → 200 |
| **VULN-2** | **CRITICA** | Modifica arbitraria del `content` di qualunque messaggio | `PATCH /rest/v1/private_messages?id=eq.<id>` → 200 |
| **VULN-3** | **CRITICA** | Cancellazione arbitraria di qualunque messaggio | `DELETE /rest/v1/private_messages?id=eq.<id>` → 200 |
| **VULN-4** | **ALTA** | Impersonation: `sender_name` libero in INSERT | `POST /rest/v1/private_messages` con `sender_name` arbitrario → 201 |
| **VULN-5** | **MEDIA** | Enumerazione di tutti i nickname che hanno scritto/ricevuto messaggi | `GET /rest/v1/private_messages?select=sender_name,receiver_name` → 200 |

VULN-1 è il problema più grave: la "privatezza" dei messaggi privati è completamente illusoria. Chiunque conosca l'anon key (banalmente: chiunque) può leggere ogni conversazione mai scambiata sull'app.

Stato del DB al momento del test: 4 messaggi reali totali (uso reale dei messaggi privati ancora bassissimo). Significa basso impatto **oggi**, ma il vettore è completamente aperto e non scala — appena la feature viene usata davvero, ogni nuovo messaggio è in chiaro per il mondo.

---

## Schema rilevato (dedotto da `app.html`, nessuna migration storica trovata)

```
private_messages (
  id           uuid     -- pk, default gen_random_uuid()
  sender_id    text     -- UUID pseudo (formato `<ms>-<rand>` per guest, può essere libero)
  sender_name  text     -- nickname mittente, NON validato lato server
  receiver_name text    -- nickname destinatario, NON validato lato server
  content      text
  is_read      bool
  created_at   timestamptz default now()
)
```

**Osservazione chiave:** la tabella non ha `receiver_id` né alcun riferimento a `profiles.id`. L'unica "identità" del destinatario è un nickname. Il client identifica chi sei via `nickname` (state) e `sessionId` (state) ma il backend non lega niente di tutto ciò al record.

**RLS:** non ispezionato direttamente (manca accesso a `pg_policies`), ma le policy attive sono **inerti** sulle scritture e **assenti come restrizione** sulle SELECT — comportamento osservato dai test sotto. Pattern coerente con quanto già documentato in memoria sulle altre tabelle ("Allow all USING (true)" o RLS-off).

---

## Findings

### VULN-1 — CRITICA — anon SELECT su tutti i messaggi (privacy breach)

**Impatto:** chiunque può leggere ogni messaggio privato mai scambiato sull'app. L'utente che invia un "messaggio privato" ha aspettative di confidenzialità che il sistema non rispetta in nessun modo.

**Repro:**

```powershell
$url = 'https://vxzxdkcluyrcftsnxxza.supabase.co'
$key = '<anon-key-da-app.html:16>'
$h = @{ apikey = $key; Authorization = "Bearer $key" }

Invoke-WebRequest -Uri "$url/rest/v1/private_messages?select=*&limit=3" -Headers $h
# → 200, ritorna content/sender/receiver in chiaro per tutti i messaggi
```

**Output osservato (test 2026-05-04):**

```
Status: 206
Content-Range: 0-2/5    # totale 5 prima dell'audit, 4 dopo cleanup injection
[
  {"id":"5d75…","sender_name":"Prova","receiver_name":"Irene","content":"ciao", …},
  {"id":"8dfd…","sender_name":"Prova","receiver_name":"Irene","content":"ciao", …},
  {"id":"a240…","sender_name":"ciao","receiver_name":"Irene","content":"ciao", …}
]
```

**Vettore di reconnaissance correlato (VULN-5):** un attaccante può prima enumerare tutti i `sender_name`/`receiver_name` (test 5 sotto), poi puntare le conversazioni di un utente specifico:

```
GET /rest/v1/private_messages?or=(sender_name.eq.Irene,receiver_name.eq.Irene)&select=*
# → 200, restituisce TUTTE le conversazioni che coinvolgono "Irene"
```

---

### VULN-2 — CRITICA — anon UPDATE arbitrario (riscrittura messaggi)

**Impatto:** un attaccante può riscrivere il `content` di un messaggio già consegnato. Chi lo ha inviato non ha modo di sapere che è stato modificato, chi lo riceve crede sia il testo originale. Classica "putting words in someone else's mouth".

**Repro:**

```powershell
$body = '{"content":"AUDIT-MODIFIED: an attacker just rewrote this message","is_read":true}'
Invoke-WebRequest -Uri "$url/rest/v1/private_messages?id=eq.<TARGET_ID>" `
  -Method PATCH -Headers $h -Body $body -ContentType 'application/json'
# → 200, body ritorna la riga aggiornata col nuovo content
```

**Output osservato:**

```
Status: 200
[{"id":"141b…","sender_name":"audit_test_attacker_pretending_to_be_someone",
  "content":"AUDIT-MODIFIED: an attacker just rewrote this message",
  "is_read":true, …}]
```

Lo stesso vettore permette di forzare massivamente `is_read=false` su tutti i messaggi (spam dei badge "non letto" lato vittima) o `is_read=true` (sopprimere notifiche reali).

---

### VULN-3 — CRITICA — anon DELETE arbitrario

**Impatto:** vandalismo immediato — un attaccante può svuotare l'inbox di chiunque o cancellare la propria traccia dopo un messaggio offensivo.

**Repro:**

```powershell
Invoke-WebRequest -Uri "$url/rest/v1/private_messages?id=eq.<TARGET_ID>" `
  -Method DELETE -Headers $h
# → 200, ritorna la riga cancellata; SELECT successiva conferma riga sparita
```

**Output osservato:**

```
Status: 200
[{"id":"141b…", …}]      # messaggio rimosso
# Verifica: GET ?id=eq.141b… → 200, body []  (sparito)
```

---

### VULN-4 — ALTA — impersonation in INSERT (`sender_name` libero)

**Impatto:** un attaccante può inviare messaggi che a tutti gli effetti **appaiono provenire da un altro utente**. Lato client, `sendPrivateMessage()` (`app.html:2477-2498`) prende `sender_name: nickname` dallo state — ma il backend non verifica che il chiamante "possieda" quel nickname. Inoltre, dopo l'INSERT viene anche creata una notifica con `${nickname} ti ha inviato un messaggio privato` (riga 2495), quindi la vittima riceve anche la notifica firmata col nome dell'identità impersonata.

**Repro:**

```powershell
$body = '{"sender_id":"00000000-0000-0000-0000-aaaaaaaaaaaa",
"sender_name":"Irene",
"receiver_name":"<chiunque>",
"content":"messaggio che sembra venire da Irene",
"is_read":false}'

Invoke-WebRequest -Uri "$url/rest/v1/private_messages" -Method POST -Headers $h -Body $body -ContentType 'application/json'
# → 201, riga creata con sender_name="Irene"
```

**Output osservato (`sender_name` arbitrario, accettato senza challenge):**

```
Status: 201
[{"id":"141b394d-…","sender_id":"00000000-0000-0000-0000-aaaaaaaaaaaa",
  "sender_name":"audit_test_attacker_pretending_to_be_someone",
  "receiver_name":"audit_test_victim",
  "content":"AUDIT-INJECTED: I am claiming to be someone I am not", …}]
```

L'attaccante può anche non avere mai usato l'app (nessun account, nessun guest "registrato" da `online_users`). Basta l'anon key.

---

### VULN-5 — MEDIA — enumerazione utenti via SELECT su sender/receiver

**Impatto:** reconnaissance — permette di costruire la lista completa di chi usa l'app per scambiare messaggi privati, abilitando mira mirata di VULN-1.

**Repro:**

```powershell
GET /rest/v1/private_messages?select=sender_name,receiver_name&limit=1000
# → 200, lista di nickname senza alcuna restrizione
```

Severity contenuta perché l'app già ha endpoint pubblici che espongono i nickname (`online_users`, `consciousness_posts`, ecc.). Però rimane utile come step di reconnaissance e va chiusa insieme al resto.

---

## Considerazioni di contesto (per decidere l'urgenza)

**Pro: bassa esposizione attuale**
- Solo 4 messaggi reali nel DB.
- App ancora poco usata in produzione.
- Nessuna evidenza di abuso storico (i messaggi presenti sembrano test e conversazioni iniziali con "Irene" come destinataria).

**Contro: l'esposizione cresce 1:1 con l'uso**
- Ogni nuovo messaggio scritto da oggi in poi è in chiaro.
- Se la feature viene promossa o l'app cresce, VULN-1 diventa l'esposizione singola più grossa del progetto (privacy violation per costruzione).
- VULN-2/VULN-3 abilitano vandalismo banale: bastano 5 righe di JS in console per cancellare l'inbox di chiunque.

**Vincolo strutturale (già documentato in memoria):**
- Il client custom (`app.html:24-138`) è anon-only, niente JWT utente. → `auth.uid()` non funziona, RLS "vere" impossibili senza riscrivere il client (issue #18, skippata definitivamente).
- Pattern sostenibile già adottato per `telepathy_scores` e in `feature/rituali-step-a`: **RPC SECURITY DEFINER + drop delle policy aperte sulle scritture**, mantenendo SELECT pubbliche dove serve.

**Limite "trustful":** lo stesso compromesso usato sui Rituali Step A — il client passa parametri (sender_id, sender_name) che la RPC accetta in buona fede. Chiude vandalismo banale via devtools, **non** chiude un attaccante che conosce il sender_id altrui o vuole impersonare via parametro libero. Per ownership reale serve Step B (verifica `password_hash` dentro la RPC) → copre solo account autenticati, non guest.

---

## Remediation proposta — 3 step indipendenti

Stesso pattern dei Rituali. Niente di tutto ciò è applicato; sono SQL pronti da incollare in Supabase Studio quando l'utente è davanti.

### Step A (trustful) — chiude vandalismo banale, ~45min totali

**Scopo:** spostare scritture su RPC SECURITY DEFINER e droppare le policy aperte UPDATE/DELETE/INSERT su `private_messages`. Non risolve impersonation, ma chiude UPDATE/DELETE arbitrari.

#### A.1 — RPC `send_private_message`

```sql
CREATE OR REPLACE FUNCTION public.send_private_message(
  p_sender_id     text,
  p_sender_name   text,
  p_receiver_name text,
  p_content       text
)
RETURNS private_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg private_messages%ROWTYPE;
  v_clean_content text;
BEGIN
  v_clean_content := btrim(p_content);
  IF v_clean_content = '' OR v_clean_content IS NULL THEN
    RAISE EXCEPTION 'Empty content';
  END IF;
  IF p_sender_name IS NULL OR p_sender_name = '' THEN
    RAISE EXCEPTION 'Empty sender_name';
  END IF;
  IF p_receiver_name IS NULL OR p_receiver_name = '' THEN
    RAISE EXCEPTION 'Empty receiver_name';
  END IF;
  IF length(v_clean_content) > 2000 THEN
    RAISE EXCEPTION 'Content too long';
  END IF;

  INSERT INTO private_messages (sender_id, sender_name, receiver_name, content, is_read)
  VALUES (p_sender_id, p_sender_name, p_receiver_name, v_clean_content, false)
  RETURNING * INTO v_msg;

  -- Mantiene la notifica che oggi viene creata client-side
  INSERT INTO notifications (user_nickname, type, message)
  VALUES (p_receiver_name, 'private_message',
          p_sender_name || ' ti ha inviato un messaggio privato');

  RETURN v_msg;
END $$;

GRANT EXECUTE ON FUNCTION public.send_private_message(text, text, text, text) TO anon;
```

#### A.2 — RPC `mark_message_read`

Limita UPDATE a `is_read=true` e solo per il destinatario auto-dichiarato (parametro `p_receiver_name` deve matchare il record).

```sql
CREATE OR REPLACE FUNCTION public.mark_message_read(
  p_message_id     uuid,
  p_receiver_name  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE private_messages
     SET is_read = true
   WHERE id = p_message_id
     AND receiver_name = p_receiver_name;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_message_read(uuid, text) TO anon;
```

#### A.3 — Drop policy aperte su `private_messages` (DA PERSONALIZZARE coi nomi reali)

Recuperare prima i nomi delle policy attive:

```sql
SELECT policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE tablename = 'private_messages';
```

Poi droppare quelle che permettono `INSERT`/`UPDATE`/`DELETE` per `anon`/`public`. Esempio di placeholder:

```sql
-- placeholder: sostituire <policy_name_X> con i nomi reali
DROP POLICY IF EXISTS "<policy_insert_open>" ON private_messages;
DROP POLICY IF EXISTS "<policy_update_open>" ON private_messages;
DROP POLICY IF EXISTS "<policy_delete_open>" ON private_messages;
-- IMPORTANTE: lasciare in piedi una policy SELECT (oppure creare la nuova qui sotto)
```

#### A.4 — Modifiche a `app.html`

Sostituire i 2 direct-write con chiamate RPC:

- `app.html:2479-2485` (`sendPrivateMessage`) → `await supabase.rpc('send_private_message', { p_sender_id, p_sender_name, p_receiver_name, p_content })`. La notifica creata a riga 2492-2496 va **rimossa** (la fa la RPC). L'optimistic UI resta.
- `app.html:2503` (`markAsRead` loop) → `await supabase.rpc('mark_message_read', { p_message_id: msg.id, p_receiver_name: nickname })`.

#### A.5 — Smoke test

`node test-messaggi.js` deve restare 12/12 verde.
Verifica finale via REST: `DELETE /rest/v1/private_messages?id=eq.<id>` deve tornare 401/403.

---

### Step B (privacy + ownership reale) — chiude VULN-1 per gli account autenticati, ~2h

**Scopo:** restringere SELECT in modo che solo le RPC autorizzate possano leggere messaggi, e legare l'identità del chiamante a `password_hash` della tabella `profiles`.

Idea:

1. RPC `get_my_messages(p_nickname, p_password_hash)` — fa SELECT del proprio inbox solo se `(nickname, password_hash)` matcha `profiles`. Altrimenti `RAISE EXCEPTION`.
2. Drop di tutte le policy SELECT aperte. Nessuno legge più via REST diretto.
3. Modifica `app.html:2412-2413` per usare la RPC.

**Limite:** non copre i guest (non hanno password). Per i guest si può accettare l'esposizione (sono "anonimi" per design e raramente ricevono messaggi privati), oppure forzare la creazione di un account per usare la feature.

**Inoltre:** modificare `send_private_message` (Step A.1) per ricevere anche `p_password_hash` quando il sender è loggato, e validarlo. → impersonation chiusa per gli account.

(Lascio Step B in forma di nota di design — vale la pena progettarlo solo dopo aver visto come gira Step A.)

---

### Step C (cleanup) — opzionale

- Aggiungere `receiver_id uuid REFERENCES profiles(id)` per smettere di identificare destinatari per nickname (un nickname rinominato oggi rompe la cronologia).
- Aggiungere `CHECK (length(content) BETWEEN 1 AND 2000)` lato DB.
- Se Step B è in piedi, droppare anche la RPC `send_private_message` "trustful" e tenerne solo la versione autenticata.

---

## Cleanup post-audit

L'unico record creato dai test è stato cancellato dallo stesso flusso di test (TEST 3 → DELETE arbitrario). Verificato in TEST 4 con `GET ?id=eq.141b394d-… → []`. Niente residui.

ID injection di riferimento (per audit trail futuro): `141b394d-88ea-46df-8175-b193f2a75a38` — non più presente nel DB.

---

## Punto di ripartenza per la prossima sessione

1. Decidere se procedere con **Step A** (trustful, chiude vandalismo) o saltare direttamente a **Step B** (privacy reale, ma più lungo). Raccomandazione: prima A, poi valutare B.
2. Se A: serve l'utente loggato su Supabase Studio per applicare gli SQL e per fare `SELECT * FROM pg_policies WHERE tablename = 'private_messages'` (richiesto da A.3).
3. Branch suggerito (non ancora creato): `feature/messaggi-step-a` — analogamente a `feature/rituali-step-a`. Posso prepararlo in una prossima sessione.
4. Tempo stimato Step A: ~45min con l'utente davanti.

**Caveat:** report scritto **prima** del deploy di `feature/rituali-step-a`. Se i Rituali Step A vengono deployati prima e si scopre qualche aggiustamento al pattern (es. nomi delle policy, edge case nelle RPC), valgono anche qui — vale la pena replicare le stesse correzioni.
