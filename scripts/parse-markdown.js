// Parses the 28 source-quizzes/*.md files into data/quizzes.json.
// Run: node scripts/parse-markdown.js
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'source-quizzes');
const OUT_FILE = path.join(__dirname, '..', 'data', 'quizzes.json');
const REVIEW_FILE = path.join(__dirname, '..', 'data', 'matchkey-review.md');

const TIERS = ['easy', 'medium', 'hard', 'expert'];

function tierFromFilename(name) {
  for (const t of TIERS) if (name.includes(`_${t}_`)) return t;
  throw new Error(`Could not find a tier (easy/medium/hard/expert) in filename: ${name}`);
}

function bookKeyFromFilename(name) {
  const m = name.match(/^book(\d)_/);
  return m ? `book${m[1]}` : 'book1'; // book1's files are named quiz_N_*.md, no "book1" prefix
}

// Derive a short, gradable phrase from a (possibly long, explanatory) Open answer.
// Heuristic, not perfect by design -- flagged for manual spot-check in the review file.
function deriveMatchKey(answerText) {
  const quoted = answerText.match(/"([^"]{2,60})"/) || answerText.match(/“([^”]{2,60})”/);
  if (quoted) return quoted[1].trim().toLowerCase();

  let segment = answerText
    .split(/\s[—–]\s|;| \(because| \(|, (?:since|because|when|which|who|and)/i)[0]
    .trim();

  // Strip a trailing period only (keep internal punctuation like "Mrs" or "Dr.").
  segment = segment.replace(/\.$/, '').trim();

  return segment.toLowerCase();
}

function wordCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Manual spot-check pass over every matchKey the heuristic flagged as long/uncertain
// (see data/matchkey-review.md). Most long answers are fine as-is -- the
// substring-containment check in grading.js means a short correct partial answer
// (e.g. "holly") still matches a long-but-single-fact key ("holly, with a phoenix
// feather core..."). These overrides only cover the two real failure modes:
//   1. Narrative/explanatory answers where the padding would sink a short correct
//      answer (trimmed to the actual gradable phrase below).
//   2. Genuinely multi-part answers (orderings, "name all N", multi-person score
//      lists) that cannot be reduced to one matchable phrase at all -- these are
//      marked `requiresManualGrading` instead of given a misleading matchKey.
const MANUAL_GRADING = new Set([
  'book5_quiz1_easy_3-10.md#18',
  'book5_quiz2_medium_5-10.md#16',
  'book5_quiz3_hard_7-10.md#19',
  'book5_quiz4_expert_9-10.md#10',
  'book6_quiz3_hard_7-10.md#19',
  'book7_quiz3_hard_7-10.md#20',
  'book2_quiz4_expert_9-10.md#20',
  'quiz_4_expert_9-10.md#17',
]);

const MATCHKEY_OVERRIDES = {
  'book2_quiz2_medium_5-10.md#7': 'bewitches a bludger',
  'book2_quiz4_expert_9-10.md#9': 'terrified of birds',
  'book2_quiz4_expert_9-10.md#11': 'filibuster firework',
  'book2_quiz4_expert_9-10.md#12': 'squirts boiling tea',
  'book2_quiz4_expert_9-10.md#17': 'unnamed traveller',
  'book3_quiz3_hard_7-10.md#13': 'three years',
  'book3_quiz4_expert_9-10.md#1': "sirius's prank",
  'book3_quiz4_expert_9-10.md#3': 'buckbeak',
  'book3_quiz4_expert_9-10.md#7': 'transform safely',
  'book3_quiz4_expert_9-10.md#11': 'become killers',
  'book3_quiz4_expert_9-10.md#15': 'it was himself',
  'book3_quiz4_expert_9-10.md#18': 'order of merlin',
  'book3_quiz4_expert_9-10.md#19': 'presses the knot',
  'book4_quiz3_hard_7-10.md#7': 'tickle the pear',
};

function parseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);

  const titleMatch = raw.match(/^#\s+(.+?)\s+—\s+Pub Quiz\s+\d+\s+\(Difficulty\s+(\d+\/10)\)/m);
  if (!titleMatch) throw new Error(`${filename}: could not parse title line`);
  const bookTitle = titleMatch[1].trim();
  const difficulty = titleMatch[2];

  const dividerIdx = raw.lastIndexOf('\n---\n');
  if (dividerIdx === -1) throw new Error(`${filename}: could not find the "---" divider before the Answer Key`);
  const questionsBlock = raw.slice(0, dividerIdx);
  const answerBlock = raw.slice(dividerIdx);

  // --- Questions ---
  // Note: bare `$` would match end-of-*line* under the /m flag (needed so ^\d+\.
  // matches mid-string too), silently truncating every question at its first
  // line break. (?![\s\S]) is the fix: it only succeeds at the true end of string.
  const qRe = /^(\d{1,2})\.\s+\*\*\(([^)]+?)\)(\s*\(Open\))?\*\*\s*([\s\S]*?)(?=\n\d{1,2}\.\s+\*\*\(|\n---|(?![\s\S]))/gm;
  const questions = new Map();
  let m;
  while ((m = qRe.exec(questionsBlock)) !== null) {
    const num = parseInt(m[1], 10);
    const category = m[2].trim();
    let body = m[4].trim();

    const optLineMatch = body.match(/^(.*)\n\s*A\)\s*(.+?)\s{2,}B\)\s*(.+?)\s{2,}C\)\s*(.+?)\s{2,}D\)\s*(.+)$/s);
    if (optLineMatch) {
      questions.set(num, {
        number: num,
        category,
        type: 'mc',
        text: optLineMatch[1].trim(),
        options: [optLineMatch[2], optLineMatch[3], optLineMatch[4], optLineMatch[5]].map((s) => s.trim()),
      });
    } else {
      questions.set(num, { number: num, category, type: 'open', text: body.trim() });
    }
  }

  // --- Answer key ---
  const tieMatch = answerBlock.match(/\*\*Tiebreaker[^*]*\*\*\s*(.+?)\s*→\s*\*\*(.+?)\*\*/s);
  const tiebreaker = tieMatch
    ? { text: tieMatch[1].trim(), answer: tieMatch[2].trim(), matchKey: deriveMatchKey(tieMatch[2].trim()) }
    : null;

  const answerSectionEnd = tieMatch ? answerBlock.indexOf(tieMatch[0]) : answerBlock.length;
  const answerListText = answerBlock.slice(0, answerSectionEnd);
  const aRe = /^(\d{1,2})\.\s+(.+)$/gm;
  const reviewFlags = [];
  while ((m = aRe.exec(answerListText)) !== null) {
    const num = parseInt(m[1], 10);
    const answerText = m[2].trim();
    const q = questions.get(num);
    if (!q) continue; // (the "## Answer Key — Quiz N (X/10)" header line can't match \d+\. so this is safe)

    if (q.type === 'mc') {
      const letterMatch = answerText.match(/^([A-D])\)/);
      if (!letterMatch) throw new Error(`${filename} Q${num}: expected an "A)"-style MC answer, got: ${answerText}`);
      q.correctIndex = 'ABCD'.indexOf(letterMatch[1]);
    } else {
      q.answer = answerText;
      const key = `${filename}#${num}`;
      if (MANUAL_GRADING.has(key)) {
        q.requiresManualGrading = true;
      } else if (MATCHKEY_OVERRIDES[key]) {
        q.matchKey = MATCHKEY_OVERRIDES[key];
      } else {
        q.matchKey = deriveMatchKey(answerText);
        if (wordCount(q.matchKey) > 6) reviewFlags.push({ filename, num, answer: answerText, matchKey: q.matchKey });
      }
    }
  }

  for (const [num, q] of questions) {
    if (q.type === 'mc' && q.correctIndex === undefined) throw new Error(`${filename} Q${num}: missing MC answer`);
    if (q.type === 'open' && q.answer === undefined) throw new Error(`${filename} Q${num}: missing Open answer`);
  }

  const orderedQuestions = [...questions.values()].sort((a, b) => a.number - b.number);
  if (orderedQuestions.length !== 20) {
    throw new Error(`${filename}: expected 20 questions, found ${orderedQuestions.length}`);
  }

  return { bookTitle, difficulty, questions: orderedQuestions, tiebreaker, reviewFlags };
}

