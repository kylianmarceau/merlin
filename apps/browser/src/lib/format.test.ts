import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressParts, displayAddress, displayHost, downloadLine, fileExtension, formatBytes, formatDay, isStartUrl, leftToRight, overallProgress, pageLabel, pageTitle, percent } from './format';

test('hosts and addresses read the way a person would say them', () => {
  assert.equal(displayHost('https://www.example.com:8443/a?b'), 'example.com');
  assert.equal(displayAddress('https://www.example.com/'), 'example.com');
  assert.equal(displayAddress('about:blank'), '');
});
test('new tab pages are recognised in every spelling', () => {
  for (const url of ['', 'about:blank', 'chrome://newtab/', 'merlin://start']) assert.equal(isStartUrl(url), true);
  assert.equal(isStartUrl('https://example.com'), false);
});
test('an internal address standing in for a title is no title', () => {
  for (const title of ['chrome://newtab', 'merlin://start', 'about:blank', undefined]) assert.equal(pageTitle(title), '');
  assert.equal(pageTitle('Example Domain'), 'Example Domain');
  assert.equal(pageLabel('chrome://newtab', 'chrome://newtab/'), 'New Tab');
  assert.equal(pageLabel('', 'https://example.com/a'), 'example.com/a');
});
test('days are relative when recent', () => {
  const now = new Date(2026, 10, 11, 12);
  assert.equal(formatDay(now.getTime(), now), 'Today');
  assert.equal(formatDay(new Date(2026, 10, 10, 9).getTime(), now), 'Yesterday');
  assert.equal(percent(5, 10), 50);
  assert.equal(percent(5, 0), null);
  assert.equal(overallProgress([]), null);
  assert.equal(overallProgress([{ received: 25, total: 100 }, { received: 75, total: 100 }]), 0.5);
  assert.equal(overallProgress([{ received: 25, total: 100 }, { received: 3, total: 0 }]), null);
  assert.equal(overallProgress([{ received: 120, total: 100 }]), 1);
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

test('a user name before @ never passes for the host', () => {
  assert.equal(displayHost('https://accounts.google.com@evil.test/'), 'evil.test');
  assert.equal(displayHost('https://user:pa@ss@evil.test:8443/x'), 'evil.test');
  assert.equal(displayAddress('https://accounts.google.com@evil.test/login'), 'evil.test/login');
  assert.equal(displayAddress('http://a:b@www.evil.test/'), 'evil.test');
  assert.equal(displayAddress('https://u:p@ss@evil.test/a@b'), 'evil.test/a@b');
});

test('the address field prefers Chromium\'s formatting', () => {
  assert.deepEqual(addressParts({ url: 'https://accounts.google.com@evil.test:8443/a',
    displayUrl: 'evil.test:8443/a', displayHost: 'evil.test:8443' }), { host: 'evil.test:8443', rest: '/a' });
  // A spoofed host stays in punycode, as Chromium sent it.
  assert.deepEqual(addressParts({ url: 'https://xn--80ak6aa92e.test/', displayUrl: 'xn--80ak6aa92e.test',
    displayHost: 'xn--80ak6aa92e.test' }), { host: 'xn--80ak6aa92e.test', rest: '' });
  // A page without a site part (merlin://version) is all host.
  assert.deepEqual(addressParts({ url: 'chrome://version', displayUrl: 'merlin://version', displayHost: '' }),
    { host: 'merlin://version', rest: '' });
  // An older engine: the shell's own fallback, without the user name.
  assert.deepEqual(addressParts({ url: 'https://me@www.example.com/a' }), { host: 'example.com', rest: '/a' });
});

test('addresses read left to right', () => {
  assert.equal(leftToRight('\u05E9\u05DC\u05D5\u05DD.test/a'), '\u200E\u05E9\u05DC\u05D5\u05DD.test/a');
  assert.equal(leftToRight(''), '');
});
