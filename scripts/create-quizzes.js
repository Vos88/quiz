// Creates (or re-creates) one QuizGen quiz per book/tier from data/quizzes.json.
// Usage:
//   node scripts/create-quizzes.js            # all 28
//   node scripts/create-quizzes.js --book=book1   # just one book's 4 tiers
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'quizzes.json');
const OUT_FILE = path.join(__dirname, '..', 'generated-quizzes.json');
const API_BASE = 'https://quizgen.dev/api/v1';
const TIER_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
const DELAY_MS = 500; // well under the 60 writes/min limit

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

function optionValue(i) {
  return `opt_${'abcd'[i]}`;
}

function buildDefinition(bookTitle, tier, quiz) {
  const title = `${bookTitle} — ${TIER_LABEL[tier]} (${quiz.difficulty})`;
  const questions = [
    { id: 'team_name', type: 'short_text', prompt: "What's your team name?", required: true },
  ];
  for (const q of quiz.questions) {
    const id = `q${q.number}`;
    if (q.type === 'mc') {
      questions.push({
        id,
        type: 'choice',
        prompt: q.text,
        required: true,
        options: q.options.map((label, i) => ({ value: optionValue(i), label })),
      });
    } else {
      questions.push({ id, type: 'long_text', prompt: q.text, required: true, rows: 2 });
    }
  }
  if (quiz.tiebreaker) {
    questions.push({ id: 'tiebreaker', type: 'long_text', prompt: quiz.tiebreaker.text, required: false, rows: 2 });
  }

  return {
    schema_version: 1,
    kind: 'quiz',
    title,
    cover: {
      title,
      subtitle: "Answer on your own phone. Your quizmaster will read out the leaderboard once everyone's done.",
      button_label: 'Start the quiz',
    },
    settings: {
      completion: { message: "Nice work! Ask your quizmaster for the leaderboard once everyone's finished." },
    },
    sections: [{ key: 'main', questions }],
  };
}

async function createQuiz(apiKey, definition) {
  const res = await fetch(`${API_BASE}/quizzes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(definition),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') || '5');
    console.warn(`Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000);
    return createQuiz(apiKey, definition);
  }

  const body = await res.json();
  if (res.status !== 201) {
    const details = body.error?.validation_errors ? `\n  - ${body.error.validation_errors.join('\n  - ')}` : '';
    throw new Error(`QuizGen rejected "${definition.title}" (HTTP ${res.status}): ${body.error?.message || res.statusText}${details}`);
  }
  return body; // { id, slug, url, status, ... }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apiKey = loadApiKey();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  const bookFilter = process.argv.find((a) => a.startsWith('--book='))?.split('=')[1];
  const force = process.argv.includes('--force');
  const bookKeys = bookFilter ? [bookFilter] : Object.keys(data).sort();
  if (bookFilter && !data[bookFilter]) {
    console.error(`Unknown book "${bookFilter}". Known: ${Object.keys(data).sort().join(', ')}`);
    process.exit(1);
  }

  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {};
  const results = { ...existing };

  for (const bookKey of bookKeys) {
    const book = data[bookKey];
    results[bookKey] = results[bookKey] || { title: book.title, tiers: {} };
    for (const tier of Object.keys(book.quizzes)) {
      if (results[bookKey].tiers[tier] && !force) {
        console.log(`Skipping ${bookKey}/${tier} (already published: ${results[bookKey].tiers[tier].url}) -- pass --force to recreate`);
        continue;
      }
      const definition = buildDefinition(book.title, tier, book.quizzes[tier]);
      process.stdout.write(`Creating ${bookKey}/${tier}... `);
      const created = await createQuiz(apiKey, definition);
      console.log(created.url);
      results[bookKey].tiers[tier] = {
        difficulty: book.quizzes[tier].difficulty,
        id: created.id,
        url: created.url,
      };
      await sleep(DELAY_MS);
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${OUT_FILE}`);
}

module.exports = { buildDefinition, createQuiz };

if (require.main === module) {
  main().catch((err) => {
    console.error('\n' + err.message);
    process.exit(1);
  });
}
