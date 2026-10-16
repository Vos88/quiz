// Pulls back responses for every created quiz, grades them against our own
// answer key (MC exact-match + Open fuzzy-match), prints a leaderboard, and
// writes results.html -- a per-quiz, per-team, per-question answer breakdown
// (who answered what, right or wrong) plus each quiz's score summary.
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
const RESULTS_FILE = path.join(__dirname, '..', 'results.html');
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
    let expected;
    let submittedLabel = submitted;
    if (q.type === 'mc') {
      correct = submitted === optionValue(q.correctIndex);
      expected = q.options[q.correctIndex];
      const submittedIndex = ['opt_a', 'opt_b', 'opt_c', 'opt_d'].indexOf(submitted);
      submittedLabel = submittedIndex >= 0 ? q.options[submittedIndex] : submitted;
    } else {
      correct = submitted ? gradeOpenAnswer(submitted, q.matchKey).correct : false;
      expected = q.answer;
    }
    if (correct) score += 1;
    perQuestion.push({ number: q.number, text: q.text, submitted: submittedLabel, correct, expected });
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// One quiz's results as an HTML section: a sorted team/score summary table,
// plus a collapsible per-team breakdown of every question's submitted answer,
// correct/incorrect, and (when wrong) the expected answer. Pure static HTML
// (<details>/<summary>) -- no JS needed.
function renderQuizHtml(title, difficulty, quiz, gradedResponses) {
  const ranked = [...gradedResponses].sort((a, b) => b.score - a.score);

  const summaryRows = ranked
    .map(
      (g) =>
        `<tr><td>${escapeHtml(g.team)}</td><td>${g.score}/${g.max}</td><td>${
          quiz.tiebreaker ? `${escapeHtml(g.tiebreakerAnswer ?? '(blank)')} ${g.tiebreakerCorrect ? '✓' : '✗'}` : '-'
        }</td></tr>`
    )
    .join('\n');

  const teamSections = ranked
    .map((g) => {
      const rows = g.perQuestion
        .map(
          (q) => `<tr class="${q.correct ? 'ok' : 'bad'}">
          <td>${q.number}</td>
          <td>${escapeHtml(q.text)}</td>
          <td>${escapeHtml(q.submitted ?? '(blank)')}</td>
          <td>${q.correct ? '✓' : '✗'}</td>
          <td>${q.correct ? '' : escapeHtml(q.expected)}</td>
        </tr>`
        )
        .join('\n');
      const reviewRows = g.needsReview
        .map(
          (r) => `<tr class="review">
          <td>${r.number}</td>
          <td>${escapeHtml(r.text)}</td>
          <td>${escapeHtml(r.submitted ?? '(blank)')}</td>
          <td>⚠ needs manual check</td>
          <td>${escapeHtml(r.expected)}</td>
        </tr>`
        )
        .join('\n');
      return `<details>
        <summary>${escapeHtml(g.team)} — ${g.score}/${g.max}</summary>
        <table class="detail">
          <thead><tr><th>#</th><th>Question</th><th>Answer given</th><th>Result</th><th>Expected</th></tr></thead>
          <tbody>${rows}${reviewRows}</tbody>
        </table>
      </details>`;
    })
    .join('\n');

  return `<section class="quiz">
    <h2>${escapeHtml(title)} — ${escapeHtml(difficulty)}</h2>
    <table class="summary">
      <thead><tr><th>Team</th><th>Score</th><th>Tiebreaker</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
    ${teamSections}
  </section>`;
}

function writeResultsHtml(sections) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Quiz Results</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
  h1 { }
  .quiz { margin-bottom: 3rem; border-top: 3px solid #333; padding-top: 1rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.9rem; }
  .summary th { background: #333; color: #fff; }
  details { margin-bottom: 0.5rem; border: 1px solid #ddd; border-radius: 6px; padding: 0.3rem 0.6rem; }
  summary { cursor: pointer; font-weight: 600; padding: 0.3rem 0; }
  table.detail tr.ok { background: #eafaf0; }
  table.detail tr.bad { background: #fdecea; }
  table.detail tr.review { background: #fff8e1; }
</style></head>
<body>
<h1>Harry Potter Pub Quiz — Results</h1>
<p>Generated ${new Date().toLocaleString()}</p>
${sections.join('\n')}
</body></html>`;
  fs.writeFileSync(RESULTS_FILE, html);
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
  const htmlSections = [];

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

      const gradedResponses = responses.map((r) => gradeResponse(r, quiz));
      const ranked = [...gradedResponses].sort((a, b) => b.score - a.score);

      console.log(pad('Team', 24) + pad('Score', 10) + 'Tiebreaker');
      for (const graded of ranked) {
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

      htmlSections.push(renderQuizHtml(book.title, `${tier} (${quizMeta.difficulty})`, quiz, gradedResponses));
    }
  }

  if (!quizFilter) {
    console.log('\n== Overall leaderboard (summed across every quiz played) ==');
    const ranked = [...overallByTeam.entries()].sort((a, b) => b[1] - a[1]);
    ranked.forEach(([team, total], i) => {
      console.log(`${pad(`${i + 1}.`, 4)}${pad(team, 24)}${total}`);
    });
  }

  if (htmlSections.length) {
    writeResultsHtml(htmlSections);
    console.log(`\nDetailed per-team, per-question breakdown written to ${RESULTS_FILE}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n' + err.message);
    process.exit(1);
  });
}
