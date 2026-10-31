// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/page_scripts.h"

#include <algorithm>
#include <array>
#include <cmath>

#include "base/json/json_writer.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"

namespace modal_browser::page_scripts {

namespace {

// Shared helpers, placed inside each script's own function scope (see
// Scoped below): isolated worlds keep their globals between runs, so
// top-level `const`s would throw "already declared" the second time.
//  * visibleRect(el): the first client rect at least 3x3 px that intersects
//    the viewport, clipped to it; null if none.
//  * reachable(el, r): whether a point inside r hits el (or something
//    inside it, or its label), i.e. it is not covered by another element.
//  * viewport(): the transform from layout-viewport CSS px to device px.
constexpr char kHelpers[] = R"JS(
const __mbVisibleRect = (el) => {
  const vw = innerWidth, vh = innerHeight;
  for (const r of el.getClientRects()) {
    if (r.width < 3 || r.height < 3) continue;
    const left = Math.max(r.left, 0), top = Math.max(r.top, 0);
    const right = Math.min(r.right, vw), bottom = Math.min(r.bottom, vh);
    if (right - left >= 3 && bottom - top >= 3)
      return {left, top, width: right - left, height: bottom - top};
  }
  return null;
};
const __mbReachable = (el, r) => {
  const pts = [[r.left + r.width / 2, r.top + r.height / 2],
               [r.left + 2, r.top + 2],
               [r.left + r.width - 2, r.top + r.height - 2]];
  for (const [x, y] of pts) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) continue;
    if (hit === el || el.contains(hit) || hit.contains(el)) return true;
    if (hit.control === el || (hit.closest && hit.closest('label')?.control === el))
      return true;
  }
  return false;
};
const __mbViewport = () => {
  const vv = window.visualViewport;
  return {s: (vv ? vv.scale : 1) * (window.devicePixelRatio || 1),
          ox: vv ? vv.offsetLeft : 0, oy: vv ? vv.offsetTop : 0};
};
const __mbFlash = (el) => {
  if (el.animate) {
    el.animate([{outline: '2px solid #e8a33d', outlineOffset: '3px'},
                {outline: '2px solid rgba(232,163,61,0)', outlineOffset: '3px'}],
               {duration: 900, easing: 'ease-out'});
  }
};
// Offset of this frame's viewport inside the frames above it, as far up as
// frameElement is readable (same-origin ancestors); `d` counts the levels
// walked, so the browser knows whether it reached the frame's local root.
const __mbFrameOffset = () => {
  let x = 0, y = 0, d = 0, w = window;
  while (w !== w.parent) {
    let fe = null;
    try { fe = w.frameElement; } catch (e) { fe = null; }
    if (!fe) break;
    const r = fe.getBoundingClientRect();
    x += r.left + fe.clientLeft;
    y += r.top + fe.clientTop;
    d++;
    w = w.parent;
  }
  return {x, y, d};
};
// Elements matching `selector` in document order, including inside open
// shadow roots (web components such as MDN's code examples).
const __mbDeepAll = (selector, limit) => {
  const out = [];
  let seen = 0;
  const visit = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (++seen > 60000 || out.length >= limit) return;
      if (el.matches(selector)) out.push(el);
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(document);
  return out;
};
// What a node renders as children: its open shadow root's, a slot's
// assigned nodes, or its own.
const __mbKids = (node) => node.shadowRoot ? node.shadowRoot.childNodes :
    (node.tagName === 'SLOT' ? node.assignedNodes({flatten: true}) :
                               node.childNodes);
const __mbDeepActive = () => {
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement)
    el = el.shadowRoot.activeElement;
  return el;
};
const __mbEditable = (el) => {
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !el.readOnly;
  if (el.tagName !== 'INPUT') return false;
  const nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'image',
                   'file', 'color', 'range', 'hidden'];
  return !nonText.includes((el.type || '').toLowerCase()) && !el.readOnly;
};
)JS";

