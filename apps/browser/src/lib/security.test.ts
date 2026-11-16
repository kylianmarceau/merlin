import { test } from 'node:test';
import assert from 'node:assert/strict';
import { securityBadge } from './security';
import { promptIcon } from './prompts';

test('the site badge follows Chromium\'s security state, not the scheme', () => {
  assert.deepEqual(securityBadge('secure'), { icon: 'lock', tone: 'siteSecure', label: 'Connection is secure' });
  assert.equal(securityBadge('insecure').icon, 'exclamationmark.triangle');
  // A certificate error proceeded past: https:, and still no lock.
  assert.equal(securityBadge('dangerous').icon, 'exclamationmark.octagon');
  assert.equal(securityBadge('dangerous').tone, 'danger');
  assert.equal(securityBadge('internal').icon, 'info.circle');
  // Opening an address, or an engine too old to say: nothing is claimed.
  for (const state of ['pending', undefined, 'locked']) {
    assert.equal(securityBadge(state).icon, 'info.circle');
    assert.doesNotMatch(securityBadge(state).label, /secure/);
  }
});

test('site information leads with the address field\'s badge', () => {
  const site = { kind: 'alert', origin: 'evil.test', title: 'About this site' };
  assert.equal(promptIcon({ ...site, security: 'dangerous' }), 'exclamationmark.octagon');
  assert.equal(promptIcon({ ...site, security: 'pending' }), 'info.circle');
  assert.equal(promptIcon({ ...site, security: 'secure' }), 'lock');
});
