import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayAddress, displayHost, downloadLine, fileExtension, formatBytes, formatDay, isStartUrl, percent } from './format';

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

test('download sizes and lines read as in the downloads panel', () => {
  assert.equal(formatBytes(349_000_000), '349 MB');
  assert.equal(formatBytes(1_500_000), '1.5 MB');
  assert.equal(formatBytes(0), '');
  assert.equal(fileExtension('Merlin-0.2.0-beta.13-arm64.dmg'), 'dmg');
  assert.equal(downloadLine({ status: 'done', state: 'complete', received: 165e6, total: 165e6, detail: '165 MB · github.com',
    url: 'https://github.com/a.dmg' }), '165 MB');
  assert.equal(downloadLine({ status: 'cancelled', state: 'cancelled', received: 1, total: 2, detail: 'Cancelled · x.com' }), 'Cancelled');
  assert.equal(downloadLine({ status: 'progress', state: 'progress', received: 1, total: 2, detail: '1 of 2 MB · 3 min left' }),
    '1 of 2 MB · 3 min left');
});
