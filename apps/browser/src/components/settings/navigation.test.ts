import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialHistory, navigate } from './navigation';

test('typing one search creates one history entry and Back from a result restores the query', () => {
  const typing = navigate(initialHistory, { type: 'search', query: 't' });
  const results = navigate(typing, { type: 'search', query: 'tabs' });
  assert.equal(results.pages.length, 2);
  const found = navigate(results, { type: 'open', section: 'general', highlight: 'Windows and tabs' });
  const back = navigate(found, { type: 'step', by: -1 });
  assert.equal(back.pages[back.index].query, 'tabs');
  assert.deepEqual(navigate(back, { type: 'step', by: 1 }), found);
  assert.deepEqual(navigate(back, { type: 'search', query: '' }), initialHistory);
});

test('choosing another section after going back discards the forward history', () => {
  const general = navigate(initialHistory, { type: 'open', section: 'general' });
  const back = navigate(general, { type: 'step', by: -1 });
  const privacy = navigate(back, { type: 'open', section: 'privacy' });
  assert.deepEqual(privacy.pages.map(page => page.section), ['appearance', 'privacy']);
  assert.deepEqual(navigate(privacy, { type: 'step', by: 1 }), privacy);
  assert.equal(navigate(privacy, { type: 'open', section: 'privacy' }), privacy);
});
