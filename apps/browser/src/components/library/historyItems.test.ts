import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldRepeats } from './historyItems';

const minute = 60_000;
const visit = (url: string, title: string, minutes: number, domain = 'example.org') => ({ url, title, domain, time: minutes * minute });

test('a redirect or a reload of the same page shows once, as its newest visit', () => {
  const items = [
    visit('https://example.org/wiki/The_Hay_Wain', 'The Hay Wain', 1000),
    visit('https://example.org/wiki/Hay_Wain', 'The Hay Wain', 1000),
    visit('https://example.org/a', 'A', 900),
    visit('https://example.org/a', 'A', 890),
  ];
  assert.deepEqual(foldRepeats(items).map(i => i.time / minute), [1000, 900]);
});

test('the same page visited again later, or another page between, stays', () => {
  const items = [
    visit('https://example.org/a', 'A', 10_000),
    visit('https://example.org/b', 'B', 9_000),
    visit('https://example.org/a', 'A', 8_900),
    visit('https://example.org/a', 'A', 1_000),
    visit('https://other.test/', 'A', 990, 'other.test'),
  ];
  assert.equal(foldRepeats(items).length, 5);
});

test('untitled pages fold only on the same address', () => {
  assert.equal(foldRepeats([visit('https://x.test/1', '', 10), visit('https://x.test/2', '', 9)]).length, 2);
});