// mode: 0 clickable elements, 1 code blocks, 2 blocks of text.
// Kinds: 0 link, 1 editable, 2 other clickable, 3 code, 4 text block.
constexpr char kCollect[] = R"JS(
((mode) => {
  const MAX = 2000;
  const clickable = [
    'a[href]', 'area[href]', 'button', 'input:not([type=hidden])', 'select',
    'textarea', 'summary', '[contenteditable=""]', '[contenteditable=true]',
    '[contenteditable=plaintext-only]', '[role=button]', '[role=link]',
    '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=menuitem]',
    '[role=menuitemcheckbox]', '[role=menuitemradio]', '[role=option]',
    '[role=switch]', '[role=treeitem]', '[role=combobox]', '[onclick]',
    '[tabindex]:not([tabindex="-1"])'].join(',');
  const text = 'p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,dd,dt,figcaption';
  const selector = mode === 1 ? 'pre' : mode === 2 ? text : clickable;
  const els = [], out = [], taken = new Set();
  for (const el of __mbDeepAll(selector, MAX * 4)) {
    if (out.length >= MAX) break;
    if (mode === 0 &&
        (el.disabled || el.getAttribute('aria-disabled') === 'true')) continue;
    if (el.checkVisibility &&
        !el.checkVisibility({opacityProperty: true, visibilityProperty: true}))
      continue;
    if (mode !== 0) {
      if (!el.textContent.trim()) continue;
      // One label per block: skip blocks inside an already labelled one.
      const outer = el.parentElement && el.parentElement.closest(selector);
      if (outer && taken.has(outer)) continue;
    }
    const r = __mbVisibleRect(el);
    if (!r || (mode === 0 && !__mbReachable(el, r))) continue;
    if (mode === 0) {
      // A clickable wrapper around one clickable child (a link around a
      // button) would get two labels for one target: keep the outer one.
      const parent = els.length ? els[els.length - 1] : null;
      if (parent && parent.contains(el)) {
        const p = out[out.length - 1];
        if (Math.abs(p[1] - r.left) < 4 && Math.abs(p[2] - r.top) < 4) continue;
      }
    }
    let kind;
    if (mode === 0) {
      kind = el.matches('a[href],area[href]') ? 0 : (__mbEditable(el) ? 1 : 2);
    } else {
      kind = el.tagName === 'PRE' ? 3 : 4;
    }
    out.push([kind, r.left, r.top, r.width, r.height]);
    els.push(el);
    taken.add(el);
  }
  window.__modalBrowserHints = els;
  return {t: out, v: __mbViewport(), f: __mbFrameOffset()};
})
)JS";

// op: 0 nothing, 1 focus it, 2 select its contents, 3 return its text.
constexpr char kActivationTemplate[] = R"JS(
((index, op) => {
  const el = (window.__modalBrowserHints || [])[index];
  if (!el || !el.isConnected) return null;
  if (op === 1) el.focus({preventScroll: false});
  if (op === 2) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  let r = __mbVisibleRect(el);
  if (!r) {
    el.scrollIntoView({block: 'center', inline: 'nearest'});
    r = __mbVisibleRect(el);
  }
  if (!r) return null;
  const href = (el.matches('a[href],area[href]') && typeof el.href === 'string')
      ? el.href : '';
  const t = op === 3 ? String(el.innerText || el.textContent).slice(0, 1048576)
                     : '';
  if (op === 3) __mbFlash(el);
  return {x: r.left + Math.min(r.width / 2, 24), y: r.top + r.height / 2,
          href, e: __mbEditable(el), t, v: __mbViewport(),
          f: __mbFrameOffset()};
})
)JS";

