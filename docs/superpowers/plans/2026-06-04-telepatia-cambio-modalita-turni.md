# Telepatia: cambio-modalità a turni + avviso cambio-ruolo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (esecuzione inline con checkpoint). Steps con checkbox `- [ ]`.

**Goal:** Sostituire il cambio-modalità "ad accordo" con uno **unilaterale a turni** (chooser = user1 al 1° cambio, poi alterna) e rendere evidente l'avviso di cambio-ruolo. Solo client (`app.html` + i18n + test), nessun SQL nuovo.

**Architecture:** A ogni cambio (round 7,14,…): un solo "chooser" sceglie e scrive `level` su `telepathy_matches`; il passivo vede un messaggio d'attesa. Un marcatore su `level_change_choice_sender` (`'r'+bannerRound`) segnala "scelta fatta" (gestisce anche "Resta così"). La rete di sicurezza è la suite E2E.

**Tech Stack:** app.html (React UMD + Babel runtime), Supabase REST diretto, Playwright E2E.

**Prerequisiti:** server `npx serve . -p 4321` attivo; `.env.test` con service key; baseline E2E verde (telepatia 28/28). Riferimento design: `docs/superpowers/specs/2026-06-04-telepatia-cambio-modalita-turni-design.md`.

---

## File Structure
- **Modify `app.html`** — stato/derivazione chooser; handler scelta (update diretto + marcatore); dismiss su marcatore nei due poll; render condizionale (chooser=bottoni, passivo=attesa); rimozione UI disaccordo; banner cambio-ruolo più evidente; nuove stringhe i18n.
- **Modify `test-telepathy.js`** — riscrittura Test 11/12 sul flusso a turni.

---

## MILESTONE 1 — Logica chooser (derivazione + handler)

### Task 1: Cattura user1_id e deriva lo slot/chooser

**Files:** Modify `app.html`

- [ ] **Step 1: Aggiungi stato per user1_id del match**

Vicino agli altri useState della telepatia (≈1247-1250) aggiungi:
```js
const [matchUser1Id, setMatchUser1Id] = useState(null);
```

- [ ] **Step 2: Popola matchUser1Id quando il match parte/è noto**

Nei punti dove si imposta `matchId` con i dati del match (creazione random ≈1658, accettazione invito ≈2561, e nel pollResult dove si legge `match`), imposta anche `setMatchUser1Id(match.user1_id)` (o `data.user1_id` alla creazione). Garantire che venga valorizzato appena disponibile. (In pollResult ≈2275, dopo `const match = data[0];`, aggiungi: `if (match.user1_id && matchUser1Id == null) setMatchUser1Id(match.user1_id);`.)

- [ ] **Step 3: Aggiungi le derivazioni chooser (dopo roundCount/effectiveRole, ≈1255)**

```js
// Cambio-modalità a turni: "primo chooser" = user1 del match.
const mySlot = (matchUser1Id != null)
  ? (sessionId === matchUser1Id ? 'user1' : 'user2')
  : null;
const levelChangeIndex = Math.floor(roundCount / 7); // k: 1 al round 7, 2 al 14, ...
const chooserSlot = (levelChangeIndex % 2 === 1) ? 'user1' : 'user2';
const amIChooser = (mySlot !== null) && (mySlot === chooserSlot);
const chooserNickname = (chooserSlot === 'user1')
  ? (partner && mySlot === 'user2' ? partner.nickname : (nickname || 'Tu'))
  : (partner && mySlot === 'user1' ? partner.nickname : (nickname || 'Tu'));
```
(NB: il nome del chooser per il passivo è il `partner.nickname`; verificare il nome reale dello state del partner — usare quello già usato nei messaggi di stato.)

- [ ] **Step 4: Verifica sintassi (build non necessaria, è runtime). Smoke caricamento.**

Run smoke (server attivo):
```bash
node -e "const{chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();const e=[];p.on('console',m=>{if(m.type()==='error')e.push(m.text())});p.on('pageerror',x=>e.push(String(x)));await p.goto('http://localhost:4321/app.html',{waitUntil:'networkidle'});const g=await p.locator('button:has-text(\"Ospite\"),button:has-text(\"Guest\")').count();await b.close();console.log('err:',e.length?e:'nessuno','| guest:',g>0);process.exit(g>0&&e.length===0?0:1)})()"
```
Expected: `err: nessuno | guest: true`. (Le nuove derivazioni non rompono il render.)

- [ ] **Step 5: Commit**
```bash
git add app.html
git commit -m "telepatia: deriva slot/chooser a turni (user1 primo, poi alterna)"
```

---

### Task 2: Handler di scelta unilaterale (sostituisce proposeLevelChange)

**Files:** Modify `app.html` (`proposeLevelChange` ≈2230-2259)

