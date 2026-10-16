# Setup

## One-time setup

1. **Get a QuizGen API key.** Go to https://quizgen.dev/login, sign up free, and
   the dashboard will issue a key starting `qg_live_...`. The free plan has no
   cap on live quizzes or responses — plenty for this.
2. **Copy `.env.example` to `.env`** and paste your real key in:
   ```
   cp .env.example .env
   ```
   `.env` is gitignored — it will never be committed or published.
3. **Install nothing** — these scripts use only Node's built-ins (`fetch`,
   `process.loadEnvFile`), no npm packages. Node 20.6+ required (check with
   `node --version`).

## Creating the quizzes

The 28 quiz markdown files live in `source-quizzes/`. If you ever edit one,
re-run the parser first:

```
node scripts/parse-markdown.js
```

This regenerates `data/quizzes.json` and prints a `data/matchkey-review.md`
report if any new Open-question answer looks too long/uncertain to fuzzy-grade
well — check that file and, if needed, add a short override to the
`MATCHKEY_OVERRIDES` (or `MANUAL_GRADING`) table near the top of
`scripts/parse-markdown.js`.

Then push the quizzes to QuizGen:

```
node scripts/create-quizzes.js --book=book1   # test with one book first
node scripts/create-quizzes.js                # then the rest
```

This writes `generated-quizzes.json` (safe to commit — it's just public
`quizgen.dev/q/...` links, no secrets) which the landing page reads.

If you ever need to recreate a single book's quizzes (e.g. after editing its
markdown and re-running the parser), `--book=bookN` only touches that book's
4 entries in `generated-quizzes.json`, leaving the rest alone.

## Publishing to GitHub Pages

1. Push this repo to GitHub.
2. Repo Settings → Pages → Source: deploy from the `main` branch, root folder.
3. That's it — `index.html`, `style.css`, `app.js`, and `generated-quizzes.json`
   are the entire public site.

## During/after a quiz night

Run this any time to see scores — it reads every response back from QuizGen,
grades multiple-choice exactly and free-text answers with fuzzy matching
against our own answer keys, and prints a leaderboard:

```
node scripts/fetch-scores.js
```

Lines marked `⚠ needs manual check` are questions that genuinely can't be
auto-graded (orderings, "name all N", multi-part answers) — just eyeball the
printed submitted answer against the expected one.

It also writes `results.html` (gitignored — it has real team names/answers,
never published) with the full detail per quiz: a team/score summary table,
plus a collapsible section per team listing every question, what they
answered, right/wrong, and the expected answer when wrong. Open it in any
browser.

To check just one quiz while testing:
```
node scripts/fetch-scores.js --quiz=book1:easy
```