// Extracts the readable structure of the page (or its main/article
// element): blocks of [kind, level, flags, lang, text, element, spans].
// Kinds: 0 heading, 1 paragraph, 2 list item, 3 code, 4 quote, 5 table
// row, 6 rule. Flags: 1 ordered list, 2 header row. Spans:
// [start, end, kind, href] in UTF-16 units; kinds 0 link, 1 code, 2 strong,
// 3 emphasis. Headings, code blocks and tables are remembered so
// kRevealTemplate can scroll to them.
constexpr char kDocument[] = R"JS(
(() => {
  const MAX_BLOCKS = 5000, MAX_TEXT = 2000000, MAX_SPANS = 256;
  const root = document.querySelector('main, [role=main], article') ||
               document.body;
  if (!root) return {t: document.title, u: location.href, b: []};
  const blocks = [], els = [];
  let total = 0, tables = 0;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG',
                        'CANVAS', 'IFRAME', 'OBJECT', 'BUTTON', 'SELECT',
                        'TEXTAREA', 'INPUT', 'DIALOG']);
  const SKIP_OUTSIDE_MAIN = new Set(['NAV', 'ASIDE', 'FOOTER']);
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER',
                         'FOOTER', 'NAV', 'ASIDE', 'H1', 'H2', 'H3', 'H4', 'H5',
                         'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE',
                         'HR', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION',
                         'DETAILS', 'SUMMARY', 'FORM', 'FIELDSET', 'ADDRESS',
                         'HGROUP']);
  const hidden = (el) => el.checkVisibility &&
      !el.checkVisibility({visibilityProperty: true});
  const full = () => blocks.length >= MAX_BLOCKS || total >= MAX_TEXT;
  const remember = (el) => { els.push(el); return els.length - 1; };
  const push = (kind, level, flags, lang, text, element, spans) => {
    if (full()) return;
    total += text.length;
    blocks.push([kind, level, flags, lang, text, element, spans]);
  };
  // Inline content: text with spans, stopping at nested blocks.
  const inline = (node, acc, stopAtLists) => {
    for (const child of __mbKids(node)) {
      if (acc.text.length > 65536) return;
      if (child.nodeType === 3) {
        const t = child.nodeValue.replace(/\s+/g, ' ');
        if (t === ' ' && (acc.text === '' || acc.text.endsWith(' '))) continue;
        acc.text += t;
        continue;
      }
      if (child.nodeType !== 1 || SKIP.has(child.tagName) || hidden(child))
        continue;
      const tag = child.tagName;
      if (stopAtLists && (tag === 'UL' || tag === 'OL')) continue;
      if (tag === 'BR') { acc.text += '\n'; continue; }
      const start = acc.text.length;
      inline(child, acc, stopAtLists);
      const end = acc.text.length;
      if (end <= start || acc.spans.length >= MAX_SPANS) continue;
      if (tag === 'A' && child.href) acc.spans.push([start, end, 0, child.href]);
      else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP')
        acc.spans.push([start, end, 1, '']);
      else if (tag === 'STRONG' || tag === 'B') acc.spans.push([start, end, 2, '']);
      else if (tag === 'EM' || tag === 'I') acc.spans.push([start, end, 3, '']);
    }
  };
  const inlineOf = (el, stopAtLists) => {
    const acc = {text: '', spans: []};
    inline(el, acc, stopAtLists);
    const lead = acc.text.length - acc.text.trimStart().length;
    const text = acc.text.trim();
    const spans = acc.spans
        .map(([s, e, k, h]) => [Math.max(0, s - lead),
                                Math.min(text.length, e - lead), k, h])
        .filter(([s, e]) => e > s);
    return {text, spans};
  };
  const codeLang = (pre) => {
    const code = pre.querySelector('code');
    for (const el of [pre, code]) {
      if (!el) continue;
      const m = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(el.className || '') ||
                /(?:^|\s)brush:\s*([\w+#-]+)/.exec(el.className || '');
      if (m) return m[1];
      if (el.dataset && el.dataset.lang) return el.dataset.lang;
    }
    return '';
  };
  const list = (el, depth) => {
    const ordered = el.tagName === 'OL';
    for (const li of el.children) {
      if (full()) return;
      if (li.tagName !== 'LI' || hidden(li)) continue;
      const {text, spans} = inlineOf(li, true);
      if (text) push(2, depth, ordered ? 1 : 0, '', text, -1, spans);
      for (const sub of li.querySelectorAll(':scope > ul, :scope > ol'))
        list(sub, depth + 1);
    }
  };
  const table = (el) => {
    const n = ++tables;
    const index = remember(el);
    let first = true;
    for (const tr of el.querySelectorAll('tr')) {
      if (full()) return;
      if (tr.closest('table') !== el) continue;
      const cells = [...tr.children].filter(c => c.tagName === 'TD' ||
                                                 c.tagName === 'TH');
      if (!cells.length) continue;
      const header = tr.parentElement.tagName === 'THEAD' ||
                     cells.every(c => c.tagName === 'TH');
      const text = cells.map(c => c.textContent.replace(/\s+/g, ' ').trim())
                        .join('\t');
      push(5, n, header ? 2 : 0, '', text, first ? index : -1, []);
      first = false;
    }
  };
  // Generic containers: runs of inline content become paragraphs.
  const walk = (el) => {
    let run = null;
    const flush = () => {
      if (!run) return;
      const holder = document.createElement('div');
      for (const n of run) holder.appendChild(n.cloneNode(true));
      run = null;
      const {text, spans} = inlineOf(holder, false);
      if (text) push(1, 1, 0, '', text, -1, spans);
    };
    for (const child of __mbKids(el)) {
      if (full()) return;
      if (child.nodeType === 3) {
        if (child.nodeValue.trim()) (run = run || []).push(child);
        continue;
      }
      if (child.nodeType !== 1 || SKIP.has(child.tagName) || hidden(child))
        continue;
      const blocks = 'p,div,ul,ol,pre,table,h1,h2,h3,h4,h5,h6';
      if (!BLOCK.has(child.tagName) && !child.querySelector(blocks) &&
          !(child.shadowRoot && child.shadowRoot.querySelector(blocks))) {
        (run = run || []).push(child);
        continue;
      }
      flush();
      block(child);
    }
    flush();
  };
  const block = (el) => {
    const tag = el.tagName;
    if (root === document.body && SKIP_OUTSIDE_MAIN.has(tag)) return;
    if (/^H[1-6]$/.test(tag)) {
      const {text, spans} = inlineOf(el, false);
      if (text) push(0, +tag[1], 0, '', text, remember(el), spans);
    } else if (tag === 'P' || tag === 'FIGCAPTION' || tag === 'DT' ||
               tag === 'DD' || tag === 'SUMMARY') {
      const {text, spans} = inlineOf(el, false);
      if (text) push(1, 1, 0, '', text, -1, spans);
    } else if (tag === 'PRE') {
      const text = String(el.innerText || el.textContent).slice(0, 65536);
      if (text.trim()) push(3, 1, 0, codeLang(el), text, remember(el), []);
    } else if (tag === 'UL' || tag === 'OL') {
      list(el, 1);
    } else if (tag === 'BLOCKQUOTE') {
      const {text, spans} = inlineOf(el, false);
      if (text) push(4, 1, 0, '', text, -1, spans);
    } else if (tag === 'TABLE') {
      table(el);
    } else if (tag === 'HR') {
      push(6, 1, 0, '', '', -1, []);
    } else {
      walk(el);
    }
  };
  walk(root);
  window.__modalBrowserBlocks = els;
  return {t: document.title, u: location.href, b: blocks};
})
)JS";

