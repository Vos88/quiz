// Renders the book/tier list from generated-quizzes.json. No build step,
// no framework -- this is the entire client-side app.
const TIER_ORDER = ['easy', 'medium', 'hard', 'expert'];
const TIER_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

async function main() {
  const booksEl = document.getElementById('books');
  const emptyEl = document.getElementById('empty');

  let data = {};
  try {
    const res = await fetch('generated-quizzes.json', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch {
    // generated-quizzes.json may not exist yet -- handled below as "empty"
  }

  const bookKeys = Object.keys(data).sort((a, b) => Number(a.replace('book', '')) - Number(b.replace('book', '')));
  if (!bookKeys.length) {
    emptyEl.hidden = false;
    return;
  }

  for (const bookKey of bookKeys) {
    const book = data[bookKey];
    const card = document.createElement('section');
    card.className = 'book-card';

    const title = document.createElement('h2');
    title.textContent = book.title;
    card.appendChild(title);

    const tierList = document.createElement('div');
    tierList.className = 'tier-list';
    for (const tier of TIER_ORDER) {
      const entry = book.tiers[tier];
      if (!entry) continue;
      const link = document.createElement('a');
      link.href = entry.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = `tier-link tier-${tier}`;
      link.textContent = `${TIER_LABEL[tier]} (${entry.difficulty})`;
      tierList.appendChild(link);
    }
    card.appendChild(tierList);
    booksEl.appendChild(card);
  }
}

main();
