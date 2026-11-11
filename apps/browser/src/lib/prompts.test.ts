import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptChipLabel, promptIcon, type PromptFacts } from './prompts';

const base: PromptFacts = { kind: 'confirm', origin: 'Merlin', title: 'Save password?' };
test('prompts lead with a symbol for what they ask', () => {
  assert.equal(promptIcon(base), 'key');
  assert.equal(promptIcon({ ...base, kind: 'permission', title: 'Site permission' }), 'hand.raised');
  assert.equal(promptIcon({ ...base, security: 'secure', title: 'About this site' }), 'lock');
  assert.equal(promptIcon({ ...base, origin: 'Translate', title: 'Translate this page?' }), 'character.bubble');
  assert.equal(promptChipLabel({ ...base, kind: 'permission' }), 'Permission');
  assert.equal(promptChipLabel(base), 'Password');
});
