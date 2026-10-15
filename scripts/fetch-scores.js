// Pulls back responses for every created quiz, grades them against our own
// answer key (MC exact-match + Open fuzzy-match), and prints a leaderboard.
// This is the script that replaces manual answer-checking.
//
// Usage:
//   node scripts/fetch-scores.js                     # everything, all teams
//   node scripts/fetch-scores.js --quiz=book3:hard    # just one quiz (for testing)
'use strict';

const fs = require('fs');
const path = require('path');
const { gradeOpenAnswer } = require('./grading');

const DATA_FILE = path.join(__dirname, '..', 'data', 'quizzes.json');
const GENERATED_FILE = path.join(__dirname, '..', 'generated-quizzes.json');
const API_BASE = 'https://quizgen.dev/api/v1';

function optionValue(i) {
  return `opt_${'abcd'[i]}`;
}

function loadApiKey() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
  const key = process.env.QUIZGEN_API_KEY;
  if (!key) {
    console.error('Missing QUIZGEN_API_KEY. Copy .env.example to .env and paste your key in (see SETUP.md).');
    process.exit(1);
  }
  return key;
}

async function fetchResponses(apiKey, quizId) {
  const res = await fetch(`${API_BASE}/quizzes/${quizId}/responses?complete=true`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') || '5');
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return fetchResponses(apiKey, quizId);
  }
  if (!res.ok) throw new Error(`Failed to fetch responses for ${quizId}: HTTP ${res.status}`);
  const body = await res.json();
  return body.responses;
}

// Grades one response against the quiz's question list. Returns
// { team, score, max, needsReview, tiebreakerAnswer, tiebreakerCorrect, perQuestion }.
// `max` excludes any requiresManualGrading questions (orderings, "name all N",
// etc. that can't be auto-graded) -- those are surfaced via `needsReview`
// instead of being silently scored right or wrong.
function gradeResponse(response, quiz) {
  const answers = response.answers || {};
  const team = (answers.team_name || '(no team name)').trim();
  let score = 0;
  let max = 0;
  const perQuestion = [];
  const needsReview = [];

  for (const q of quiz.questions) {
    const id = `q${q.number}`;
    const submitted = answers[id];
    if (q.requiresManualGrading) {
      needsReview.push({ number: q.number, text: q.text, submitted, expected: q.answer });
      continue;
    }
    max += 1;
    let correct = false;
    if (q.type === 'mc') {
      correct = submitted === optionValue(q.correctIndex);
    } else if (submitted) {
      correct = gradeOpenAnswer(submitted, q.matchKey).correct;
    }
    if (correct) score += 1;
    perQuestion.push({ number: q.number, submitted, correct });
  }

  let tiebreakerAnswer, tiebreakerCorrect;
  if (quiz.tiebreaker) {
    tiebreakerAnswer = answers.tiebreaker;
    tiebreakerCorrect = tiebreakerAnswer ? gradeOpenAnswer(tiebreakerAnswer, quiz.tiebreaker.matchKey).correct : false;
  }

  return { team, score, max, needsReview, tiebreakerAnswer, tiebreakerCorrect, perQuestion };
}

function pad(s, len) {
  s = String(s);
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

async function main() {
  const apiKey = loadApiKey();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!fs.existsSync(GENERATED_FILE)) {
    console.error(`${GENERATED_FILE} not found -- run scripts/create-quizzes.js first.`);
    process.exit(1);
  }
  const generated = JSON.parse(fs.readFileSync(GENERATED_FILE, 'utf8'));

  const quizFilter = process.argv.find((a) => a.startsWith('--quiz='))?.split('=')[1];
  const [filterBook, filterTier] = quizFilter ? quizFilter.split(':') : [null, null];

  const overallByTeam = new Map(); // team -> total score

  for (const bookKey of Object.keys(generated).sort()) {
    if (filterBook && bookKey !== filterBook) continue;
    const book = generated[bookKey];
    for (const tier of Object.keys(book.tiers)) {
      if (filterTier && tier !== filterTier) continue;
      const quizMeta = book.tiers[tier];
      const quiz = data[bookKey].quizzes[tier];

      const responses = await fetchResponses(apiKey, quizMeta.id);
      console.log(`\n== ${book.title} — ${tier} (${quizMeta.difficulty}) — ${responses.length} completed ==`);
      if (!responses.length) continue;

      console.log(pad('Team', 24) + pad('Score', 10) + 'Tiebreaker');
      for (const response of responses) {
        const graded = gradeResponse(response, quiz);
        overallByTeam.set(graded.team, (overallByTeam.get(graded.team) || 0) + graded.score);
        const tb = quiz.tiebreaker
          ? `${graded.tiebreakerAnswer ?? '(blank)'} ${graded.tiebreakerCorrect ? '✓' : '✗'}`
          : '-';
        console.log(pad(graded.team, 24) + pad(`${graded.score}/${graded.max}`, 10) + tb);
        for (const r of graded.needsReview) {
          console.log(
            `    ⚠ needs manual check — Q${r.number}: submitted "${r.submitted ?? '(blank)'}" | expected: ${r.expected}`
          );
        }
      }
    }
  }

  if (!quizFilter) {
    console.log('\n== Overall leaderboard (summed across every quiz played) ==');
    const ranked = [...overallByTeam.entries()].sort((a, b) => b[1] - a[1]);
    ranked.forEach(([team, total], i) => {
      console.log(`${pad(`${i + 1}.`, 4)}${pad(team, 24)}${total}`);
    });
  }
}

main().catch((err) => {
  console.error('\n' + err.message);
  process.exit(1);
});
