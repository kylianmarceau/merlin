import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classicLook, controlGlass, panelGlass, shellTintFor, type GlassLook } from './tokens';

const look = (transparency: number, tint = 0): GlassLook => ({ on: true, translucent: true, tint, transparency });
const alpha = (rgba: string) => Number(/,\s*([\d.]+)\)$/.exec(rgba)![1]);

test('transparency maps onto the narrow range where Liquid Glass tint shows', () => {
  assert.equal(alpha(panelGlass('light', 'fern', look(0)).fill), 0.6);
  // The default reads like Ardia's frosted panel (about 0.1).
  const middle = alpha(panelGlass('light', 'fern', look(0.5)).fill);
  assert.ok(middle > 0.08 && middle < 0.13, String(middle));
  assert.equal(alpha(panelGlass('light', 'fern', look(1)).fill), 0);
  assert.equal(panelGlass('light', 'fern', look(0.95)).clear, true);
  assert.equal(panelGlass('light', 'fern', look(0.5)).clear, false);
});

test('more transparency never makes glass more opaque', () => {
  let last = Infinity;
  for (let t = 0; t <= 1; t += 0.1) {
    const a = alpha(panelGlass('dark', 'ocean', look(t)).fill);
    assert.ok(a <= last);
    last = a;
  }
});

test('the workspace tint colours the glass only when chosen', () => {
  const neutral = panelGlass('light', 'iris', look(0.5, 0)).fill;
  const tinted = panelGlass('light', 'iris', look(0.5, 1)).fill;
  assert.match(neutral, /^rgba\(255, 255, 255,/);
  assert.notEqual(tinted, neutral);
});

test('controls rest clear and light up with state', () => {
  assert.equal(alpha(controlGlass('light', 'fern', look(0.5), 'rest')), 0);
  assert.ok(alpha(controlGlass('light', 'fern', look(0.5), 'active')) > alpha(controlGlass('light', 'fern', look(0.5), 'lit')));
});

test('Classic makes the shell opaque; glass keeps the default tint at the default transparency', () => {
  assert.equal(alpha(shellTintFor('rgba(222, 232, 225, 0.84)', { ...classicLook, translucent: false })), 1);
  assert.equal(alpha(shellTintFor('rgba(222, 232, 225, 0.84)', look(0.5))), 0.84);
  assert.ok(alpha(shellTintFor('rgba(222, 232, 225, 0.84)', look(1))) < 0.84);
});
