import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliderAccessibility, steppedValue } from './slider';

test('VoiceOver and the arrow keys move an enabled slider by a tenth, within 0 to 1', () => {
  assert.equal(steppedValue(0.5, 'increment', false), 0.6);
  assert.equal(steppedValue(0.5, 'decrement', false), 0.4);
  assert.equal(steppedValue(0.5, 'ArrowRight', false), 0.6);
  assert.equal(steppedValue(0.5, 'ArrowLeft', false), 0.4);
  // Snaps a dragged value onto the tenths, and stops at the ends.
  assert.equal(steppedValue(0.33, 'increment', false), 0.4);
  assert.equal(steppedValue(1, 'increment', false), null);
  assert.equal(steppedValue(0, 'decrement', false), null);
  assert.equal(steppedValue(0.5, 'activate', false), null);
});

test('a disabled slider ignores increment, decrement and the arrow keys', () => {
  for (const action of ['increment', 'decrement', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(steppedValue(0.5, action, true), null, action);
  }
});

test('a disabled slider offers VoiceOver no actions and says it is disabled', () => {
  assert.deepEqual(sliderAccessibility(true), { accessibilityState: { disabled: true }, accessibilityActions: [] });
  const enabled = sliderAccessibility(false);
  assert.deepEqual(enabled.accessibilityState, { disabled: false });
  assert.deepEqual(enabled.accessibilityActions.map(a => a.name), ['increment', 'decrement']);
});
