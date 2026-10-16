// Rewrites each source-quizzes/*.md file in place so that, among its MC
// questions (in order, ignoring Open questions in between): the correct
// option's letter is never the same two times in a row, the four letters
// are used as evenly as possible overall, and the sequence doesn't fall into
// an obviously periodic pattern (e.g. strict A,B,A,B,... or A,B,C,D,A,B,C,D,...).
//
// It does this by re-deriving a target correct-letter for every MC question,
// then re-ordering that question's four option texts (and rewriting the
// matching Answer Key line) so the correct one lands on the target letter.
// The actual option texts/correct fact never change -- only which slot they
// sit in.
//
// IMPORTANT: this is a one-shot transform, not an idempotent formatter. It
// assumes every MC question is *freshly authored* with the correct answer
// always listed first (option A) -- that's the contract quiz-writers follow,
// precisely so this script can do the shuffling deterministically instead of
// relying on manual shuffling. Do NOT run it twice on the same content: a
// second run would treat whatever's already in slot A as "correct" again and
// silently scramble the real answer key.
//
// Run: node scripts/rebalance-mc.js            # all files
//      node scripts/rebalance-mc.js --check     # report only, no rewrite
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'source-quizzes');
const LETTERS = ['A', 'B', 'C', 'D'];

function parseQuestions(raw) {
  const dividerIdx = raw.lastIndexOf('\n---\n');
  if (dividerIdx === -1) throw new Error('no "---" divider found before Answer Key');
  const questionsBlock = raw.slice(0, dividerIdx);

  const qRe = /^(\d{1,2})\.\s+\*\*\(([^)]+?)\)(\s*\(Open\))?\*\*\s*([\s\S]*?)(?=\n\d{1,2}\.\s+\*\*\(|\n---|(?![\s\S]))/gm;
  const questions = [];
  let m;
  while ((m = qRe.exec(questionsBlock)) !== null) {
    const num = parseInt(m[1], 10);
    const body = m[4].trim();
    const optLineMatch = body.match(/^(.*)\n(\s*)A\)\s*(.+?)\s{2,}B\)\s*(.+?)\s{2,}C\)\s*(.+?)\s{2,}D\)\s*(.+)$/s);
    if (optLineMatch) {
      questions.push({
        number: num,
        type: 'mc',
        questionText: optLineMatch[1],
        indent: optLineMatch[2],
        options: [optLineMatch[3].trim(), optLineMatch[4].trim(), optLineMatch[5].trim(), optLineMatch[6].trim()],
      });
    } else {
      questions.push({ number: num, type: 'open' });
    }
  }
  return questions;
}

// Build a correct-letter sequence (one per MC question) that's balanced,
// has no immediate repeats, and isn't a simple periodic cycle.
function buildTargetSequence(n) {
  const base = Math.floor(n / 4);
  const extra = n % 4;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const pool = [];
    LETTERS.forEach((l, i) => {
      const count = base + (i < extra ? 1 : 0);
      for (let k = 0; k < count; k++) pool.push(l);
    });
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (isAcceptable(pool)) return pool;
  }
  throw new Error(`Could not find an acceptable letter sequence for n=${n} after 2000 attempts`);
}

function isAcceptable(seq) {
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) return false;
  }
  // Reject a sequence that's an exact repeat of a short period (2, 3, or 4)
  // for more than 5 consecutive cycles -- that would read as "predictable"
  // even though no two adjacent letters are equal (e.g. A,B,C,D,A,B,C,D,...).
  for (const period of [2, 3, 4]) {
    let run = 1;
    for (let i = period; i < seq.length; i++) {
      if (seq[i] === seq[i - period]) {
        run++;
        if (run > period * 5) return false;
      } else {
        run = 1;
      }
    }
  }
  return true;
}

function rebalanceFile(filePath, checkOnly) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  const questions = parseQuestions(raw);
  const mcQuestions = questions.filter((q) => q.type === 'mc');
  if (!mcQuestions.length) return { filename, mcCount: 0, changed: false };

  const targetLetters = buildTargetSequence(mcQuestions.length);

  let updated = raw;
  mcQuestions.forEach((q, i) => {
    const targetLetter = targetLetters[i];
    const targetIndex = LETTERS.indexOf(targetLetter);
    const currentCorrectIndex = 0; // by convention in our source files the first-listed option is always the correct one pre-shuffle
    // Reorder options so the correct one (assumed first in `options` as authored) lands at targetIndex.
    const correctText = q.options[currentCorrectIndex];
    const distractors = q.options.filter((_, idx) => idx !== currentCorrectIndex);
    const newOptions = [...distractors];
    newOptions.splice(targetIndex, 0, correctText);

    const newOptionsLine = `${q.indent}A) ${newOptions[0]}  B) ${newOptions[1]}  C) ${newOptions[2]}  D) ${newOptions[3]}`;

    // Replace this question's options line (match by question number + old option line content).
    const oldOptionsLineRe = new RegExp(
      `(^${q.number}\\.\\s+\\*\\*\\([^)]+\\)\\*\\*[\\s\\S]*?\\n)(\\s*A\\).*?D\\).*)$`,
      'm'
    );
    const block = updated.match(new RegExp(`^${q.number}\\.[\\s\\S]*?(?=\\n\\d{1,2}\\.\\s+\\*\\*\\(|\\n---)`, 'm'));
    if (!block) throw new Error(`${filename} Q${q.number}: could not relocate question block for rewrite`);
    const oldBlock = block[0];
    // Replace only the options line itself (single line, no trailing newline consumed)
    // so any blank-line separators around this block are left untouched.
    const newBlock = oldBlock.replace(/\n[ \t]*A\)[^\n]*/, '\n' + newOptionsLine);
    updated = updated.replace(oldBlock, newBlock);

    // Update the Answer Key line: "N. A) <old correct text>" -> "N. <letter>) <correct text>"
    const answerLineRe = new RegExp(`^${q.number}\\.\\s+[A-D]\\)\\s*.+$`, 'm');
    const answerMatch = updated.match(answerLineRe);
    if (!answerMatch) throw new Error(`${filename} Q${q.number}: could not find its Answer Key line to rewrite`);
    updated = updated.replace(answerLineRe, `${q.number}. ${targetLetter}) ${correctText}`);
  });

  const changed = updated !== raw;
  if (changed && !checkOnly) fs.writeFileSync(filePath, updated);
  return { filename, mcCount: mcQuestions.length, letters: targetLetters, changed };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const result = rebalanceFile(path.join(SRC_DIR, file), checkOnly);
    console.log(`${result.filename}: ${result.mcCount} MC questions, sequence: ${(result.letters || []).join('')}`);
  }
  console.log(checkOnly ? '\n(check mode -- no files written)' : '\nDone, files rewritten.');
}

main();
