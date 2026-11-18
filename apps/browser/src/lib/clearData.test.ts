import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearRanges, clearSince } from './clearData';

test('each range clears from that long before now, in seconds; all time is 0', () => {
  const now = Date.UTC(2026, 10, 18, 12);
  assert.equal(clearSince('hour', now), now / 1000 - 3600);
  assert.equal(clearSince('day', now), now / 1000 - 86_400);
  assert.equal(clearSince('week', now), now / 1000 - 7 * 86_400);
  assert.equal(clearSince('month', now), now / 1000 - 28 * 86_400);
  assert.equal(clearSince('all', now), 0);
  assert.deepEqual(clearRanges.map(r => r.value), ['hour', 'day', 'week', 'month', 'all']);
});
