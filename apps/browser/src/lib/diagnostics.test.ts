import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asError, interfaceDiagnostics } from './diagnostics';

const when = new Date('2026-11-18T12:00:00Z');

test('diagnostics name the version, window, error, stack and components', () => {
  const error = new Error('Cannot read property tabs of undefined');
  error.stack = 'Error: Cannot read property tabs of undefined\n    at TabStrip (main.jsbundle:1:2)\n    at render (main.jsbundle:3:4)';
  const text = interfaceDiagnostics({ windowId: '7', version: '0.3.1', error, when,
    componentStack: '\n    in TabStrip\n    in BrowserWindow\n' });
  assert.equal(text, [
    'Merlin 0.3.1: the interface failed in window 7',
    'At 2026-11-18T12:00:00.000Z',
    '',
    'Error: Cannot read property tabs of undefined',
    '',
    'Stack:',
    '    at TabStrip (main.jsbundle:1:2)',
    '    at render (main.jsbundle:3:4)',
    '',
    'Components:',
    '  in TabStrip',
    '  in BrowserWindow',
  ].join('\n'));
});

test('a development build and a thrown non-error still read clearly', () => {
  const text = interfaceDiagnostics({ windowId: '1', version: null, error: 'boom', when });
  assert.match(text, /^Merlin \(development build\): the interface failed in window 1\n/);
  assert.match(text, /\nError: boom/);
  assert.equal(asError(42).message, 'A non-error was thrown: 42');
});
