import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { searchSettings, settingsIndex } from './searchIndex';

const dir = join(process.cwd(), 'src/components/settings');
const panes = readdirSync(dir).filter(f => f.endsWith('.tsx')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');

test('every setting the search can find is still a row or heading in Settings', () => {
  for (const hit of settingsIndex) assert.ok(panes.includes(`"${hit.title}"`) || panes.includes(`'${hit.title}'`), hit.title);
});

test('search matches every word, titles first', () => {
  assert.equal(searchSettings('')[0], undefined);
  assert.equal(searchSettings('tab pos')[0].title, 'Tab position');
  assert.equal(searchSettings('dark')[0].title, 'Appearance Theme');
  assert.ok(searchSettings('vertical').some(h => h.title === 'Tab position'));
  assert.deepEqual(searchSettings('zzz'), []);
});