- [ ] **Step 1: Sostituisci il corpo di proposeLevelChange con la scelta unilaterale**

```js
// Cambio-modalità a turni: solo il chooser scrive. choice ∈ 'shapes'|'numbers'|'words'|'keep'.
const proposeLevelChange = async (choice) => {
  const bannerRound = Math.floor(roundCount / 7) * 7; // 7,14,...
  const newLevel = (choice === 'keep') ? currentLevel : choice;
  setCurrentLevel(newLevel);
  setShowLevelBanner(false);
  lastProcessedRoundRef.current = -1;
  await supabase.from('telepathy_matches').update({
    level: newLevel,
    level_change_choice_sender: 'r' + bannerRound, // marcatore "scelta fatta" (anche per 'keep')
  }).eq('id', matchId);
};
```

- [ ] **Step 2: Rimuovi lo stato/effetto/branch del disaccordo**

- Rimuovi `levelDisagreement` state e il suo `useEffect` di auto-dismiss (≈1284-1290).
- Rimuovi il render del banner disaccordo (≈4020-4026, blocco `{levelDisagreement && (...)}`).
- Rimuovi `myLevelChoice`/`setMyLevelChoice` se non più usati altrove (verificare con grep prima di togliere).

- [ ] **Step 3: Commit**
```bash
git add app.html
git commit -m "telepatia: scelta livello unilaterale (update diretto + marcatore), rimosso disaccordo"
```

---

## MILESTONE 2 — Dismiss e render

### Task 3: Dismiss su marcatore nei due poll

**Files:** Modify `app.html` (pollResult ≈2277-2293, pollLevelChange ≈2383-2400)

- [ ] **Step 1: In pollResult, sostituisci la sync livello + dismiss con la logica a marcatore**

Sostituisci il blocco "Sincronizza livello" + "choices azzerate" (≈2277-2293) con:
```js
// Cambio-modalità a turni: il chooser ha scritto level + marcatore 'r'+bannerRound.
const bannerRound = Math.floor(roundCount / 7) * 7;
if (showLevelBanner && match.level_change_choice_sender === 'r' + bannerRound) {
  if (match.level && match.level !== currentLevel) setCurrentLevel(match.level);
  setShowLevelBanner(false);
  lastProcessedRoundRef.current = -1;
}
```

- [ ] **Step 2: Allinea pollLevelChange (≈2376-2400) alla stessa logica**

Sostituisci i due "Caso" con:
```js
const bannerRound = Math.floor(roundCount / 7) * 7;
if (match.level_change_choice_sender === 'r' + bannerRound) {
  if (match.level && match.level !== currentLevel) setCurrentLevel(match.level);
  setShowLevelBanner(false);
}
```

- [ ] **Step 3: Smoke caricamento** (come Task 1/Step 4). Expected: nessun errore console.

- [ ] **Step 4: Commit**
```bash
git add app.html
git commit -m "telepatia: dismiss banner su marcatore scelta (gestisce anche Resta cosi')"
```

---

### Task 4: Render condizionale del banner (chooser vs passivo) + i18n

**Files:** Modify `app.html` (render banner livello ≈4086; blocco i18n `t.telepathy`)

- [ ] **Step 1: Aggiungi le stringhe i18n (IT ed EN) nel blocco telepathy**

Aggiungi a `t.telepathy` (entrambe le lingue):
```js
// IT
levelChooseTitle: 'Scegli la nuova modalità',
levelKeep: 'Resta così',
levelWaiting: 'sta scegliendo la nuova modalità di gioco…', // uso: `${chooserNickname} ${levelWaiting}`
roleSwapTitle: '🔄 Cambio ruolo',
// EN
levelChooseTitle: 'Choose the new mode',
levelKeep: 'Keep current',
levelWaiting: 'is choosing the new game mode…',
roleSwapTitle: '🔄 Role switch',
```
(Verificare le chiavi già esistenti per Numeri/Parole/Forme/Numbers/Words/Shapes da riusare nei bottoni.)

- [ ] **Step 2: Render condizionale nel blocco showLevelBanner (≈4086)**

Struttura:
```jsx
{showLevelBanner && (
  amIChooser ? (
    <div /* banner scelta: titolo + 4 bottoni */>
      {/* t.telepathy.levelChooseTitle */}
      {/* bottoni: Simboli/Shapes, Numeri/Numbers, Parole/Words → onClick={() => proposeLevelChange('shapes'|'numbers'|'words')} */}
      {/* bottone Resta così → onClick={() => proposeLevelChange('keep')} */}
    </div>
  ) : (
    <div role="status" /* banner attesa passivo */>
      {`${chooserNickname} ${t.telepathy.levelWaiting}`}
      {/* nessun bottone di scelta: l'utente può solo usare il controllo Termina/X già presente */}
    </div>
  )
)}
```
Mantieni gli stili coerenti col banner esistente. I bottoni di scelta esistenti (Numeri/Parole/ecc.) vanno riusati: prendere i loro testi/handler attuali e collegarli a `proposeLevelChange('numbers'|'words'|'shapes')`; aggiungere "Resta così" → `proposeLevelChange('keep')`.

