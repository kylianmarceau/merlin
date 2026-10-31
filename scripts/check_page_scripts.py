#!/usr/bin/env python3
"""Syntax-checks the JavaScript in page_scripts.cc with Node, exactly as the
C++ assembles it (helpers + template + arguments). Skips if node is absent.

The scripts only run inside Chromium, so without this a typo shows up as a
silent no-op in browser tests."""
import re, shutil, subprocess, sys, tempfile, pathlib

SRC = pathlib.Path(__file__).resolve().parent.parent / \
    "overlay/chrome/browser/ui/modal_browser/page_scripts.cc"

if not shutil.which("node"):
    print("node not found; skipping page script check")
    sys.exit(0)

src = SRC.read_text()

def raw(name):
    # C++ raw string R"JS(...)JS": the content ends before the ')JS"'.
    m = re.search(r'constexpr char ' + name + r'\[\] = R"JS\((.*?)\)JS";', src, re.S)
    if not m:
        sys.exit(f"{name} not found in {SRC}")
    return m.group(1)

helpers = raw("kHelpers")

def scoped(template, args):
    # Mirrors Scoped() in page_scripts.cc.
    return ("(() => {" + helpers + "\nconst __mbRun = " + template +
            ";\nreturn __mbRun(" + args + ");\n})()")

collect = scoped(raw("kCollect"), "2")
activation = scoped(raw("kActivationTemplate"), "1, 3")
scroll = raw("kScrollTemplate") + "('half-down', 2, 60, true)"
document = scoped(raw("kDocument"), "")
reveal = scoped(raw("kRevealTemplate"), "4")
jump = scoped(raw("kJumpTemplate"), "'code', false, 2")
extend = scoped(raw("kExtendSelectionTemplate"), "true, 'word', 3")
clear = scoped(raw("kClearSelection"), "")
selection = scoped(raw("kSelectionText"), "")
mark = scoped(raw("kMarkPosition"), "")
scroll_to = scoped(raw("kScrollToTemplate"), "0, 1200")
field_info = scoped(raw("kFieldInfoTemplate"), "'123'")
field_value = scoped(raw("kFieldValueTemplate"), "'123'")
# The C++ passes the text as a JSON string literal.
field_write = scoped(raw("kFieldWriteTemplate"), "'123', \"a \\\"quoted\\\" line\\n\"")
cases = {
    "collect": collect,
    "activation": activation,
    "scroll": scroll,
    "document": document,
    "reveal": reveal,
    "jump": jump,
    "extend selection": extend,
    "clear selection": clear,
    "selection text": selection,
    "mark position": mark,
    "scroll to": scroll_to,
    "field info": field_info,
    "field value": field_value,
    "field write": field_write,
    # Isolated worlds keep globals between runs: running the scripts one
    # after another in one scope must not redeclare anything.
    "every script in one scope": ";\n".join(
        [collect, activation, scroll, document, reveal, jump, extend, clear,
         selection, mark, scroll_to, field_info, field_value, field_write,
         collect]),
}
# Exercise the field boundary with minimal DOM stand-ins. These checks model
# metadata changing between browser approval and the eventual read/write.
field_safety = r"""
const assert = require('node:assert/strict');
global.window = {};
global.document = {body: {}};
global.HTMLInputElement = function() {};
global.HTMLTextAreaElement = function() {};
Object.defineProperty(HTMLInputElement.prototype, 'value', {
  set(value) { this.value = value; }
});
global.InputEvent = function() {};
global.Event = function() {};
let active;
const __mbDeepActive = () => active;
const __mbEditable = () => true;
function field() {
  return {type: 'text', tagName: 'INPUT', isConnected: true, value: 'draft',
          autocomplete: '', getAttribute(name) { return this[name] || ''; },
          dispatchEvent() {}};
}
"""
field_safety += "const inspect = " + raw("kFieldInfoTemplate") + ";\n"
field_safety += "const read = " + raw("kFieldValueTemplate") + ";\n"
field_safety += "const write = " + raw("kFieldWriteTemplate") + ";\n"
field_safety += r"""
active = field(); inspect('one');
assert.equal(read('one'), 'draft');
assert.equal(write('one', 'edited'), true);
assert.equal(active.value, 'edited');
assert.equal(read('stale'), null);
assert.equal(write('stale', 'wrong'), false);
for (const change of [e => e.type = 'password',
                       e => e.autocomplete = 'section-login ONE-TIME-CODE',
                       e => e.autocomplete = 'cc-number',
                       e => e.readOnly = true,
                       e => e.disabled = true]) {
  active = field(); inspect('two'); change(active);
  assert.equal(read('two'), null);
  assert.notEqual(write('two', 'secret'), true);
  assert.equal(active.value, 'draft');
}
active = field(); inspect('old');
active = field(); inspect('new');
assert.equal(write('old', 'stale save'), false);
assert.equal(active.value, 'draft');
"""

failed = False
with tempfile.TemporaryDirectory() as d:
    for name, js in cases.items():
        path = pathlib.Path(d) / f"{name}.js"
        path.write_text(js)
        r = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        if r.returncode == 0:
            # Run it too, without a DOM: declaration errors surface at run
            # time, and a ReferenceError on `document` means we got past them.
            run = subprocess.run(["node", str(path)], capture_output=True, text=True)
            if "already been declared" in run.stderr or "SyntaxError" in run.stderr:
                r = run
        if r.returncode:
            failed = True
            print(f"{name}: syntax error\n{r.stderr}")
        else:
            print(f"{name}: ok")
r = subprocess.run(["node", "-e", field_safety], capture_output=True, text=True)
if r.returncode:
    failed = True
    print("field safety: FAILED\n" + r.stderr)
else:
    print("field safety: ok")
sys.exit(1 if failed else 0)
