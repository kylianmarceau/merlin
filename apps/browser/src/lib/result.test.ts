import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle } from './result';

test('settle reports the value or the error, and never throws', async () => {
  assert.deepEqual(await settle(async () => 3), { ok: true, value: 3 });
  assert.deepEqual(await settle(async () => { throw new Error('Disk full'); }), { ok: false, error: 'Disk full' });
  assert.deepEqual(await settle(async () => { throw 'plain'; }), { ok: false, error: 'plain' });
  // A request that answers with nothing still succeeded.
  assert.deepEqual(await settle(async () => undefined), { ok: true, value: undefined });
});
