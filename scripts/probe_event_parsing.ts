// How much JavaScript work one engine event costs as windows and tabs grow
// (remediation plan 7.5, M35). Every window's root has its own listener on
// the one MerlinEngine module, and each pending request adds another; each
// listener parses and validates every event (parseEngineEvent), then drops
// the ones for other windows. So one window's snapshot is parsed once per
// listener in every window.
//
// Run from apps/browser, with V8's JIT off to approach Hermes, which
// interprets the release bundle's bytecode without a JIT:
//
//   node --jitless --import tsx ../../scripts/probe_event_parsing.ts snapshot.json
//
// snapshot.json is a real window snapshot (merlin shell-call
// window.snapshot's result); its tabs are repeated to make larger windows.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseEngineEvent } from '../packages/engine/src/protocol';

const [file] = process.argv.slice(2);
if (!file) throw new Error('usage: probe_event_parsing.ts snapshot.json');
const base = JSON.parse(readFileSync(file, 'utf8'));
const template = base.tabs as { id: string }[];

function snapshotWith(tabs: number) {
  const list = Array.from({ length: tabs }, (_, i) => ({ ...template[i % template.length], id: String(1000 + i), active: i === 0 }));
  return JSON.stringify({ type: 'snapshot', snapshot: { ...base, tabs: list, activeTabId: list[0].id } });
}

function timeParse(json: string, runs: number) {
  for (let i = 0; i < 5; i++) parseEngineEvent(json);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    parseEngineEvent(json);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

console.log(`jitless: ${process.execArgv.includes('--jitless')}`);
console.log('tabs  bytes     parse ms  | ms per snapshot with every window listening (1 / 3 / 10 windows)');
for (const tabs of [10, 100, 500]) {
  const json = snapshotWith(tabs);
  const ms = timeParse(json, tabs >= 500 ? 15 : 40);
  // A snapshot of one window reaches every window's listener; a window with
  // a request waiting (a Library list loading) has one more.
  const per = (windows: number) => (ms * windows).toFixed(1);
  console.log(`${String(tabs).padStart(4)}  ${String(json.length).padStart(8)}  ${ms.toFixed(2).padStart(8)}  | ${per(1)} / ${per(3)} / ${per(10)}`);
}