constexpr char kRevealTemplate[] = R"JS(
((index) => {
  const el = (window.__modalBrowserBlocks || [])[index];
  if (!el || !el.isConnected) return false;
  el.scrollIntoView({block: 'start', behavior: 'smooth'});
  __mbFlash(el);
  return true;
})
)JS";

// kind: heading, code, table, paragraph, link.
constexpr char kJumpTemplate[] = R"JS(
((kind, forward, count) => {
  const selectors = {
    heading: 'h1,h2,h3,h4,h5,h6,[role=heading]', code: 'pre', table: 'table',
    paragraph: 'p', link: 'a[href]'};
  const all = __mbDeepAll(selectors[kind] || 'h1', 20000)
      .filter(el => !el.checkVisibility || el.checkVisibility());
  let candidates;
  // A jump less than a second ago may still be scrolling: continue from
  // its target rather than from where the page happens to be.
  const last = window.__modalBrowserJump;
  const anchor = last && last.kind === kind && Date.now() - last.time < 1000
      ? all.indexOf(last.el) : -1;
  if (anchor >= 0) {
    candidates = forward ? all.slice(anchor + 1)
                         : all.slice(0, anchor).reverse();
  } else {
    // Below the top strip of the viewport (where a jump puts its target),
    // or above the viewport.
    const tops = all.map(el => el.getBoundingClientRect().top);
    candidates = forward ? all.filter((el, i) => tops[i] > 40)
                         : all.filter((el, i) => tops[i] < -8).reverse();
  }
  const el = candidates[Math.min(count, candidates.length) - 1];
  if (!el) return false;
  window.__modalBrowserJump = {kind, el, time: Date.now()};
  el.scrollIntoView({block: 'start', behavior: 'smooth'});
  __mbFlash(el);
  if (kind === 'link') el.focus({preventScroll: true});
  return true;
})
)JS";

// unit: character, word, line, sentence, paragraph, documentboundary.
constexpr char kExtendSelectionTemplate[] = R"JS(
((forward, unit, count) => {
  const sel = getSelection();
  if (!sel.rangeCount) return 0;
  for (let i = 0; i < count; ++i)
    sel.modify('extend', forward ? 'forward' : 'backward', unit);
  if (sel.focusNode && sel.focusNode.parentElement)
    sel.focusNode.parentElement.scrollIntoView({block: 'nearest'});
  return sel.toString().length;
})
)JS";

constexpr char kMarkPosition[] = R"JS(
(() => {
  const root = document.scrollingElement || document.documentElement;
  return {u: location.href, x: Math.round(root.scrollLeft),
          y: Math.round(root.scrollTop)};
})
)JS";

constexpr char kScrollToTemplate[] = R"JS(
((x, y) => {
  const root = document.scrollingElement || document.documentElement;
  root.scrollTo({left: x, top: y, behavior: 'instant'});
  return true;
})
)JS";

constexpr char kClearSelection[] = R"JS(
(() => { getSelection().removeAllRanges(); return true; })
)JS";

constexpr char kSelectionText[] = R"JS(
(() => String(getSelection()).slice(0, 1048576))
)JS";

// Describes the focused field and tags it with `token` for the later read
// and write. Never returns the value.
constexpr char kFieldInfoTemplate[] = R"JS(
((token) => {
  const el = __mbDeepActive();
  window.__modalBrowserEdit = null;
  if (!el || el === document.body || !__mbEditable(el))
    return {k: 0, t: '', a: '', l: '', n: 0, r: false};
  window.__modalBrowserEdit = {token, el};
  const kind = el.isContentEditable ? 3 : el.tagName === 'TEXTAREA' ? 2 : 1;
  const label = [el.name, el.id, el.getAttribute('aria-label'),
                 el.getAttribute('placeholder')].filter(Boolean).join(' ');
  const value = kind === 3 ? el.innerText : el.value;
  return {k: kind, t: kind === 1 ? (el.type || 'text') : '',
          a: el.getAttribute('autocomplete') || '', l: label.slice(0, 512),
          n: String(value || '').length, r: !!el.readOnly};
})
)JS";

