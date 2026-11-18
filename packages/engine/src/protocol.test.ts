import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineClient, parseEngineEvent, validateSnapshot, type Snapshot, type Transport, type EngineEvent } from './protocol';

export function snapshot(revision = 1): Snapshot {
  return { session: 'session-one', windowId: 'window-one', revision, private: false, tabs: [], activeTabId: null,
    downloads: [], prompt: null, appearance: { mode: 'system', accent: 'ocean', reduceMotion: false },
    modal: { mode: 'Normal', pending: '', message: '' } };
}
test('rejects a snapshot for another window', () => {
  assert.throws(() => validateSnapshot(snapshot(), 'window-two'));
});
test('rejects an active tab absent from the authoritative tab list', () => {
  assert.throws(() => validateSnapshot({ ...snapshot(), activeTabId: 'stale' }, 'window-one'));
});
test('a page in fullscreen is a flag, nothing else', () => {
  assert.equal(validateSnapshot({ ...snapshot(), fullscreen: true }, 'window-one').fullscreen, true);
  assert.throws(() => validateSnapshot({ ...snapshot(), fullscreen: 'yes' as unknown as boolean }, 'window-one'));
});
test('a tab\'s security is one of the shared states and its display text is a string', () => {
  const tab = { id: 't', title: '', url: 'https://evil.test/', loading: false, pinned: false, audible: false,
    canGoBack: false, canGoForward: false };
  const valid = (extra: object) => validateSnapshot({ ...snapshot(), tabs: [{ ...tab, ...extra }] }, 'window-one');
  assert.equal(valid({ security: 'dangerous', displayUrl: 'evil.test', displayHost: 'evil.test' }).tabs[0].security, 'dangerous');
  assert.equal(valid({}).tabs[0].security, undefined);
  assert.throws(() => valid({ security: 'locked' }));
  assert.throws(() => valid({ displayUrl: 7 }));
  assert.throws(() => valid({ displayHost: null }));
});
test('rejects malformed prompts rather than rendering unsafe actions', () => {
  assert.throws(() => validateSnapshot({ ...snapshot(), prompt: { id: 'p', actions: [] } }, 'window-one'));
});
test('routes requests to the owning native window and propagates rejection', async () => {
  const calls: unknown[] = [];
  const transport: Transport = { call: async (...args) => { calls.push(args); return '{"ok":false,"error":"Tab closed"}'; }, subscribe: () => () => {} };
  const client = new EngineClient('window-one', transport);
  await assert.rejects(client.call('tabs.close', { tabId: 'gone' }), /Tab closed/);
  assert.deepEqual(calls, [['window-one', 'tabs.close', '{"tabId":"gone"}']]);
});
test('filters events from other native windows and releases the subscription', () => {
  let deliver!: (event: EngineEvent) => void;
  let removed = false;
  const client = new EngineClient('window-one', { call: async () => '', subscribe: listener => { deliver = listener; return () => { removed = true; }; } });
  const events: EngineEvent[] = [];
  const dispose = client.subscribe(event => events.push(event));
  deliver({ type: 'command.open', windowId: 'window-two' });
  deliver({ type: 'command.open', windowId: 'window-one' });
  assert.equal(events.length, 1); dispose(); assert.equal(removed, true);
});

test('malformed native events cannot bypass snapshot validation', () => {
  assert.throws(() => parseEngineEvent('{"type":"snapshot","snapshot":{"windowId":"window-one"}}'));
  assert.throws(() => parseEngineEvent('{"type":"tabs.delete","windowId":"window-one"}'));
  assert.deepEqual(parseEngineEvent('{"type":"address.revert","windowId":"window-one"}'),
    { type: 'address.revert', windowId: 'window-one' });
});
test('command results and hint geometry are validated before rendering', () => {
  const s = snapshot();
  assert.throws(() => validateSnapshot({ ...s, modal: { ...s.modal, hints: [{ label: 'a', x: Infinity, y: 0 }] } }, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, modal: { ...s.modal, palette: {
    visible: true, prompt: '', placeholder: '', text: '', selected: 4, error: '', status: '', rows: []
  } } }, s.windowId));
});