- [ ] **Step 3: Smoke caricamento.** Expected: nessun errore console; bottone Ospite presente.

- [ ] **Step 4: Commit**
```bash
git add app.html
git commit -m "telepatia: banner scelta solo al chooser; passivo vede attesa + i18n"
```

---

### Task 5: Avviso cambio-ruolo più evidente

**Files:** Modify `app.html` (render `roleSwapNotice` ≈4014-4018)

- [ ] **Step 1: Rendi il banner più prominente e chiaro**

Aggiorna il render a includere titolo + ruolo, stile più visibile (es. testo più grande/bold,
icona). Esempio:
```jsx
{roleSwapNotice && (
  <div role="status" style={{width:'100%', background:'rgba(167,139,250,0.28)', border:'1px solid rgba(167,139,250,0.7)', borderRadius:'0.75rem', padding:'0.85rem 1rem', marginBottom:'0.5rem', color:'#fff', textAlign:'center'}}>
    <div style={{fontWeight:700, fontSize:'1rem'}}>{t.telepathy.roleSwapTitle}</div>
    <div style={{fontSize:'0.95rem', marginTop:'0.2rem'}}>
      {roleSwapNotice === 'sender' ? t.telepathy.roleSwappedSender : t.telepathy.roleSwappedReceiver}
    </div>
  </div>
)}
```

- [ ] **Step 2: Smoke caricamento.** Expected: nessun errore.

- [ ] **Step 3: Commit**
```bash
git add app.html
git commit -m "telepatia: avviso cambio-ruolo piu' evidente (titolo + ruolo)"
```

---

## MILESTONE 3 — Test e verifica

### Task 6: Riscrivi Test 11/12 di test-telepathy.js sul nuovo flusso

**Files:** Modify `test-telepathy.js`

- [ ] **Step 1: Test 11 — cambio modalità a turni (chooser sceglie, passivo attende)**

Riscrivi il blocco dopo i 7 round: ora compare il banner SOLO al chooser (user1). Determinare
chi è user1 lato test (chi è stato trovato in coda — nel test l'ordine di `clickFindPartner`).
Asserire: il chooser vede i bottoni di scelta; il passivo vede il messaggio d'attesa
(`text=/sta scegliendo|is choosing/`); dopo la scelta del chooser, ENTRAMBI proseguono e
`currentLevel`/UI mostra la nuova modalità (es. Numeri). Verificare anche `roundCount` preservato (=7).

- [ ] **Step 2: Test 12 — "Resta così" e nessun blocco del passivo**

Riscrivi l'ex test "disagreement": ora il chooser sceglie "Resta così" → il passivo esce
dall'attesa (banner sparito) e il gioco prosegue sui simboli. Nessun banner "disagreement"
(rimosso). Asserire che il passivo NON resta bloccato.

- [ ] **Step 3: Esegui SOLO test-telepathy**

Run (server attivo): `node test-telepathy.js`
Expected: `RISULTATO: ✅ PASSATO` con i Test 11/12 nuovi verdi.

- [ ] **Step 4: Commit**
```bash
git add test-telepathy.js
git commit -m "test(telepatia): Test 11/12 sul flusso cambio-modalita a turni"
```

---

### Task 7: Verifica finale e push

- [ ] **Step 1: Suite E2E completa**

Run (server attivo): `node test-telepathy.js && node test-messaggi.js && node test-rituali.js`
Expected: tutti `✅ PASSATO` (telepatia con i nuovi test, messaggi 15/15, rituali 18/18).

- [ ] **Step 2: Smoke manuale dal vivo (consigliato chiedere all'utente di provare)**

Due utenti: arrivare al round 7 → il chooser (user1) sceglie una modalità → il passivo vede
l'attesa e poi prosegue; ripetere fino al round 14 → ora sceglie l'altro (user2). Provare "Resta così".
Verificare anche che l'avviso di cambio-ruolo (round 3,6,…) sia ben visibile.

- [ ] **Step 3: Push (solo a tutto verde + ok smoke)**
```bash
git push origin main
```
Verificare l'app live dopo il deploy GitHub Pages.

---

## Note
- Nessuna modifica DB. La RPC `apply_level_change_if_both_agree` e le colonne
  `level_change_choice_*` restano come codice morto (pulizia opzionale futura).
- Rollback: `git revert` dei commit (il flusso torna al precedente).
- La precompilazione JSX + CSP resta in pausa: si riprende dopo questo lavoro.