constexpr char kFieldValueTemplate[] = R"JS(
((token) => {
  const edit = window.__modalBrowserEdit;
  if (!edit || edit.token !== token || !edit.el.isConnected) return null;
  const el = edit.el;
  const type = (el.type || '').toLowerCase();
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  if (el.readOnly || el.disabled ||
      (el.tagName === 'INPUT' &&
       !['text', 'search', 'url', 'email', 'tel', ''].includes(type)) ||
      autocomplete.split(/\s+/).some(t => t.startsWith('cc-') ||
        ['current-password', 'new-password', 'one-time-code',
         'transaction-amount'].includes(t))) return null;
  return String(el.isContentEditable ? el.innerText : el.value);
})
)JS";

// Writes `text` into the tagged field the way typing would be seen: the
// native value setter plus input and change events, or an insertText edit
// for rich editors, so frameworks update their state.
constexpr char kFieldWriteTemplate[] = R"JS(
((token, text) => {
  const edit = window.__modalBrowserEdit;
  if (!edit || edit.token !== token || !edit.el.isConnected) return false;
  const el = edit.el;
  const type = (el.type || '').toLowerCase();
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  if (el.readOnly || el.disabled ||
      (el.tagName === 'INPUT' &&
       !['text', 'search', 'url', 'email', 'tel', ''].includes(type)) ||
      autocomplete.split(/\s+/).some(t => t.startsWith('cc-') ||
        ['current-password', 'new-password', 'one-time-code',
         'transaction-amount'].includes(t))) return null;
  if (el.isContentEditable) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (!document.execCommand('insertText', false, text)) el.innerText = text;
    return true;
  }
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
                                          : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, text);
  el.dispatchEvent(new InputEvent('input', {bubbles: true,
      inputType: 'insertReplacementText', data: text}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return true;
})
)JS";

// Scroll kinds as the script names them.
const char* ScrollName(ffi::ScrollKind scroll) {
  switch (scroll) {
    case ffi::ScrollKind::Down:
      return "down";
    case ffi::ScrollKind::Up:
      return "up";
    case ffi::ScrollKind::Left:
      return "left";
    case ffi::ScrollKind::Right:
      return "right";
    case ffi::ScrollKind::Top:
      return "top";
    case ffi::ScrollKind::Bottom:
      return "bottom";
    case ffi::ScrollKind::HalfPageDown:
      return "half-down";
    case ffi::ScrollKind::HalfPageUp:
      return "half-up";
    case ffi::ScrollKind::PageDown:
      return "page-down";
    case ffi::ScrollKind::PageUp:
      return "page-up";
    default:
      return nullptr;
  }
}

constexpr char kScrollTemplate[] = R"JS(
((kind, count, step, smooth) => {
  const root = document.scrollingElement || document.documentElement;
  const vertical = !(kind === 'left' || kind === 'right');
  const canScroll = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el === root || el === document.body) {
      return vertical ? root.scrollHeight > root.clientHeight
                      : root.scrollWidth > root.clientWidth;
    }
    const s = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(vertical ? s.overflowY : s.overflowX))
      return false;
    return vertical ? el.scrollHeight > el.clientHeight + 1
                    : el.scrollWidth > el.clientWidth + 1;
  };
  const ancestor = (el) => {
    for (let e = el; e && e !== root && e !== document.body; e = e.parentElement)
      if (canScroll(e)) return e;
    return null;
  };
  let target = null;
  const active = document.activeElement;
  if (active && active !== document.body) target = ancestor(active);
  if (!target && canScroll(root)) target = root;
  if (!target) target = ancestor(document.elementFromPoint(innerWidth / 2,
                                                           innerHeight / 2));
  if (!target) {
    // Pages whose document does not scroll but an inner panel does.
    let best = 0, seen = 0;
    for (const e of document.querySelectorAll('body *')) {
      if (++seen > 3000) break;
      if (!canScroll(e)) continue;
      const r = e.getBoundingClientRect();
      const area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
                   Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (area > best) { best = area; target = e; }
    }
  }
  if (!target) target = root;
  const view = target === root ? innerHeight : target.clientHeight;
  const behavior = smooth ? 'smooth' : 'instant';
  const by = (top, left) => target.scrollBy({top, left, behavior});
  switch (kind) {
    case 'down': by(step * count, 0); break;
    case 'up': by(-step * count, 0); break;
    case 'right': by(0, step * count); break;
    case 'left': by(0, -step * count); break;
    case 'half-down': by(view / 2 * count, 0); break;
    case 'half-up': by(-view / 2 * count, 0); break;
    case 'page-down': by(view * 0.9 * count, 0); break;
    case 'page-up': by(-view * 0.9 * count, 0); break;
    case 'top': target.scrollTo({top: 0, behavior}); break;
    case 'bottom': target.scrollTo({top: target.scrollHeight, behavior}); break;
  }
})
)JS";

