# Harry Potter Pub Quiz

28 quizzes (7 books × 4 difficulty tiers, 20 questions each) playable on any
phone, hosted free via [QuizGen](https://quizgen.dev) and linked from a static
landing page on GitHub Pages. No manual grading: a local script fuzzy-grades
every answer (multiple-choice exactly, free-text via fuzzy matching) and
prints a leaderboard.

See [SETUP.md](SETUP.md) for how to get it running end to end.

## How it works

```
source-quizzes/*.md  →  scripts/parse-markdown.js  →  data/quizzes.json
                                                            │
                                      scripts/create-quizzes.js
                                                            │
                                                            ▼
                                            generated-quizzes.json ──► index.html (GitHub Pages)
                                                            │
                                      scripts/fetch-scores.js (reads QuizGen responses,
                                      grades against data/quizzes.json, prints leaderboard)
```

`data/quizzes.json` is the single source of truth for every question, answer,
and the short `matchKey` phrase each Open answer is fuzzy-graded against. See
`scripts/parse-markdown.js`'s `MATCHKEY_OVERRIDES` / `MANUAL_GRADING` tables
for the handful of answers that needed manual review (narrative explanations,
or genuinely multi-part answers that can't be auto-graded at all).

## Scope not yet built

- A live, publicly-visible leaderboard (would need a small key-holding proxy —
  by design, the QuizGen API key never goes anywhere but your local `.env`).
- A "Franchise Finale" quiz pulling from `research/franchise_ledger.md`.

