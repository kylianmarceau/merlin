import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredGlass, classicLook, controlGlass, legibleGlass, panelGlass, shellTintFor, type GlassLook } from './tokens';

const look = (transparency: number, tint = 0): GlassLook => ({ on: true, translucent: true, tint, transparency });
const alpha = (rgba: string) => Number(/,\s*([\d.]+)\)$/.exec(rgba)![1]);

test('transparency thickens the glass below the middle and clears it above', () => {
  // Nearly solid at 0, plain regular glass (Ardia's look) in the middle, clear glass at 1.
  assert.ok(alpha(panelGlass('light', 'fern', look(0)).fill) > 0.9);
  assert.equal(panelGlass('light', 'fern', look(0)).fade, 0);
  assert.equal(alpha(panelGlass('light', 'fern', look(0.5)).fill), 0);
  assert.equal(panelGlass('light', 'fern', look(0.5)).fade, 0);
  assert.equal(alpha(panelGlass('light', 'fern', look(1)).fill), 0);
  assert.equal(panelGlass('light', 'fern', look(1)).fade, 1);
});

test('every step of the slider changes the glass, and never back the other way', () => {
  let lastFill = Infinity, lastFade = -Infinity;
  for (let i = 0; i <= 10; i++) {
    const g = panelGlass('dark', 'ocean', look(i / 10));
    const fill = alpha(g.fill);
    assert.ok(fill <= lastFill && g.fade >= lastFade);
    if (i > 0) assert.ok(fill < lastFill || g.fade > lastFade, `step ${i} changes nothing`);
    lastFill = fill; lastFade = g.fade;
  }
});

test('the workspace tint colours the glass only when chosen', () => {
  const neutral = panelGlass('light', 'iris', look(0.2, 0));
  const tinted = panelGlass('light', 'iris', look(0.2, 1));
  assert.match(neutral.fill, /^rgba\(255, 255, 255,/);
  assert.equal(neutral.tint, undefined);
  assert.notEqual(tinted.fill, neutral.fill);
  // Above the middle there is no colour layer, so the glass's own tint carries it.
  assert.ok(alpha(panelGlass('light', 'iris', look(0.8, 1)).tint!) > 0);
});

test('a centred pop-up keeps a legible colour layer at any transparency', () => {
  for (let i = 0; i <= 10; i++) {
    const g = panelGlass('dark', 'fern', look(i / 10), legibleGlass);
    assert.ok(alpha(g.fill) >= legibleGlass, `transparency ${i / 10} thins it below the floor`);
  }
  // Fully frosted is still thicker than the floor.
  assert.ok(alpha(panelGlass('light', 'fern', look(0), legibleGlass).fill) > legibleGlass);
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

test('an anchored popover keeps enough of a colour layer that the page never smears through it', () => {
  for (let i = 0; i <= 10; i++) for (const mode of ['light', 'dark'] as const) {
    assert.ok(alpha(panelGlass(mode, 'fern', look(i / 10), anchoredGlass).fill) >= anchoredGlass);
  }
});