std::optional<double> GetNumber(const base::DictValue& dict,
                                std::string_view key) {
  const base::Value* v = dict.Find(key);
  if (!v || !(v->is_int() || v->is_double())) {
    return std::nullopt;
  }
  const double d = v->GetDouble();
  return std::isfinite(d) ? std::optional<double>(d) : std::nullopt;
}

std::optional<ViewportTransform> ParseTransform(const base::DictValue* v) {
  if (!v) {
    return std::nullopt;
  }
  auto s = GetNumber(*v, "s");
  auto ox = GetNumber(*v, "ox");
  auto oy = GetNumber(*v, "oy");
  if (!s || !ox || !oy || *s <= 0 || *s > 100) {
    return std::nullopt;
  }
  return ViewportTransform{*s, *ox, *oy};
}

// Wraps helpers plus one function-expression template in a fresh scope and
// calls the template with `args`: `(() => { helpers; const run = T; return
// run(args); })()`. Nothing leaks into the isolated world's globals except
// what the scripts store deliberately (window.__modalBrowserHints).
std::string Scoped(std::string_view body_template, std::string_view args) {
  return std::string("(() => {") + kHelpers + "\nconst __mbRun = " +
         std::string(body_template) + ";\nreturn __mbRun(" + std::string(args) +
         ");\n})()";
}

}  // namespace

gfx::PointF ViewportTransform::ToDip(double css_x,
                                     double css_y,
                                     float device_scale) const {
  const double k = scale / std::max(device_scale, 0.1f);
  return gfx::PointF(static_cast<float>((css_x - offset_x) * k),
                     static_cast<float>((css_y - offset_y) * k));
}

std::u16string CollectHintsScript(ffi::HintTargets targets) {
  const char* mode = targets == ffi::HintTargets::Code   ? "1"
                     : targets == ffi::HintTargets::Text ? "2"
                                                         : "0";
  return base::UTF8ToUTF16(Scoped(kCollect, mode));
}

namespace {

FrameOffset ParseFrameOffset(const base::DictValue* f) {
  FrameOffset out;
  if (!f) {
    return out;
  }
  auto x = GetNumber(*f, "x");
  auto y = GetNumber(*f, "y");
  auto d = GetNumber(*f, "d");
  if (x && y && d && std::abs(*x) < 1e7 && std::abs(*y) < 1e7 && *d >= 0 &&
      *d < 64) {
    out = FrameOffset{*x, *y, static_cast<int>(*d)};
  }
  return out;
}

}  // namespace

std::optional<HintTargets> ParseHintTargets(const base::Value& result) {
  const base::DictValue* dict = result.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  auto transform = ParseTransform(dict->FindDict("v"));
  const base::ListValue* list = dict->FindList("t");
  if (!transform || !list) {
    return std::nullopt;
  }
  HintTargets out;
  out.transform = *transform;
  out.offset = ParseFrameOffset(dict->FindDict("f"));
  for (const base::Value& item : *list) {
    if (out.targets.size() >= kMaxHintTargets) {
      break;
    }
    const base::ListValue* t = item.GetIfList();
    if (!t || t->size() != 5) {
      return std::nullopt;
    }
    std::array<double, 5> n;
    for (size_t i = 0; i < 5; ++i) {
      const base::Value& v = (*t)[i];
      if (!(v.is_int() || v.is_double()) || !std::isfinite(v.GetDouble())) {
        return std::nullopt;
      }
      n[i] = v.GetDouble();
    }
    HintTarget target;
    target.kind = n[0] == 0   ? ffi::HintKind::Link
                  : n[0] == 1 ? ffi::HintKind::Editable
                  : n[0] == 3 ? ffi::HintKind::Code
                  : n[0] == 4 ? ffi::HintKind::Block
                              : ffi::HintKind::Other;
    target.css_rect = gfx::RectF(n[1], n[2], std::max(0.0, n[3]),
                                 std::max(0.0, n[4]));
    out.targets.push_back(target);
  }
  return out;
}

std::u16string ActivationInfoScript(uint32_t index, ElementOp op) {
  return base::UTF8ToUTF16(
      Scoped(kActivationTemplate, base::NumberToString(index) + ", " +
                                      base::NumberToString(static_cast<int>(op))));
}

