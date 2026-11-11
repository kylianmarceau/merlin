// The shell's architecture rules, checked on every test run. DESIGN.md
// explains them; this file keeps them true.
//
//   lib/         plain helpers; imports nothing else from src
//   platform/    the only code that imports native packages
//   state/       stores, actions and hooks; never imports components
//   components/ui/       tokens, motion and the component library
//   components/<feature>/  built only from ui, state and lib
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = join(process.cwd(), 'src');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const sources = files(root).map(path => ({
  path: relative(root, path).split(sep).join('/'),
  // Comments may describe a rule without breaking it.
  text: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'),
}));
const isUi = (p: string) => p.startsWith('components/ui/');
const isFeature = (p: string) => p.startsWith('components/') && !isUi(p);

function violations(pattern: RegExp, include: (path: string) => boolean) {
  const found: string[] = [];
  for (const { path, text } of sources) {
    if (!include(path)) continue;
    text.split('\n').forEach((line, i) => { if (pattern.test(line)) found.push(`${path}:${i + 1}: ${line.trim()}`); });
  }
  return found;
}
function imports(text: string) {
  return [...text.matchAll(/^\s*import\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map(m => ({ typeOnly: !!m[1], from: m[2] }));
}

test('the source tree is where these rules expect it', () => {
  assert.ok(sources.some(s => s.path === 'components/ui/tokens.ts'));
  assert.ok(sources.some(s => s.path === 'components/ui/motion.ts'));
});

test('colours are named roles; literals live only in tokens.ts', () => {
  const literal = /(['"`])#[0-9a-fA-F]{3,8}\1|rgba?\(|\b(color|backgroundColor|borderColor|tintColor)\s*:\s*['"](?!transparent)/;
  assert.deepEqual(violations(literal, p => p !== 'components/ui/tokens.ts'), []);
});

test('timings and curves come from motion.ts', () => {
  const raw = /\bEasing\.|\bduration\s*:\s*\d|\b(stiffness|damping)\s*:\s*\d|\bAnimated\.timing\(|set(Timeout|Interval)\(.*,\s*\d+\s*\)/;
  assert.deepEqual(violations(raw, p => p !== 'components/ui/motion.ts'), []);
});

test('components size, space and set type only with tokens', () => {
  const keys = 'padding\\w*|margin\\w*|gap|rowGap|columnGap|borderRadius|border\\w*Width|fontSize|lineHeight|letterSpacing|' +
    'top|left|right|bottom|width|height|minWidth|minHeight|maxWidth|maxHeight';
  const numeric = new RegExp(`\\b(${keys})\\s*:\\s*-?[1-9]`);
  const typeface = /\b(fontWeight|fontFamily)\s*:\s*['"]/;
  const inComponents = (p: string) => p.startsWith('components/') && p !== 'components/ui/tokens.ts';
  assert.deepEqual(violations(numeric, inComponents), []);
  assert.deepEqual(violations(typeface, inComponents), []);
});

test('shadows and overlays use the shell, not React Native defaults', () => {
  // React Native's shadow props do nothing on macOS views; Panel draws real ones.
  assert.deepEqual(violations(/\b(shadowColor|shadowOpacity|shadowRadius|shadowOffset|elevation)\s*:/, p =>
    p.startsWith('components/') && p !== 'components/ui/tokens.ts'), []);
  // Modal opens a separate window on macOS; overlays are layers in the window.
  assert.deepEqual(violations(/\bModal\b/, p => p.startsWith('components/') || p === 'App.tsx'), []);
});

test('only platform/ imports native packages', () => {
  const native = /^(@merlin\/|expo-modules-core|expo$)/;
  const found = sources.filter(s => !s.path.startsWith('platform/'))
    .flatMap(s => imports(s.text).filter(i => native.test(i.from)).map(i => `${s.path} imports ${i.from}`));
  assert.deepEqual(found, []);
});

test('layers import only downwards', () => {
  const found: string[] = [];
  for (const { path, text } of sources) {
    for (const { from, typeOnly } of imports(text)) {
      if (!from.startsWith('.')) continue;
      const target = join(path, '..', from).split(sep).join('/');
      const bad =
        (path.startsWith('lib/') && !target.startsWith('lib/')) ||
        (path.startsWith('platform/') && !target.startsWith('platform/')) ||
        (path.startsWith('state/') && target.startsWith('components/')) ||
        (isUi(path) && (target.startsWith('components/') && !target.startsWith('components/ui/'))) ||
        (isUi(path) && target.startsWith('state/') && !typeOnly) ||
        (isUi(path) && target.startsWith('platform/') && target !== 'platform/shell') ||
        (isFeature(path) && target.startsWith('platform/') && !(path.startsWith('components/page/') && target === 'platform/engine')) ||
        (isFeature(path) && target.startsWith('components/ui/') && target !== 'components/ui');
      if (bad) found.push(`${path} imports ${from}`);
    }
  }
  assert.deepEqual(found, []);
});

test('components act through state, never on the store or engine directly', () => {
  assert.deepEqual(violations(/\.(getState|setState)\(|\bconnectEngine\b|\bEngineClient\b/, p => p.startsWith('components/')), []);
});
