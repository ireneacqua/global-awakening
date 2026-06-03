/**
 * Test formula alternanza ruoli telepatia (Batch C #5) — Global Awakening
 *
 * Verifica la logica pura roleForRound/swapRole (replica 1:1 di quella inline in
 * app.html, non importabile dal monolite): alternanza ogni 3 round + opposizione
 * costante dei due partner.
 *
 * Esecuzione: node test-telepathy-role-rotation.js
 */
const swapRole = (r) => r === 'sender' ? 'receiver' : 'sender';
const roleForRound = (b, n) => (Math.floor(n / 3) % 2 === 0) ? b : swapRole(b);

let passed = 0, failed = 0;
const eq = (a, b, m) => {
  if (a === b) { console.log('  ✅ ' + m); passed++; }
  else { console.log(`  ❌ ${m} (atteso ${b}, ottenuto ${a})`); failed++; process.exitCode = 1; }
};

console.log('— Blocchi (base = sender) —');
for (const n of [0, 1, 2])    eq(roleForRound('sender', n), 'sender',   `round ${n} -> sender (blocco 0)`);
for (const n of [3, 4, 5])    eq(roleForRound('sender', n), 'receiver', `round ${n} -> receiver (blocco 1)`);
for (const n of [6, 7, 8])    eq(roleForRound('sender', n), 'sender',   `round ${n} -> sender (blocco 2)`);
for (const n of [9, 10, 11])  eq(roleForRound('sender', n), 'receiver', `round ${n} -> receiver (blocco 3)`);

console.log('— Base = receiver (specularità) —');
eq(roleForRound('receiver', 0), 'receiver', 'round 0 base receiver');
eq(roleForRound('receiver', 3), 'sender',   'round 3 receiver->sender');

console.log('— I due partner restano sempre opposti —');
for (const n of [0, 1, 3, 5, 6, 8, 11, 12]) {
  eq(roleForRound('sender', n) === roleForRound('receiver', n), false, `round ${n}: ruoli opposti`);
}

console.log(`\nRisultato: ${passed} passati, ${failed} falliti`);
