import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ShellPrefs } from '../../state/shellPrefs';
import { browserPreset, makeSetupCode, nextScreen, readProgress, readSetupCode, route, screenOrder } from './setup';

test('fresh, skipped and customized setups use the full route and respect platform and layout', () => {
  for (const source of ['', 'fresh', 'arc']) {
    const progress = readProgress({ source, custom: true });
    assert.deepEqual(route(progress, 'side', true), screenOrder);
    assert.deepEqual(route(progress, 'top', false), screenOrder.filter(screen => screen !== 'address' && screen !== 'material'));
  }
});

test('the preset supplies behavior, while Back and Skip use the current route', () => {
  const preset = browserPreset('arc');
  assert.equal(preset.layout, 'side');
  assert.equal(preset.shell.commandBarPlacement, 'centred');
  const short = route(readProgress({ source: 'arc', custom: false }), preset.layout, true);
  assert.equal(nextScreen('source', short, 'next'), 'color');
  assert.equal(nextScreen('color', short, 'back'), 'source');
  assert.equal(nextScreen('color', short, 'skip'), 'privacy');
  const full = route(readProgress({ source: 'arc', custom: true }), preset.layout, true);
  assert.equal(nextScreen('position', full, 'back'), 'newTab');
  assert.equal(nextScreen('position', full, 'skip'), 'color');
});

test('onboarding progress keeps current IDs and filters old or unknown values', () => {
  assert.deepEqual(readProgress({ screen: 'workspace', source: 'unknown', favorites: ['github', 'github', 'unknown'] }),
    { screen: 'source', source: '', custom: true, favorites: ['github'] });
  assert.equal(readProgress({ screen: 'links' }).screen, 'links');
});

test('Merlin setup codes round-trip preferences and reject system side effects', () => {
  const prefs = { newTabPosition: 'adjacent', sharedTabs: true, externalLinks: 'compact' } as ShellPrefs;
  const original = { layout: 'side', startup: 'start', mode: 'dark', accent: 'ocean', engine: 'kagi',
    favorites: ['github', 'gmail'], theme: null } as const;
  const options = { ...original, favorites: [...original.favorites] };
  const code = makeSetupCode(options, prefs);
  assert.deepEqual(readSetupCode(code), { ...options, shell: prefs });
  const invalid = (shell: object) => 'MERLIN1:' + encodeURIComponent(JSON.stringify({ ...options, shell }));
  assert.equal(readSetupCode(invalid({ makeDefaultBrowser: true })), null);
  assert.equal(readSetupCode(invalid({ newTabPosition: 'somewhere' })), null);
  assert.equal(readSetupCode('MERLIN1:%'), null);
});
