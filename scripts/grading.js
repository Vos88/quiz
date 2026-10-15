// Fuzzy-grades a free-text answer against a question's matchKey.
// No dependency: Levenshtein distance is ~15 lines, not worth pulling in a library for.
'use strict';

const SIMILARITY_THRESHOLD = 0.8;

function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/^\s*(a|an|the)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Returns { correct, similarity } -- `correct` is the auto-grade verdict;
// borderline cases still get a numeric score so a host can eyeball/override them.
function gradeOpenAnswer(submitted, matchKey) {
  const a = normalize(submitted);
  const b = normalize(matchKey);
  if (!a) return { correct: false, similarity: 0 };
  if (a.includes(b) || b.includes(a)) return { correct: true, similarity: 1 };
  const sim = similarity(a, b);
  return { correct: sim >= SIMILARITY_THRESHOLD, similarity: Number(sim.toFixed(2)) };
}

module.exports = { normalize, levenshtein, similarity, gradeOpenAnswer, SIMILARITY_THRESHOLD };

// --- self-test (run directly: `node scripts/grading.js`) ---
if (require.main === module) {
  const assert = require('assert');

  assert.strictEqual(normalize('  The Burrow!  '), 'burrow');
  assert.strictEqual(normalize("Fred and George"), 'fred and george');

  assert.ok(gradeOpenAnswer('Sirius Black', 'sirius black').correct);
  assert.ok(gradeOpenAnswer('sirius black ', 'sirius black').correct);
  assert.ok(gradeOpenAnswer('Siriuss Black', 'sirius black').correct, 'one-letter typo should still pass');
  assert.ok(!gradeOpenAnswer('Severus Snape', 'sirius black').correct, 'wrong answer must fail');
  assert.ok(
    gradeOpenAnswer('I think it was Padfoot, i.e. Sirius Black', 'sirius black').correct,
    'a full-sentence answer containing the matchKey should pass'
  );
  assert.ok(gradeOpenAnswer('29', '29').correct);
  assert.ok(!gradeOpenAnswer('28', '29').correct);

  console.log('grading.js self-test passed');
}
