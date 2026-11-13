import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastRatio, siteChrome } from './tokens';

test('Match takes the exact colour along the top of the page', () => {
  // YouTube's dark header under a red brand colour: the bar is the header, not pink.
  const youtube = siteChrome('light', '#FF0000', 'match', false, '#0F0F0F');
  assert.equal(youtube.bar, '#0F0F0F');
  assert.equal(youtube.seamless, true);
  assert.ok(contrastRatio(youtube.roles.textPrimary!, youtube.bar) >= 7);
  // A white page in Merlin's dark mode keeps a white bar with dark ink.
  const white = siteChrome('dark', '#1E2327', 'match', false, '#FFFFFF');
  assert.equal(white.bar, '#FFFFFF');
  assert.ok(contrastRatio(white.roles.textPrimary!, white.bar) >= 7);
  assert.ok(contrastRatio(white.roles.iconPrimary!, white.bar) >= 4.5);
});

test('Match without a sampled colour is the plain toolbar', () => {
  assert.deepEqual(siteChrome('light', '#FF0000', 'match', true, undefined), { bar: '#FFFFFF', shell: null, roles: {} });
  assert.deepEqual(siteChrome('light', '#FF0000', 'match', false, 'red'), { bar: '#FFFFFF', shell: null, roles: {} });
});

test('Soft and Vivid still use the brand colour', () => {
  assert.notEqual(siteChrome('light', '#FF0000', 'soft', false, '#0F0F0F').bar, '#0F0F0F');
  assert.notEqual(siteChrome('light', '#FF0000', 'vivid', false, '#0F0F0F').bar, '#0F0F0F');
});