std::optional<ActivationInfo> ParseActivationInfo(const base::Value& result) {
  const base::DictValue* dict = result.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  auto x = GetNumber(*dict, "x");
  auto y = GetNumber(*dict, "y");
  auto transform = ParseTransform(dict->FindDict("v"));
  const std::string* href = dict->FindString("href");
  std::optional<bool> editable = dict->FindBool("e");
  const std::string* text = dict->FindString("t");
  if (!x || !y || !transform || !href || !editable || href->size() > 8192 ||
      (text && text->size() > kMaxTextBytes)) {
    return std::nullopt;
  }
  return ActivationInfo{gfx::PointF(*x, *y), *transform, *href, *editable,
                        text ? *text : std::string(),
                        ParseFrameOffset(dict->FindDict("f"))};
}

std::u16string DocumentScript() {
  return base::UTF8ToUTF16(Scoped(kDocument, ""));
}

namespace {

std::optional<int64_t> GetInt(const base::Value& v) {
  if (v.is_int()) {
    return v.GetInt();
  }
  if (v.is_double() && std::isfinite(v.GetDouble()) &&
      v.GetDouble() == std::floor(v.GetDouble()) &&
      std::abs(v.GetDouble()) < 1e15) {
    return static_cast<int64_t>(v.GetDouble());
  }
  return std::nullopt;
}

}  // namespace

std::optional<PageDocument> ParseDocument(const base::Value& result) {
  const base::DictValue* dict = result.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  const std::string* title = dict->FindString("t");
  const std::string* url = dict->FindString("u");
  const base::ListValue* list = dict->FindList("b");
  if (!title || !url || !list) {
    return std::nullopt;
  }
  PageDocument doc;
  doc.title = title->substr(0, 1024);
  doc.url = url->substr(0, 8192);
  size_t total = 0;
  for (const base::Value& item : *list) {
    if (doc.blocks.size() >= kMaxBlocks || total > kMaxTextBytes * 2) {
      break;
    }
    const base::ListValue* b = item.GetIfList();
    if (!b || b->size() != 7 || !(*b)[3].is_string() || !(*b)[4].is_string() ||
        !(*b)[6].is_list()) {
      return std::nullopt;
    }
    auto kind = GetInt((*b)[0]);
    auto level = GetInt((*b)[1]);
    auto flags = GetInt((*b)[2]);
    auto element = GetInt((*b)[5]);
    if (!kind || *kind < 0 || *kind > 6 || !level || !flags || !element) {
      return std::nullopt;
    }
    static constexpr std::array<ffi::BlockKind, 7> kKinds = {
        ffi::BlockKind::Heading, ffi::BlockKind::Paragraph,
        ffi::BlockKind::ListItem, ffi::BlockKind::Code,
        ffi::BlockKind::Quote,   ffi::BlockKind::TableRow,
        ffi::BlockKind::Rule};
    PageBlock block;
    block.kind = kKinds[*kind];
    block.level = static_cast<uint32_t>(std::clamp<int64_t>(*level, 1, 255));
    block.ordered = *flags & 1;
    block.header = *flags & 2;
    block.lang = (*b)[3].GetString().substr(0, 64);
    block.text = (*b)[4].GetString().substr(0, kMaxTextBytes);
    total += block.text.size();
    block.element = *element >= 0 && *element < (1 << 30)
                        ? static_cast<uint32_t>(*element)
                        : kNoElement;
    for (const base::Value& sv : (*b)[6].GetList()) {
      if (block.spans.size() >= 256) {
        break;
      }
      const base::ListValue* sp = sv.GetIfList();
      if (!sp || sp->size() != 4 || !(*sp)[3].is_string()) {
        return std::nullopt;
      }
      auto start = GetInt((*sp)[0]);
      auto end = GetInt((*sp)[1]);
      auto skind = GetInt((*sp)[2]);
      if (!start || !end || !skind || *start < 0 || *end < *start ||
          *end > (1 << 30) || *skind < 0 || *skind > 3) {
        return std::nullopt;
      }
      static constexpr std::array<ffi::SpanKind, 4> kSpanKinds = {
          ffi::SpanKind::Link, ffi::SpanKind::Code, ffi::SpanKind::Strong,
          ffi::SpanKind::Emphasis};
      block.spans.push_back({static_cast<uint32_t>(*start),
                             static_cast<uint32_t>(*end), kSpanKinds[*skind],
                             (*sp)[3].GetString().substr(0, 8192)});
    }
    doc.blocks.push_back(std::move(block));
  }
  return doc;
}

std::u16string RevealScript(uint32_t element) {
  return base::UTF8ToUTF16(
      Scoped(kRevealTemplate, base::NumberToString(element)));
}

std::u16string JumpScript(ffi::BlockJump kind, bool forward, int count) {
  const char* name = kind == ffi::BlockJump::Code        ? "code"
                     : kind == ffi::BlockJump::Table     ? "table"
                     : kind == ffi::BlockJump::Paragraph ? "paragraph"
                     : kind == ffi::BlockJump::Link      ? "link"
                                                         : "heading";
  return base::UTF8ToUTF16(Scoped(
      kJumpTemplate, std::string("'") + name + "', " +
                         (forward ? "true" : "false") + ", " +
                         base::NumberToString(std::clamp(count, 1, 9999))));
}

