// Runs only in Merlin's reserved isolated world. Native code owns the document
// lifetime and browser-derived rules; this helper reports new class/id names
// and applies procedural rules when the DOM changes. Work and retained DOM
// roots are capped; a busy page cannot enqueue an unbounded document scan.
(function(rules, collectIds) {
  'use strict';
  const MAX_ROOTS = 512, MAX_SEEN = 8192, MAX_TEXT = 65536;
  const seenClass = new Set(), seenId = new Set();
  const classes = [], ids = [], roots = [];
  let walker = null, node = null, ruleIndex = 0, paused = false;
  function enqueue(root) {
    if (root && roots.length < MAX_ROOTS) roots.push(root.nodeType === 3 ? root.parentElement : root);
  }
  function identifier(value, seen, queue) {
    if (value && value.length <= 256 && seen.size < MAX_SEEN && !seen.has(value)) {
      seen.add(value); queue.push(value);
    }
  }
  function pattern(expression, value) {
    if (expression.length > 1024) return false;
    if (expression[0] !== '/') return value.includes(expression.replace(/^['"]|['"]$/g, ''));
    const end = expression.lastIndexOf('/');
    if (end <= 0) return false;
    try { return new RegExp(expression.slice(1, end), expression.slice(end + 1).replace(/[gy]/g, '')).test(value); }
    catch { return false; }
  }
  function descendants(root, selector) {
    const found = [], scan = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let item, count = 0;
    while ((item = scan.nextNode()) && ++count <= 512) {
      if (item.matches(selector)) found.push(item);
      if (found.length === 64) break;
    }
    return found;
  }
  function apply(element, rule) {
    let matches = [element];
    for (let index = 0; index < rule.selector.length && matches.length; ++index) {
      const {type, arg = ''} = rule.selector[index];
      if (type === 'css-selector') {
        matches = index === 0 ? matches.filter(e => e.matches(arg)) : matches.flatMap(e => descendants(e, arg)).slice(0, 64);
      } else if (type === 'has-text') {
        matches = matches.filter(e => pattern(arg, (e.textContent || '').slice(0, MAX_TEXT)));
      } else if (type === 'min-text-length') {
        matches = matches.filter(e => (e.textContent || '').length >= Number(arg));
      } else if (type === 'matches-path') {
        if (!pattern(arg, location.pathname + location.search)) matches = [];
      } else if (type === 'upward') {
        matches = matches.map(e => {
          if (/^\d+$/.test(arg)) {
            const levels = Number(arg); if (levels > 32) return null;
            for (let n = 0; e && n < levels; ++n) e = e.parentElement;
            return e;
          }
          return e.parentElement?.closest(arg);
        }).filter(Boolean);
      } else if (type === 'matches-attr') {
        const split = arg.indexOf('=');
        const name = (split < 0 ? arg : arg.slice(0, split)).trim();
        matches = matches.filter(e => [...e.attributes].slice(0, 128).some(a =>
          pattern(name, a.name) && (split < 0 || pattern(arg.slice(split + 1).trim(), a.value.slice(0, MAX_TEXT)))));
      } else if (type.startsWith('matches-css')) {
        const colon = arg.indexOf(':'); if (colon < 0) return;
        const property = arg.slice(0, colon).trim(), value = arg.slice(colon + 1).trim();
        const pseudo = type === 'matches-css-before' ? '::before' : type === 'matches-css-after' ? '::after' : null;
        matches = matches.filter(e => pattern(value, getComputedStyle(e, pseudo).getPropertyValue(property)));
      } else if (type === 'xpath') {
        matches = matches.flatMap(e => {
          const result = document.evaluate(arg, e, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
          const found = []; let item, visited = 0;
          while (++visited <= 512 && found.length < 64 && (item = result.iterateNext())) if (item.nodeType === 1) found.push(item);
          return found;
        }).slice(0, 64);
      } else { return; }
    }
    for (const element of new Set(matches)) {
      if (!element.isConnected) continue;
      const action = rule.action || {type: 'style', arg: 'display:none!important;'};
      if (action.type === 'remove') element.remove();
      else if (action.type === 'remove-attr') { if (element.hasAttribute(action.arg)) element.removeAttribute(action.arg); }
      else if (action.type === 'remove-class') { if (element.classList.contains(action.arg)) element.classList.remove(action.arg); }
      else if (action.type === 'style') {
        // Parse declarations through the browser; compare before mutating so
        // our own style changes do not sustain a mutation loop.
        const style = document.createElement('span').style;
        style.cssText = action.arg;
        for (const property of style) {
          const value = style.getPropertyValue(property), priority = style.getPropertyPriority(property);
          if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== priority)
            element.style.setProperty(property, value, priority);
        }
      }
    }
  }
  // Event driven: work is scheduled only when the DOM changes, in idle time
  // (frame-scheduled, so background tabs throttle and frozen pages stop).
  let scheduled = false;
  const idle = globalThis.requestIdleCallback
    ? (callback) => requestIdleCallback(callback, {timeout: 250})
    : (callback) => setTimeout(callback, 50);
  function schedule() {
    if (scheduled || paused) return;
    if (document.prerendering) {
      document.addEventListener('prerenderingchange', schedule, {once: true});
      return;
    }
    scheduled = true;
    idle(pump);
  }
  function collect(element) {
    if (!collectIds || element.nodeType !== 1) return;
    identifier(element.id, seenId, ids);
    for (const value of element.classList) identifier(value, seenClass, classes);
  }
  const observer = new MutationObserver(records => {
    for (const change of records) {
      if (change.type === 'childList') {
        for (const added of change.addedNodes) {
          if (added.nodeType === 1) enqueue(added);
          else if (rules.length) enqueue(added);
          if (roots.length === MAX_ROOTS) break;
        }
        // Procedural rules can depend on a parent's text or children.
        if (rules.length) enqueue(change.target);
      } else if (rules.length) {
        enqueue(change.target);
      } else {
        collect(change.target);  // class/id change on one element
      }
      if (roots.length === MAX_ROOTS) break;
    }
    // A pass with nothing queued does nothing (a page's clock rewriting its
    // text, without procedural rules), so it needn't wake the page for one.
    if (roots.length || classes.length || ids.length || walker || node) schedule();
  });
  // Without procedural rules only element additions and class/id changes
  // matter, so ordinary attribute and text churn is not observed at all.
  const observe = () => observer.observe(document, rules.length
    ? {subtree: true, childList: true, attributes: true, characterData: true}
    : {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'id']});
  function work(budget) {
    const deadline = performance.now() + budget;
    let steps = 0;
    while (++steps <= 2500 && performance.now() < deadline) {
      if (!node) {
        if (walker) node = walker.nextNode();
        if (!node) {
          walker = null;
          const root = roots.shift(); if (!root) break;
          if (root !== document && !root.isConnected) continue;
          walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          node = root.nodeType === 1 ? root : walker.nextNode();
          if (!node) continue;
        }
        ruleIndex = 0;
        collect(node);
      }
      if (ruleIndex < rules.length) {
        try { apply(node, rules[ruleIndex]); } catch { /* Malformed/obsolete selector affects only its rule. */ }
        ++ruleIndex;
      } else node = null;
    }
    if (classes.length || ids.length) {
      const report = JSON.stringify({classes: classes.splice(0), ids: ids.splice(0)});
      globalThis.__merlinAdblockReport?.(report);
    }
    return !!(node || walker || roots.length);
  }
  function pump(deadline) {
    scheduled = false;
    if (paused || document.prerendering) return schedule();
    const budget = deadline && !deadline.didTimeout
      ? Math.max(1, Math.min(3, deadline.timeRemaining())) : 3;
    if (work(budget)) schedule();
  }
  observe(); enqueue(document); schedule();
  addEventListener('pagehide', () => { paused = true; observer.disconnect(); roots.length = 0; walker = node = null; });
  addEventListener('pageshow', () => { paused = false; observe(); enqueue(document); schedule(); });
  globalThis.__merlinAdblockRescan = () => { enqueue(document); schedule(); };
  // Diagnostic hook: run one bounded slice now.
  globalThis.__merlinAdblockTick = () => { if (!paused) work(3); };
})(MERLIN_PROCEDURAL_RULES, MERLIN_COLLECT_IDENTIFIERS);
