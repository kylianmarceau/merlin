import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportBookmarksTo, exportStatus } from './bookmarkExport';

const choose = async () => '/Users/someone/Desktop/bookmarks.html';

test('a failed write never says Saved', async () => {
  const outcome = await exportBookmarksTo(choose, async () => ({ ok: false, error: 'Could not write the file' }));
  assert.deepEqual(outcome, { kind: 'failed', error: 'Could not write the file' });
  const status = exportStatus(outcome);
  assert.doesNotMatch(status.detail, /Saved/);
  assert.equal(status.error, 'Could not write the file');
});

test('a successful write says where, with the home folder shortened', async () => {
  const outcome = await exportBookmarksTo(choose, async () => ({ ok: true, value: null }));
  assert.deepEqual(outcome, { kind: 'saved', path: '/Users/someone/Desktop/bookmarks.html' });
  assert.deepEqual(exportStatus(outcome), { detail: 'Saved to ~/Desktop/bookmarks.html.', error: null });
});

test('cancelling the save panel writes nothing and reports nothing', async () => {
  let wrote = false;
  const outcome = await exportBookmarksTo(async () => null, async () => { wrote = true; return { ok: true, value: null }; });
  assert.deepEqual(outcome, { kind: 'cancelled' });
  assert.equal(wrote, false);
  assert.equal(exportStatus(outcome).error, null);
});

test('a save panel that fails is an error, not a silent no-op', async () => {
  const outcome = await exportBookmarksTo(async () => { throw new Error('The save panel is unavailable'); },
    async () => ({ ok: true, value: null }));
  assert.deepEqual(outcome, { kind: 'failed', error: 'The save panel is unavailable' });
});
