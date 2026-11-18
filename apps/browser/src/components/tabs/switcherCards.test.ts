import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownCards, shownMax, thumbnailsToRequest } from './switcherCards';

const tabs = Array.from({ length: 500 }, (_, i) => String(i));

test('M36: with 500 tabs, Ctrl-Tab asks for the 15 thumbnails it shows', () => {
  const { first, shown } = shownCards(tabs, 1);
  assert.equal(first, 0);
  assert.deepEqual(thumbnailsToRequest(shown, new Set()), tabs.slice(0, shownMax));
});

test('moving on asks only for the cards that came into view', () => {
  const asked = new Set(shownCards(tabs, 7).shown);
  const next = shownCards(tabs, 8);
  assert.equal(next.first, 1);
  assert.deepEqual(thumbnailsToRequest(next.shown, asked), ['15']);
});

test('the highlighted card stays in view at both ends and in short lists', () => {
  assert.deepEqual(shownCards(tabs, 499), { first: 485, shown: tabs.slice(485) });
  assert.deepEqual(shownCards(['a', 'b', 'c'], 2), { first: 0, shown: ['a', 'b', 'c'] });
});