function replyTransport(answer: (requestId: string, method: string) => EngineEvent | null, ack = '{"ok":true,"value":null}') {
  const listeners = new Set<(event: EngineEvent) => void>();
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const transport: Transport = {
    call: async (_window, method, args) => {
      const parsed = JSON.parse(args);
      calls.push({ method, args: parsed });
      const event = answer(parsed.requestId, method);
      if (event) queueMicrotask(() => listeners.forEach(l => l(event)));
      return ack;
    },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { transport, calls, listeners };
}
test('requests resolve from the matching reply and release their subscription', async () => {
  const { transport, calls, listeners } = replyTransport(requestId => ({ type: 'reply', windowId: 'window-one', requestId, ok: true,
    value: { items: [{ url: 'https://example.com/', title: 'Example', domain: 'example.com', time: 1 }], done: true } }));
  const client = new EngineClient('window-one', transport);
  const page = await client.request('history.search', { text: 'ex' });
  assert.equal(page.items[0].title, 'Example');
  assert.equal(calls[0].method, 'history.search');
  assert.equal(typeof calls[0].args.requestId, 'string');
  assert.equal(listeners.size, 0);
});
test('a reply for another request or window does not settle a request', async () => {
  const { transport } = replyTransport(() => ({ type: 'reply', windowId: 'window-two', requestId: 'other', ok: true, value: null }));
  const client = new EngineClient('window-one', transport);
  await assert.rejects(client.request('bookmarks.remove', { id: '1' }, 30), /did not answer/);
});
test('request failures and malformed replies reject', async () => {
  const failing = replyTransport(requestId => ({ type: 'reply', windowId: 'window-one', requestId, ok: false, error: 'This bookmark cannot be removed' }));
  await assert.rejects(new EngineClient('window-one', failing.transport).request('bookmarks.remove', { id: '1' }), /cannot be removed/);
  const malformed = replyTransport(requestId => ({ type: 'reply', windowId: 'window-one', requestId, ok: true, value: [{ id: 3 }] }));
  await assert.rejects(new EngineClient('window-one', malformed.transport).request('extensions.list', {}), /Invalid extensions/);
  const refused = replyTransport(() => null, '{"ok":false,"error":"Unsupported engine request"}');
  await assert.rejects(new EngineClient('window-one', refused.transport).request('extensions.list', {}), /Unsupported/);
});
test('ordinary subscribers never see request replies', () => {
  let deliver!: (event: EngineEvent) => void;
  const client = new EngineClient('window-one', { call: async () => '', subscribe: listener => { deliver = listener; return () => {}; } });
  const events: EngineEvent[] = [];
  client.subscribe(event => events.push(event));
  deliver({ type: 'reply', windowId: 'window-one', requestId: 'r1', ok: true, value: null });
  deliver({ type: 'panel.open', windowId: 'window-one', panel: 'history' });
  assert.deepEqual(events.map(e => e.type), ['panel.open']);
});
test('panel events name only known panels', () => {
  assert.deepEqual(parseEngineEvent('{"type":"panel.open","windowId":"window-one","panel":"bookmarks"}'),
    { type: 'panel.open', windowId: 'window-one', panel: 'bookmarks' });
  assert.throws(() => parseEngineEvent('{"type":"panel.open","windowId":"window-one","panel":"chrome-settings"}'));
  // Merlin has one profile, so there is no profiles panel.
  assert.throws(() => parseEngineEvent('{"type":"panel.open","windowId":"window-one","panel":"profiles"}'));
});
test('split views must name open tabs, including the active one', () => {
  const tab = (id: string) => ({ id, title: id, url: 'https://example.com/', loading: false, pinned: false, audible: false, canGoBack: false, canGoForward: false });
  const s = { ...snapshot(), tabs: [tab('a'), tab('b'), tab('c')], activeTabId: 'a' };
  assert.doesNotThrow(() => validateSnapshot({ ...s, split: { tabs: ['a', 'b'], layout: 'sideBySide', ratio: 0.5 } }, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, split: { tabs: ['a', 'gone'], layout: 'sideBySide', ratio: 0.5 } }, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, split: { tabs: ['b', 'c'], layout: 'stacked', ratio: 0.5 } }, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, split: { tabs: ['a', 'b'], layout: 'diagonal', ratio: 0.5 } }, s.windowId));
});
test('pop-up windows and extension popups are described exactly', () => {
  assert.equal(validateSnapshot({ ...snapshot(), kind: 'popup' }, 'window-one').kind, 'popup');
  assert.throws(() => validateSnapshot({ ...snapshot(), kind: 'devtools' }, 'window-one'));
  const popup = { extensionId: 'abc', name: 'Notes', width: 320, height: 240, ready: false };
  assert.deepEqual(validateSnapshot({ ...snapshot(), extensionPopup: popup }, 'window-one').extensionPopup, popup);
  assert.throws(() => validateSnapshot({ ...snapshot(), extensionPopup: { ...popup, width: -1 } }, 'window-one'));
});
test('prompts name only known places, security and protection states', () => {
  const prompt = { id: 'p', kind: 'alert', origin: 'example.com', title: 'About this site', message: '', anchor: 'site',
    security: 'secure', protection: 'notReady', actions: [{ id: 'done', label: 'Done', emphasis: 'primary' }] };
  assert.equal(validateSnapshot({ ...snapshot(), prompt }, 'window-one').prompt?.anchor, 'site');
  assert.throws(() => validateSnapshot({ ...snapshot(), prompt: { ...prompt, anchor: 'toolbar' } }, 'window-one'));
  assert.throws(() => validateSnapshot({ ...snapshot(), prompt: { ...prompt, security: 'fine' } }, 'window-one'));
  assert.equal(validateSnapshot({ ...snapshot(), prompt }, 'window-one').prompt?.protection, 'notReady');
  assert.throws(() => validateSnapshot({ ...snapshot(), prompt: { ...prompt, protection: 'blocked' } }, 'window-one'));
});
test('address suggestions are validated before they render', () => {
  const item = { kind: 'search', title: 'cats', detail: '', url: 'https://search/?q=cats', completion: '', default: true };
  const event = parseEngineEvent(JSON.stringify({ type: 'omnibox.results', windowId: 'window-one', queryId: 'q1', items: [item] }));
  assert.equal(event.type, 'omnibox.results');
  assert.throws(() => parseEngineEvent(JSON.stringify({ type: 'omnibox.results', windowId: 'window-one', queryId: 'q1',
    items: [{ ...item, kind: 'script' }] })));
});
test('icons must be PNG data URLs', async () => {
  const reply = (value: unknown) => new EngineClient('window-one', {
    call: async () => JSON.stringify({ ok: true, value }), subscribe: () => () => {} });
  assert.deepEqual(await reply({ key: '1', url: 'data:image/png;base64,AA==' }).call('favicons.get', { tabId: 't' }),
    { key: '1', url: 'data:image/png;base64,AA==' });
  assert.equal(await reply(null).call('favicons.get', { tabId: 't' }), null);
  await assert.rejects(reply({ key: '1', url: 'https://tracker.example/icon.png' }).call('favicons.get', { tabId: 't' }));
});
test('tab layout, message tone and next-key hints are validated', () => {
  const s = snapshot();
  const modal = { ...s.modal, tabLayout: 'top' as const, messageIsError: true, whichKey: [{ keys: 'gt', description: 'Next tab' }] };
  assert.deepEqual(validateSnapshot({ ...s, modal }, s.windowId).modal, modal);
  assert.throws(() => validateSnapshot({ ...s, modal: { ...s.modal, tabLayout: 'bottom' as never } }, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, modal: { ...s.modal, messageIsError: 'yes' as never } }, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, modal: { ...s.modal, whichKey: [{ keys: 'g' }] as never } }, s.windowId));
});
test('the Ctrl-Tab switcher names tabs of this window and a card among them', () => {
  const tab = (id: string) => ({ id, title: id, url: 'https://a.test/', loading: false, pinned: false, audible: false, canGoBack: false, canGoForward: false });
  const s = { ...snapshot(), tabs: [tab('1'), tab('2')], activeTabId: '1' };
  const switcher = { tabs: ['1', '2'], selected: 1, recent: true };
  assert.deepEqual(validateSnapshot({ ...s, switcher }, 'window-one').switcher, switcher);
  assert.equal(validateSnapshot({ ...s, switcher: null }, 'window-one').switcher, null);
  assert.throws(() => validateSnapshot({ ...s, switcher: { ...switcher, selected: 2 } }, 'window-one'));
  assert.throws(() => validateSnapshot({ ...s, switcher: { ...switcher, tabs: ['1', '9'] } }, 'window-one'));
  assert.throws(() => validateSnapshot({ ...s, switcher: { ...switcher, recent: 'yes' } }, 'window-one'));
});
test('Command-T asks for the new-tab pop-up as a panel', () => {
  assert.deepEqual(parseEngineEvent(JSON.stringify({ type: 'panel.open', windowId: 'w', panel: 'newTab' })),
    { type: 'panel.open', windowId: 'w', panel: 'newTab' });
});
test('crashed tabs and the full download list are validated', async () => {
  const tab = { id: '1', title: 'A', url: 'https://a.test/', loading: false, pinned: false, audible: false, canGoBack: false, canGoForward: false };
  assert.equal(validateSnapshot({ ...snapshot(), tabs: [{ ...tab, crashed: true }] }, 'window-one').tabs[0].crashed, true);
  assert.throws(() => validateSnapshot({ ...snapshot(), tabs: [{ ...tab, crashed: 'yes' }] }, 'window-one'));
  assert.equal(validateSnapshot({ ...snapshot(), tabs: [{ ...tab, start: true }] }, 'window-one').tabs[0].start, true);
  assert.throws(() => validateSnapshot({ ...snapshot(), tabs: [{ ...tab, start: 'yes' }] }, 'window-one'));
  assert.equal(validateSnapshot({ ...snapshot(), tabs: [{ ...tab, color: '#1E3A7A' }] }, 'window-one').tabs[0].color, '#1E3A7A');
  assert.throws(() => validateSnapshot({ ...snapshot(), tabs: [{ ...tab, color: 'red' }] }, 'window-one'));
  assert.throws(() => validateSnapshot({ ...snapshot(), tabs: [{ ...tab, color: 'url(https://x.test/)' }] }, 'window-one'));
  assert.equal(validateSnapshot({ ...snapshot(), tabs: [{ ...tab, surface: '#0F0F0F' }] }, 'window-one').tabs[0].surface, '#0F0F0F');
  assert.throws(() => validateSnapshot({ ...snapshot(), tabs: [{ ...tab, surface: 'black' }] }, 'window-one'));
  let listener!: (event: EngineEvent) => void;
  let requestId = '';
  const client = new EngineClient('window-one', {
    call: async (_w, _m, args) => { requestId = JSON.parse(args).requestId; return JSON.stringify({ ok: true, value: null }); },
    subscribe: l => { listener = l; return () => {}; },
  });
  const answer = async (value: unknown) => {
    const pending = client.request('downloads.list', {});
    await new Promise(r => setImmediate(r));
    listener({ type: 'reply', windowId: 'window-one', requestId, ok: true, value });
    return pending;
  };
  assert.equal((await answer([{ id: '1', name: 'a.zip', received: 2, total: 2, state: 'complete' }])).length, 1);
  await assert.rejects(answer([{ id: '1', name: 'a.zip', received: -1, total: 2, state: 'complete' }]));
});
test('tab groups are validated, and grouped tabs must name one of them', () => {
  const tab = (id: string, group?: string) => ({ id, title: id, url: 'https://example.com/', loading: false, pinned: false, audible: false,
    canGoBack: false, canGoForward: false, ...(group ? { group } : {}) });
  const group = { id: 'g1', title: 'Research', color: 'blue', collapsed: false } as const;
  const s = { ...snapshot(), tabs: [tab('a', 'g1'), tab('b')], activeTabId: 'a', groups: [group] };
  assert.deepEqual(validateSnapshot(s, s.windowId).groups, [group]);
  assert.throws(() => validateSnapshot({ ...s, tabs: [tab('a', 'gone')] }, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, groups: [{ ...group, color: 'mauve' }] } as unknown as Snapshot, s.windowId));
  assert.throws(() => validateSnapshot({ ...s, groups: [group, group] }, s.windowId));
  // Older engines send no groups at all.
  assert.doesNotThrow(() => validateSnapshot({ ...snapshot(), tabs: [tab('a')], activeTabId: 'a' }, 'window-one'));
});
test('every split names its tabs, which sit together in twos or more', () => {
  const tab = (id: string, split?: string) => ({ id, title: id, url: 'https://example.com/', loading: false, pinned: false, audible: false,
    canGoBack: false, canGoForward: false, ...(split ? { split } : {}) });
  const s = { ...snapshot(), tabs: [tab('a'), tab('b', 's1'), tab('c', 's1'), tab('d')], activeTabId: 'a' };
  assert.equal(validateSnapshot(s, s.windowId).tabs[1].split, 's1');
  assert.throws(() => validateSnapshot({ ...s, tabs: [tab('a', 's1'), tab('b')] }, s.windowId), /split/);
  assert.throws(() => validateSnapshot({ ...s, tabs: [tab('a', 's1'), tab('b'), tab('c', 's1')] }, s.windowId), /split/);
  assert.throws(() => validateSnapshot({ ...s, tabs: [{ ...tab('a'), split: '' }, { ...tab('b'), split: '' }] }, s.windowId));
});
test('a peek is described exactly', () => {
  const peek = { url: 'https://docs.rs/', title: 'Docs.rs', loading: true, canGoBack: false };
  assert.deepEqual(validateSnapshot({ ...snapshot(), peek }, 'window-one').peek, peek);
  assert.equal(validateSnapshot({ ...snapshot(), peek: null }, 'window-one').peek, null);
  assert.throws(() => validateSnapshot({ ...snapshot(), peek: { ...peek, loading: 'yes' } } as unknown as Snapshot, 'window-one'));
});
