import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accents, anchoredGlass, classicLook, contrastRatio, controlGlass, controlGlassStrength, legibleGlass, palette, panelGlass, shellTintFor, themePreview,
  type GlassLook } from './tokens';

const look = (transparency: number, tint = 0): GlassLook => ({ on: true, translucent: true, tint, transparency });
const alpha = (rgba: string) => Number(/,\s*([\d.]+)\)$/.exec(rgba)![1]);

test('dark surfaces stay neutral across workspace colours', () => {
  for (const accent of accents) {
    const { shellTint, startBackground, areaLight, surfaceSheetBody, surfacePalette } = palette('dark', accent);
    const colours = [shellTint, startBackground, areaLight, surfaceSheetBody, surfacePalette,
      panelGlass('dark', accent, look(0.2)).fill, ...Object.values(themePreview('dark', accent))];
    for (const colour of colours) {
      const rgb = colour.startsWith('#') ? colour.slice(1).match(/../g)! : colour.match(/\d+/g)!.slice(0, 3);
      assert.equal(new Set(rgb).size, 1, `${accent}: ${colour}`);
    }
  }
});

test('each workspace colour keeps selected command text readable in both modes', () => {
  for (const accent of accents) for (const mode of ['light', 'dark'] as const) {
    const { paletteSelected, paletteSelectedText } = palette(mode, accent);
    assert.ok(contrastRatio(paletteSelected, paletteSelectedText) >= 4.5, `${accent} in ${mode}`);
  }
});

test('transparency thickens the glass below the middle and clears it above', () => {
  // Nearly solid at 0, Ardia's tinted regular glass at 0.5, clear glass at 1.
  assert.ok(alpha(panelGlass('light', 'fern', look(0)).fill) > 0.9);
  assert.equal(panelGlass('light', 'fern', look(0)).fade, 0);
  assert.equal(alpha(panelGlass('light', 'fern', look(0.5)).fill), 0);
  assert.equal(panelGlass('light', 'fern', look(0.5)).fade, 0);
  assert.equal(panelGlass('light', 'fern', look(0.5)).tint, 'rgba(255, 255, 255, 0.575)');
  assert.equal(panelGlass('dark', 'fern', look(0.5)).tint, 'rgba(42, 42, 42, 0.575)');
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
  assert.equal(neutral.tint, 'rgba(255, 255, 255, 0.575)');
  assert.notEqual(tinted.fill, neutral.fill);
  assert.notEqual(tinted.tint, neutral.tint);
});

test('a pop-up adds a backing as regular glass fades to clear', () => {
  for (const backing of [legibleGlass, anchoredGlass]) {
    for (const mode of ['light', 'dark'] as const) {
      assert.ok(alpha(panelGlass(mode, 'fern', look(0), backing).fill) > backing);
      assert.equal(alpha(panelGlass(mode, 'fern', look(0.5), backing).fill), 0);
      assert.equal(alpha(panelGlass(mode, 'fern', look(0.75), backing).fill), backing / 2);
      assert.equal(alpha(panelGlass(mode, 'fern', look(1), backing).fill), backing);
    }
  }
});

test('clear controls use Ardia’s half-strength glass and state tints', () => {
  const states = ['rest', 'lit', 'pressed', 'active'] as const;
  assert.equal(controlGlassStrength, 0.5);
  assert.deepEqual(states.map(state => alpha(controlGlass('light', 'fern', look(0.5), state))), [0.008, 0.015, 0.023, 0.045]);
  assert.deepEqual(states.map(state => alpha(controlGlass('dark', 'fern', look(0.5), state))), [0.015, 0.03, 0.045, 0.09]);
});

test('Classic makes the shell opaque; glass keeps the default tint at the default transparency', () => {
  assert.equal(alpha(shellTintFor('rgba(222, 232, 225, 0.84)', { ...classicLook, translucent: false })), 1);
  assert.equal(alpha(shellTintFor('rgba(222, 232, 225, 0.84)', look(0.5))), 0.84);
  assert.ok(alpha(shellTintFor('rgba(222, 232, 225, 0.84)', look(1))) < 0.84);
});
