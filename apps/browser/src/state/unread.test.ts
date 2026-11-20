import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unreadIn, unreadLabel } from './unread';

test('a leading count, as Facebook, X and YouTube put it', () => {
  assert.equal(unreadIn('(3) Facebook'), 3);
  assert.equal(unreadIn('(12+) Home / X'), 12);
  assert.equal(unreadIn('[4] Matrix'), 4);
});

test("an inbox's count, wherever it sits", () => {
  assert.equal(unreadIn('Inbox (12) - someone@example.com - Gmail'), 12);
  assert.equal(unreadIn('Mail - Inbox (2)'), 2);
  assert.equal(unreadIn('Notifications (7) | GitHub'), 7);
  assert.equal(unreadIn('5 unread - Fastmail'), 5);
});

test('a marked title without a number is a dot', () => {
  assert.equal(unreadIn('• Slack | general | Acme'), 'dot');
  assert.equal(unreadIn('* Discord'), 'dot');
});

test('ordinary titles, and zero, show nothing', () => {
  assert.equal(unreadIn('Python 3 (2024) documentation'), null);
  assert.equal(unreadIn('Inbox (0) - Gmail'), null);
  assert.equal(unreadIn('Hacker News'), null);
  assert.equal(unreadIn(''), null);
  assert.equal(unreadIn(undefined), null);
});

test('a large count reads 99+', () => {
  assert.equal(unreadLabel(7), '7');
  assert.equal(unreadLabel(120), '99+');
});
