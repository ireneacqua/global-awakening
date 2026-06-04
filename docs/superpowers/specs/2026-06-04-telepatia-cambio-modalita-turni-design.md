# Telepatia: cambio-modalità a turni + avviso cambio-ruolo — Design

**Data:** 2026-06-04 · **Stato:** design approvato, in attesa review spec
**Origine:** bug report utente (test dal vivo). Il vecchio meccanismo "accordo tra i due"
dava un'esperienza confusa: su scelte diverse, chi cliccava per primo tornava ai simboli
**senza alcun messaggio** (causa radice tracciata: `proposeLevelChange` dà `disagreement`
solo al secondo; il primo riceve `pending` e il polling fa `setShowLevelBanner(false)` muto).

## Obiettivo

Sostituire il modello "entrambi scelgono e devono concordare" con un modello **unilaterale a
turni**, più chiaro. In più, rendere **evidente** l'avviso di cambio-ruolo (ogni 3 round).

## Comportamento desiderato

### A) Cambio-modalità a turni (ogni 7 round)
- **Sceglie una persona sola**, la scelta **si applica subito** (no accordo).
- **Chi sceglie si alterna** per cambio successivo. "Primo chooser" = **`user1` del match**:
  - invito diretto → `user1` = chi ha invitato (= il proponente);
  - random → `user1` = chi era in coda (deterministico).
  - Cambio #k (k = `roundCount / 7`): k **dispari** → `user1`, k **pari** → `user2`.
- Il **chooser** vede i bottoni: Simboli / Numeri / Parole / **Resta così**. Alla scelta il
  gioco prosegue subito con quella modalità.
- Il **passivo** vede solo un messaggio **"[nome] sta scegliendo la nuova modalità…"** e può
  unicamente **Interrompere** la sessione. Niente bottoni di scelta.

### B) Avviso cambio-ruolo più evidente (ogni 3 round)
Il banner esiste già (`roleSwapNotice`, app.html:4014) ma è poco visibile. Renderlo prominente
e con testo chiaro, es. **"🔄 Cambio ruolo — ora sei: Sender/Receiver"**.

## Design tecnico (client-only, NESSUN SQL nuovo)

`telepathy_matches` è già scrivibile da anon (il client fa update diretti: sender_symbol,
receiver_guess, ecc.). Quindi:

- **Slot del client:** `mySlot = (sessionId === match.user1_id) ? 'user1' : 'user2'`
  (salvare `user1_id` all'avvio del match).
- **Turno:** `chooserSlot = (k % 2 === 1) ? 'user1' : 'user2'`, con `k = Math.floor(roundCount/7)`
  (il banner scatta già a `roundCount>=7 && roundCount%7===0`). `amIChooser = (mySlot === chooserSlot)`.
- **Scelta (solo chooser):** `update({ level: <scelto o currentLevel>, level_change_choice_sender: 'r'+bannerRound })`.
  Il `level` porta la nuova modalità; il marcatore `'r'+bannerRound` segnala "scelta fatta"
  (serve per il caso "Resta così", in cui `level` non cambia).
- **Dismiss (entrambi):** quando il polling vede `match.level_change_choice_sender === 'r'+bannerRound`
  → `setCurrentLevel(match.level)`, `setShowLevelBanner(false)`, riprende il gioco.
  Marcatori vecchi ('r7' al cambio di round 14) sono ignorati → nessuna pulizia necessaria.
- **Rimozioni:** non si usano più `proposeLevelChange` con la RPC `apply_level_change_if_both_agree`,
  né lo stato/branch `levelDisagreement`. La RPC e le colonne restano nel DB come **codice morto**
  (pulizia SQL opzionale, fuori scope).

### Riuso colonna
`level_change_choice_sender` (text, nessun vincolo a livello colonna) viene riusata come
marcatore di risoluzione. `level_change_choice_receiver` non più usata.

## Componenti toccati
- `app.html`: stato/derivazioni chooser, handler scelta (update diretto), render condizionale
  banner (chooser = bottoni; passivo = messaggio attesa + stop), rimozione UI disaccordo,
  banner cambio-ruolo più evidente.
- i18n (`t.telepathy.*`, IT+EN): nuove stringhe ("[X] sta scegliendo…", "Resta così",
  testo cambio-ruolo chiaro).
- `test-telepathy.js`: Test 11 (cambio livello) e Test 12 (ex "disagreement") riscritti sul
  nuovo flusso a turni.

## Verifica
- Suite E2E verde dopo le modifiche (in particolare i Test 11/12 riscritti + gli altri invariati).
- Smoke manuale dal vivo del flusso: 2 utenti, arrivo al cambio a round 7, il chooser sceglie,
  il passivo vede l'attesa e poi prosegue; verifica anche "Resta così".
- Niente push finché non è tutto verde.

## Fuori scope
- Pulizia SQL della RPC/colonne morte (eventuale, separata).
- La precompilazione JSX + CSP (in pausa, si riprende dopo).

## Rischi
- **Deadlock passivo** se manca il segnale di risoluzione → mitigato dal marcatore `'r'+round`.
- **Identità slot** errata → si deriva da `user1_id`/`user2_id` del match (stabili).
- **Regressione E2E** → i Test 11/12 vanno riscritti coerentemente; gli altri non toccano
  questo flusso.