std::u16string ExtendSelectionScript(bool forward,
                                     ffi::SelectUnit unit,
                                     int count) {
  const char* name = unit == ffi::SelectUnit::Word        ? "word"
                     : unit == ffi::SelectUnit::Line      ? "line"
                     : unit == ffi::SelectUnit::Sentence  ? "sentence"
                     : unit == ffi::SelectUnit::Paragraph ? "paragraph"
                     : unit == ffi::SelectUnit::Document  ? "documentboundary"
                                                          : "character";
  return base::UTF8ToUTF16(
      Scoped(kExtendSelectionTemplate,
             std::string(forward ? "true" : "false") + ", '" + name + "', " +
                 base::NumberToString(std::clamp(count, 1, 9999))));
}

std::u16string MarkPositionScript() {
  return base::UTF8ToUTF16(Scoped(kMarkPosition, ""));
}

std::optional<MarkPosition> ParseMarkPosition(const base::Value& result) {
  const base::DictValue* dict = result.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  const std::string* url = dict->FindString("u");
  auto x = GetNumber(*dict, "x");
  auto y = GetNumber(*dict, "y");
  if (!url || url->size() > 8192 || !x || !y) {
    return std::nullopt;
  }
  return MarkPosition{*url, static_cast<int64_t>(std::clamp(*x, 0.0, 1e7)),
                      static_cast<int64_t>(std::clamp(*y, 0.0, 1e7))};
}

std::u16string ScrollToScript(int64_t x, int64_t y) {
  return base::UTF8ToUTF16(Scoped(
      kScrollToTemplate,
      base::NumberToString(std::clamp<int64_t>(x, 0, 10000000)) + ", " +
          base::NumberToString(std::clamp<int64_t>(y, 0, 10000000))));
}

std::u16string ClearSelectionScript() {
  return base::UTF8ToUTF16(Scoped(kClearSelection, ""));
}

std::u16string SelectionTextScript() {
  return base::UTF8ToUTF16(Scoped(kSelectionText, ""));
}

std::u16string FieldInfoScript(uint64_t token) {
  return base::UTF8ToUTF16(
      Scoped(kFieldInfoTemplate, "'" + base::NumberToString(token) + "'"));
}

std::optional<FieldDescription> ParseFieldInfo(const base::Value& result) {
  const base::DictValue* dict = result.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  std::optional<int> kind = dict->FindInt("k");
  const std::string* type = dict->FindString("t");
  const std::string* autocomplete = dict->FindString("a");
  const std::string* label = dict->FindString("l");
  std::optional<double> length = GetNumber(*dict, "n");
  std::optional<bool> read_only = dict->FindBool("r");
  if (!kind || *kind < 0 || *kind > 3 || !type || !autocomplete || !label ||
      !length || *length < 0 || !read_only) {
    return std::nullopt;
  }
  static constexpr std::array<ffi::FieldKind, 4> kKinds = {
      ffi::FieldKind::None, ffi::FieldKind::Input, ffi::FieldKind::TextArea,
      ffi::FieldKind::ContentEditable};
  return FieldDescription{kKinds[*kind], type->substr(0, 64),
                          autocomplete->substr(0, 256), label->substr(0, 512),
                          static_cast<uint32_t>(std::min(*length, 4e9)),
                          *read_only};
}

std::u16string FieldValueScript(uint64_t token) {
  return base::UTF8ToUTF16(
      Scoped(kFieldValueTemplate, "'" + base::NumberToString(token) + "'"));
}

std::u16string FieldWriteScript(uint64_t token, std::string_view text) {
  // JSON string syntax is valid JavaScript string syntax, so the text is
  // passed as data and can never become code.
  std::string literal;
  base::JSONWriter::Write(base::Value(std::string(text)), &literal);
  return base::UTF8ToUTF16(Scoped(
      kFieldWriteTemplate, "'" + base::NumberToString(token) + "', " + literal));
}

std::u16string ScrollScript(ffi::ScrollKind scroll,
                            int count,
                            int step_px,
                            bool smooth) {
  const char* name = ScrollName(scroll);
  if (!name) {
    return std::u16string();
  }
  std::string script = kScrollTemplate;
  script += "('" + std::string(name) + "', " +
            base::NumberToString(std::clamp(count, 1, 9999)) + ", " +
            base::NumberToString(std::clamp(step_px, 1, 2000)) + ", " +
            (smooth ? "true" : "false") + ")";
  return base::UTF8ToUTF16(script);
}

}  // namespace modal_browser::page_scripts
