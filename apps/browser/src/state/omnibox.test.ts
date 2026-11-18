import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Suggestion } from '../platform/protocol';
import { acceptResults, currentSuggestions, moveSelection, startQuery, suggestionChoice, type Omnibox } from './omnibox';

const row = (url: string, extra: Partial<Suggestion> = {}): Suggestion =>
  ({ kind: 'url', title: url, detail: '', url, completion: '', default: false, ...extra });
const youtube = row('https://youtube.com/', { default: true, completion: 'tube.com' });
const search = row('https://search.test/?q=you', { kind: 'search' });
const yourDictionary = row('https://yourdictionary.com/', { default: true, completion: 'rdictionary.com' });

function typed(...steps: Array<[string, string] | [string, Suggestion[]]>): Omnibox | null {
  let omnibox: Omnibox | null = null;
  for (const [id, step] of steps)
    omnibox = typeof step === 'string' ? startQuery(omnibox, id, step, 'address') : acceptResults(omnibox, id, step) ?? omnibox;
  return omnibox;
}

test("a new query's rows are greyed until they arrive, and can't be opened", () => {
  const omnibox = typed(['q1', 'you'], ['q1', [youtube, search]], ['q2', 'your']);
  // Still on screen, so the list doesn't flicker…
  assert.deepEqual(omnibox?.items, [youtube, search]);
  // …but they answer "you", not "your".
  assert.deepEqual(currentSuggestions(omnibox), []);
  assert.equal(suggestionChoice(omnibox, 0), null);
  assert.equal(moveSelection(omnibox, 1), null);
});

test('replies out of order: a late answer to an older query never takes over', () => {
  // q2's rows arrive first, then q1's late.
  const omnibox = typed(['q1', 'you'], ['q2', 'your'], ['q2', [yourDictionary]], ['q1', [youtube, search]]);
  assert.deepEqual(currentSuggestions(omnibox), [yourDictionary]);
  assert.deepEqual(suggestionChoice(omnibox, 0), { queryId: 'q2', index: 0, url: 'https://yourdictionary.com/' });
});

test('opening sends the query, index and address of the row that was shown', () => {
  const omnibox = typed(['q1', 'you'], ['q1', [youtube, search]]);
  const moved = moveSelection(omnibox, 1);
  assert.equal(moved?.selected, 1);
  assert.deepEqual(suggestionChoice(moved, 1), { queryId: 'q1', index: 1, url: search.url });
  assert.equal(suggestionChoice(moved, 2), null);
});

test('once the new rows arrive they can be chosen again, and only they', () => {
  const omnibox = typed(['q1', 'you'], ['q1', [youtube, search]], ['q2', 'your'], ['q2', [yourDictionary]]);
  assert.deepEqual(suggestionChoice(omnibox, 0), { queryId: 'q2', index: 0, url: yourDictionary.url });
  assert.equal(suggestionChoice(omnibox, 1), null);
});

test("another field's query starts without the address field's rows", () => {
  const address = typed(['q1', 'you'], ['q1', [youtube]]);
  const search = startQuery(address, 'q2', 'your', 'search');
  assert.deepEqual(search.items, []);
  assert.equal(search.itemsQueryId, null);
});
