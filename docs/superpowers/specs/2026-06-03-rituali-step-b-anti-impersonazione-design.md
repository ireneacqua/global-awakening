# Rituali Step B — anti-impersonazione (B6) · Design

Data: 2026-06-03
Stato: approvato

## Obiettivo

Chiudere **VULN-4** (RITUALI_AUDIT.md): le RPC `create_ritual` e
`create_ritual_comment` accettano `p_creator`/`p_author_nickname` senza validarli,
quindi chiunque (anon, da devtools) può pubblicare un rituale o un commento
**spacciandosi per un utente registrato**. Estende ai contenuti rituali lo stesso
principio anti-impersonazione già applicato ai messaggi privati (Step B), adattato
alla natura **pubblica** della feature.

## Contesto

- **Già chiuso (Rituali Step A, 2026-05-04):** scritture dirette anon su
  `rituals`/`ritual_comments` bloccate da RLS; le RPC `SECURITY DEFINER` sono
  l'unico canale di scrittura.
- **Aperto (VULN-4):** le RPC non verificano che il chiamante sia davvero
  l'autore dichiarato.
- Client: `create_ritual` chiamata in 2 punti (`createRitual` ~`app.html:2854`,
  `createTestRitual` ~2897) con `p_creator`/`p_creator_id`; `create_ritual_comment`
  in `createRitualComment` ~2957 con `p_author_nickname`. Nessuna passa l'hash.
- Lo state `passwordHash` (registrati) / `null` (guest) è disponibile nel componente.
- Schema (Step A): `rituals(creator, creator_id, name, description, type,
  sacred_number, date, time, duration, participants jsonb, energy)`;
  `ritual_comments(ritual_id, author_nickname, content)`.

## Principio: validazione **condizionale** (non "solo registrati")

I rituali e i commenti sono **contenuti pubblici**: l'obiettivo è impedire
l'impersonazione di un account registrato, non escludere i guest. Regola applicata
in entrambe le RPC, sul nickname/creator dichiarato `N` e hash fornito `H`:

> Se esiste una riga `profiles` con `nickname = N`:
>   - se `H` combacia con `profiles.password_hash` → procedi;
>   - altrimenti → `RAISE EXCEPTION 'Auth failed'`.
> Se NON esiste `profiles` con `nickname = N` (= guest / nick libero) → procedi.

Effetto: i registrati provano l'identità; i guest pubblicano col proprio nick;
nessuno (guest o altro registrato) può usare il nick di un registrato.

## Componenti

### 1. DB — `supabase/sql/07_rituali_step_b.sql` (staged, non-breaking)

Idempotente (`CREATE OR REPLACE` / `DROP FUNCTION IF EXISTS`). Tre blocchi:

**BLOCCO 1 (Fase 1 — eseguire ORA):** nuovi overload con `p_password_hash`.
- `create_ritual(p_creator, p_creator_id, p_name, p_description, p_type,
  p_sacred_number, p_date, p_time, p_duration, p_password_hash text)` — stessa logica
  di Step A + guard condizionale all'inizio. Mantiene validazioni esistenti
  (`name_required`, `duration_out_of_range`) e l'INSERT con `participants =
  jsonb_build_array(p_creator_id)`.
- `create_ritual_comment(p_ritual_id, p_author_nickname, p_content, p_password_hash
  text)` — stessa logica di Step A + guard condizionale. Mantiene `content_required`,
  `content_too_long`, `ritual_not_found`.
- Entrambe `GRANT EXECUTE … TO anon`. Convivono con le firme a 9 / 3 parametri.

Helper guard condizionale (inline in ciascuna RPC, niente funzione separata per
restare semplice):
```sql
IF EXISTS (SELECT 1 FROM profiles WHERE nickname = <N>) THEN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE nickname = <N> AND password_hash = p_password_hash) THEN
    RAISE EXCEPTION 'Auth failed';
  END IF;
END IF;
```

**BLOCCO 2 (Fase 3 — eseguire DOPO il deploy del client):** chiude VULN-4.
- `DROP FUNCTION IF EXISTS create_ritual(text,text,text,text,text,int,date,time,int);`
- `DROP FUNCTION IF EXISTS create_ritual_comment(bigint,text,text);`

**BLOCCO 3:** verifica post-apply (probe via REST anon).

### 2. Client (`app.html`)

Aggiungere `p_password_hash: passwordHash` alle 3 chiamate RPC:
- `createRitual` (~2854), `createTestRitual` (~2897): nuovo campo nel params object.
- `createRitualComment` (~2957): idem.
Nessun'altra modifica (gli handler già gestiscono `error` con `showErrorToast`).
`passwordHash` è `null` per i guest → serializzato come `null`, accettato dal ramo
"nick non registrato" della RPC.

### 3. Sequenza di deploy (nessuna finestra di rottura)

1. Eseguire BLOCCO 1 in Studio (overload additivi).
2. Push client che usa gli overload con hash.
3. Eseguire BLOCCO 2 in Studio (drop firme vecchie). Da qui VULN-4 chiusa.

## Error handling

- Hash errato/assente sul nick di un registrato → `Auth failed`; client mostra
  `showErrorToast()`, form non svuotato (comportamento attuale su error).
- Guest (`passwordHash=null`, nick non in profiles) → nessun errore, pubblica.
- Errori rete/RPC → toast, già gestito.

## Testing

`test-rituali-impersonation.js` (REST/RPC anon, pattern `test-messaggi.js`):
1. Registra utente `R` (profiles con nickname+hash).
2. `create_ritual` con `p_creator=R` e hash corretto → ok (ritorna riga).
3. `create_ritual` con `p_creator=R` e hash errato → errore `Auth failed`.
4. `create_ritual` con `p_creator=R` e hash assente/`null` → errore `Auth failed`.
5. `create_ritual` con `p_creator='GuestLibero_<ts>'` (non in profiles), hash `null`
   → ok.
6. `create_ritual_comment` analogo: hash giusto su `R` ok; hash errato su `R`
   → `Auth failed`; guest libero ok.
7. Cleanup dei dati di test (DELETE profiles/rituals di prova via REST; NB i rituali
   con creator registrato non sono cancellabili da anon → usare `creator_id` o
   lasciarli scadere; per il test usare date già scadute così `cleanup_expired_rituals`
   li rimuove).

Non-regressione: `test-rituali.js` 18/18 (aggiornato per passare `p_password_hash`
dove costruisce rituali via RPC, se applicabile), più suite adiacenti invariate.

## Out of scope (YAGNI)

- Delete/update "my ritual/comment" con colonne FK `creator_user_id`/`author_user_id`
  (l'audit le abbozza): **non c'è UI** di modifica/cancellazione rituali nel client.
- `join_ritual` / `send_ritual_energy`: niente impersonazione rilevante
  (session_id / azione anonima).
- Nessuna nuova colonna in `rituals`/`ritual_comments`.