function main() {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.md'));
  const data = {};
  const allReviewFlags = [];

  for (const file of files) {
    const bookKey = bookKeyFromFilename(file);
    const tier = tierFromFilename(file);
    const parsed = parseFile(path.join(SRC_DIR, file));

    data[bookKey] = data[bookKey] || { title: parsed.bookTitle, quizzes: {} };
    data[bookKey].quizzes[tier] = {
      difficulty: parsed.difficulty,
      questions: parsed.questions,
      tiebreaker: parsed.tiebreaker,
    };
    allReviewFlags.push(...parsed.reviewFlags);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2));

  const bookCount = Object.keys(data).length;
  const quizCount = Object.values(data).reduce((n, b) => n + Object.keys(b.quizzes).length, 0);
  console.log(`Parsed ${files.length} files -> ${bookCount} books, ${quizCount} quizzes -> ${OUT_FILE}`);

  if (allReviewFlags.length) {
    const lines = [
      '# matchKey review',
      '',
      `${allReviewFlags.length} Open-question answers produced a long/uncertain matchKey (>6 words).`,
      'Spot-check these in data/quizzes.json and shorten the `matchKey` field by hand if it looks wrong.',
      '',
      ...allReviewFlags.map(
        (f) => `- **${f.filename} Q${f.num}**\n  - answer: ${f.answer}\n  - derived matchKey: \`${f.matchKey}\``
      ),
    ];
    fs.writeFileSync(REVIEW_FILE, lines.join('\n') + '\n');
    console.log(`${allReviewFlags.length} matchKeys flagged for manual review -> ${REVIEW_FILE}`);
  } else {
    console.log('No matchKeys flagged for review.');
  }
}

main();
