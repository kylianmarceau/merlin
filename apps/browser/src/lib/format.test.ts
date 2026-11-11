import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayAddress, displayHost, formatDay, isStartUrl, percent } from './format';

test('hosts and addresses read the way a person would say them', () => {
  assert.equal(displayHost('https://www.example.com:8443/a?b'), 'example.com');
  assert.equal(displayAddress('https://www.example.com/'), 'example.com');
  assert.equal(displayAddress('about:blank'), '');
});
test('new tab pages are recognised in every spelling', () => {
  for (const url of ['', 'about:blank', 'chrome://newtab/', 'merlin://start']) assert.equal(isStartUrl(url), true);
  assert.equal(isStartUrl('https://example.com'), false);
});
test('days are relative when recent', () => {
  const now = new Date(2026, 10, 11, 12);
  assert.equal(formatDay(now.getTime(), now), 'Today');
  assert.equal(formatDay(new Date(2026, 10, 10, 9).getTime(), now), 'Yesterday');
  assert.equal(percent(5, 10), 50);
  assert.equal(percent(5, 0), null);
});
