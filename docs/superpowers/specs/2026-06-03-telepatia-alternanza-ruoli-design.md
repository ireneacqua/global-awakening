# Alternanza ruoli sender/receiver ogni 3 round (Batch C #5) · Design

Data: 2026-06-03
Stato: approvato (procedi con cautela — feature ad alto rischio su codice fragile)

## Obiettivo

Nella telepatia, far **alternare i ruoli** mittente/ricevente ogni 3 round, così
entrambi i partner sperimentano entrambi i ruoli nel corso di una sessione. Oggi il
ruolo è assegnato casualmente alla creazione del match e resta fisso per tutta la
sessione.

## ⚠️ Nota di rischio

Tocca la macchina a stati della telepatia, il codice più fragile/timing-sensitive
dell'app; `test-telepathy` è flaky (multi-browser). Decisione utente: procedere con
cautela. Strategia di test: unit test della formula pura + ispezione accurata del
mapping risultato + smoke E2E best-effort + non-regressione (rilanciando test-telepathy
se flaky). Zero modifiche al DB (riduce la superficie di rischio).

## Approccio: ruolo derivato (niente nuovo stato condiviso, niente DB)

`round_count` è già sincronizzato nel DB tra i due client (`telepathy_matches`), e
`roundCount` (state) ne deriva. Lo state `role` resta il **ruolo base** assegnato dal
match e riletto dai polling (invariato).

Funzione pura:
```javascript
const swapRole = (r) => r === 'sender' ? 'receiver' : 'sender';
// round è 0-based (roundCount): round 0,1,2 -> blocco 0; 3,4,5 -> blocco 1; ...
const roleForRound = (baseRole, round) =>
  (Math.floor(round / 3) % 2 === 0) ? baseRole : swapRole(baseRole);
```
Derivata nel corpo del componente:
```javascript
const effectiveRole = role ? roleForRound(role, roundCount) : role;
```
Poiché entrambi i client condividono `round_count` e hanno `baseRole` opposti, i loro
`effectiveRole` restano sempre opposti e coerenti — **senza scritture extra né race**.

### Perché è corretto sul mapping del risultato (punto critico)

Il risultato di un round si processa in `pollResult` (~2238) PRIMA di `setRoundCount(newRound)`
(~2248). In quel momento `roundCount` è ancora il valore del round **appena giocato**,
quindi `effectiveRole` calcolato lì mappa il risultato col ruolo giusto. Subito dopo,
`setRoundCount(newRound)` aggiorna e `effectiveRole` si ricalcola per il round successivo.

## Punti di modifica in `app.html` (LETTURE di `role` → `effectiveRole`)

Sostituire `role` con `effectiveRole` SOLO in questi usi (logica di gioco + UI):
- ~2177 `p_role: role` (apply_level_change) e ~2192/2193 (mapping myChoice/theirChoice).
- ~2241 `setPartnerSymbol(role === 'sender' ? ...)` (mapping risultato).
- ~2254 `if (role === 'sender')` (solo l'effective-sender scrive il DB).
- ~2375 `role !== 'receiver'` (la guess la fa l'effective-receiver).
- ~2602 `if (role === 'sender')`, ~2614/2615 `isMyTurn` (sender/receiver).
- UI: ~3929 (label ruolo), ~3994/4008/4030/4047/4051 (rendering condizionale).

**NON toccare:** definizione `const [role,...]` (1204); le assegnazioni
`setRole(amUser1 ? user1_role : user2_role)` (1559/1583/1633/2350) che fissano il
baseRole; `setRole(null)`/`setRole(myRole)` (reset/creazione). `effectiveRole` si deriva
sempre da quel baseRole.

**Dependency array:** aggiungere `roundCount` agli useEffect che ora usano
`effectiveRole` internamente: `pollResult` (~2274) e la guess-effect (~2387). Senza
questo, le closure userebbero un `roundCount` stale.

`effectiveRole` va definito subito dopo gli state `role` (1204) e `roundCount` (1221),
prima del primo uso. `swapRole`/`roleForRound` come helper puri vicino agli altri helper.

## Notifica di cambio ruolo (UX)

Nuovo state `roleSwapNotice` (string|null). In `pollResult`, dove si calcola `newRound`
(~2246) e si fa `setRoundCount(newRound)`: se `newRound % 3 === 0` (si entra in un nuovo
blocco a partire dal round successivo), impostare
`roleSwapNotice = roleForRound(role, newRound)` e auto-dismiss dopo ~6s (pattern di
`levelDisagreement`). Banner/toast: "🔄 Ruoli invertiti! Ora sei {mittente|ricevente}".
i18n `t.telepathy.roleSwapped*` IT/EN. Mostrato nell'area telepatia attiva.

## Error handling

- Nessun nuovo path di rete (logica pura derivata). Gli errori di gioco esistenti
  restano gestiti come oggi.
- Se `role` è `null` (fuori sessione), `effectiveRole` è `null` (nessun cambiamento di
  comportamento rispetto a oggi).

## Testing

1. **Unit test formula** (`test-telepathy-role-rotation.js`, Node puro): replica
   `roleForRound`/`swapRole` e verifica: round 0-2 → base; 3-5 → swap; 6-8 → base; 9-11
   → swap; e che i due baseRole opposti restino opposti a ogni round. (La funzione è
   inline nel monolite e non importabile: il test verifica la *logica*, che nel codice è
   una copia 1:1 banale — annotato onestamente.)
2. **Non-regressione** `test-telepathy.js` (rilanciare se flaky): il flusso base di un
   match a pochi round non deve rompersi (i primi 3 round usano il baseRole = comportamento
   identico a oggi, quindi i test esistenti che giocano < 3 round restano verdi).
3. **Smoke E2E best-effort** a 2 browser: giocare ≥4 round e osservare l'inversione +
   banner. Documentare se la flakiness impedisce un esito stabile.

## Out of scope (YAGNI)

- Periodicità configurabile (resta fissa a 3).
- Persistenza dell'inversione nel DB (non serve: derivata dal round condiviso).
- Animazioni elaborate del cambio (basta banner testuale auto-dismiss).
