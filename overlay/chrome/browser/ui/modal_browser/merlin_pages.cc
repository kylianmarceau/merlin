// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_pages.h"

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/ref_counted_memory.h"
#include "base/no_destructor.h"
#include "chrome/browser/ui/modal_browser/merlin_library_pages.h"
#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"
#include "chrome/browser/ui/modal_browser/merlin_settings_page.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "content/public/browser/webui_config.h"
#include "content/public/browser/webui_config_map.h"

namespace modal_browser {

namespace {

// Tokens follow the start page (merlin_start_page.cc): warm paper and
// charcoal, one yellow accent, hairlines instead of boxes.
constexpr char kSharedCss[] = R"CSS(* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 var(--font);
  -webkit-font-smoothing: antialiased;
}
[hidden] { display: none !important; }
kbd {
  font: 500 11px var(--mono);
  background: var(--kbd);
  color: var(--text);
  border-radius: 4px;
  padding: 1px 5px;
}
a { color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 6px; }
.mono { font-family: var(--mono); font-size: 12px; }
.muted { color: var(--text2); }
.faint { color: var(--text3); }

/* Page frame: brand, title, search. */
.page { max-width: 920px; margin: 0 auto; padding: 48px 32px 64px; }
.top { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
.mark {
  width: 26px; height: 26px; flex-shrink: 0; display: flex;
}
h1 { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 650; letter-spacing: -0.02em; }
.spacer { flex: 1; }
.search {
  display: flex; align-items: center; gap: 10px; width: 300px; max-width: 45vw; height: 38px;
  padding: 0 12px; border-radius: 11px; background: var(--panel); box-shadow: var(--shadow);
}
.search:focus-within { box-shadow: 0 0 0 2px var(--focus), var(--shadow); }
.search input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text);
  font: inherit;
}
.search input::placeholder { color: var(--text3); }
.search kbd { flex-shrink: 0; }

/* Groups of rows. */
h2 { margin: 32px 0 10px; font-size: 13px; font-weight: 600; color: var(--text2); }
h2:first-child { margin-top: 0; }
.group { background: var(--panel); border-radius: var(--card-radius); box-shadow: var(--shadow); overflow: hidden; }
.row {
  display: flex; align-items: center; gap: 14px; min-height: 52px; padding: 10px 16px;
  border-top: 1px solid var(--hair);
}
.row:first-child { border-top: 0; }
.row.link { cursor: pointer; }
.row.link:hover, .row.item:hover { background: var(--hover); }
.row .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.row .label { font-weight: 500; }
.row .desc { color: var(--text2); font-size: 12.5px; }
.row .chev { color: var(--text3); font-size: 16px; }
.ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note { margin: 10px 4px 0; color: var(--text3); font-size: 12.5px; }
.empty { padding: 28px 16px; text-align: center; color: var(--text3); }

/* Controls. */
button, select, input, textarea { font: inherit; color: inherit; }
.btn {
  height: 30px; padding: 0 12px; border-radius: var(--control-radius); border: 0; cursor: pointer;
  background: var(--kbd); color: var(--text); font-size: 13px; font-weight: 500; white-space: nowrap;
}
.btn:hover { background: color-mix(in srgb, var(--text) 10%, transparent); }
.btn.primary { background: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: #EDC93A; }
.btn.danger { color: var(--danger); }
.btn:disabled { opacity: 0.5; cursor: default; }
.icon-btn {
  width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; cursor: pointer;
  color: var(--text2); font-size: 15px; display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: var(--kbd); color: var(--text); }
select {
  height: 30px; padding: 0 28px 0 10px; border-radius: var(--control-radius); border: 0; background: var(--kbd);
  appearance: none; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--text2) 50%), linear-gradient(135deg, var(--text2) 50%, transparent 50%);
  background-position: calc(100% - 14px) 13px, calc(100% - 10px) 13px;
  background-size: 4px 4px, 4px 4px; background-repeat: no-repeat;
}
.field {
  height: 30px; padding: 0 10px; border-radius: var(--control-radius); border: 0; background: var(--kbd); outline: 0;
}
.field:focus { box-shadow: 0 0 0 2px var(--focus); }
.seg { display: inline-flex; padding: 2px; border-radius: 9px; background: var(--kbd); }
.seg button {
  height: 26px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent;
  color: var(--text2); cursor: pointer; font-size: 13px;
}
.seg button[aria-checked="true"] {
  background: var(--panel); color: var(--text); font-weight: 600;
  box-shadow: 0 1px 2px rgba(40, 30, 10, 0.16);
}
.switch {
  position: relative; width: 38px; height: 22px; flex-shrink: 0; border: 0; border-radius: 11px;
  background: color-mix(in srgb, var(--text) 18%, transparent); cursor: pointer; padding: 0;
  transition: background 120ms;
}
.switch::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #FFFFFF; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); transition: transform 120ms;
}
.switch[aria-checked="true"] { background: var(--accent); }
.switch[aria-checked="true"]::after { transform: translateX(16px); background: var(--on-accent); }

/* List items: history, downloads, bookmarks. */
.tile {
  width: 22px; height: 22px; flex-shrink: 0; border-radius: 6px; color: #FFFFFF;
  font: 700 10.5px var(--mono); display: flex; align-items: center; justify-content: center;
}
.row.item { min-height: 46px; padding: 6px 10px 6px 14px; }
.row.item.selected { background: var(--select); }
.row.item .title { font-size: 14px; }
.row.item .sub { color: var(--text3); font-size: 12px; }
.row.item .acts { display: flex; gap: 2px; opacity: 0; }
.row.item:hover .acts, .row.item:focus-within .acts { opacity: 1; }
.when { font: 12px var(--mono); color: var(--text3); white-space: nowrap; }
.bar { height: 3px; border-radius: 2px; background: var(--kbd); overflow: hidden; margin-top: 5px; }
.bar > span { display: block; height: 100%; background: var(--accent); }
.badge {
  font: 600 10.5px var(--mono); padding: 2px 6px; border-radius: 5px; background: var(--kbd);
  color: var(--text2); text-transform: uppercase; letter-spacing: 0.04em;
}
.badge.warn { background: color-mix(in srgb, var(--danger) 16%, transparent); color: var(--danger); }
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 8px 14px;
  border-radius: 10px; background: var(--text); color: var(--bg); font-size: 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
}
.foot { margin-top: 28px; color: var(--text3); font-size: 12.5px; }
@media (max-width: 700px) {
  .page { padding: 28px 16px 48px; }
  .top { flex-wrap: wrap; }
  .search { width: 100%; max-width: none; }
}
)CSS";

constexpr char kSharedJs[] = R"JS('use strict';
// Shared by Merlin's pages (merlin_pages.cc). No framework: small DOM
// helpers, controls that report changes, and page keys.
window.K = (() => {
  const $ = (id) => document.getElementById(id);
  const TILE_COLORS = ['#B5523B', '#3A5FA8', '#2E2E2E', '#4E6B4A', '#6B4A5A', '#2F4A7A', '#7A6000'];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function hash(s) {
    let h = 0;
    for (const ch of s || '') h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h;
  }

  function domain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  // A letter tile in a color picked from the site, as on the start page.
  function tile(key) {
    const t = el('span', 'tile', (key || '?').replace(/^www\./, '').charAt(0).toUpperCase());
    t.style.background = TILE_COLORS[hash(key) % TILE_COLORS.length];
    t.setAttribute('aria-hidden', 'true');
    return t;
  }

  function button(text, cls, onClick, title) {
    const b = el('button', cls || 'btn', text);
    b.type = 'button';
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return b;
  }

  function toggle(on, onChange, label) {
    const b = el('button', 'switch');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!on));
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      const next = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return b;
  }

  function segmented(options, current, onChange, label) {
    const g = el('div', 'seg');
    g.setAttribute('role', 'radiogroup');
    if (label) g.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const b = el('button', '', text);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(value === current));
      b.addEventListener('click', () => {
        for (const o of g.children) o.setAttribute('aria-checked', String(o === b));
        onChange(value);
      });
      g.append(b);
    }
    return g;
  }

  function select(options, current, onChange, label) {
    const s = el('select');
    if (label) s.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const o = el('option', '', text);
      o.value = value;
      o.selected = value === current;
      s.append(o);
    }
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  // A settings row: label and description on the left, `control` right.
  function row(label, desc, control) {
    const r = el('div', 'row');
    const t = el('div', 'text');
    t.append(el('span', 'label', label));
    if (desc) t.append(el('span', 'desc', desc));
    r.append(t);
    if (control) r.append(control);
    return r;
  }

  // A row that opens something.
  function linkRow(label, desc, onOpen, aside) {
    const r = row(label, desc, null);
    r.classList.add('link');
    r.tabIndex = 0;
    r.setAttribute('role', 'link');
    if (aside) r.append(el('span', 'faint mono', aside));
    r.append(el('span', 'chev', '›'));
    r.addEventListener('click', onOpen);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter') onOpen(); });
    return r;
  }

  function group(...rows) {
    const g = el('div', 'group');
    g.append(...rows);
    return g;
  }

  let toastTimer = 0;
  function toast(text) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', 'toast'); t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function when(seconds) {
    if (!seconds) return '';
    const then = new Date(seconds * 1000);
    return then.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
  }

  function day(seconds) {
    const then = new Date(seconds * 1000);
    const now = new Date();
    const days = Math.round((new Date(now.toDateString()) - new Date(then.toDateString())) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return then.toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long'});
  }

  function size(bytes) {
    if (!(bytes > 0)) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = bytes;
    while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
    return (v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
  }

  // Page keys. Merlin passes keys it does not bind to the page in Normal
  // mode; these only act while nothing on the page is being typed into.
  const keys = new Map();
  function key(letter, fn) { keys.set(letter, fn); }
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === 'Escape' && typing && t.tagName !== 'TEXTAREA') { t.blur(); return; }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || typing) return;
    const fn = keys.get(e.key);
    if (fn) { e.preventDefault(); fn(e); }
  });

  function debounce(fn, ms) {
    let id = 0;
    return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  }

  return {$, el, tile, domain, button, toggle, segmented, select, row, linkRow, group,
          toast, when, day, size, key, debounce};
})();
)JS";

}  // namespace

const char* MerlinSharedFile(const std::string& path) {
  if (path == "merlin-tokens.css") {
    return design::kPageTokensCss;
  }
  if (path == "start-tokens.css") {
    return design::kStartTokensCss;
  }
  if (path == "merlin.css") {
    static const base::NoDestructor<std::string> css(
        std::string(design::kPageTokensCss) + kSharedCss);
    return css->c_str();
  }
  if (path == "merlin.js") {
    return kSharedJs;
  }
  if (path == "icon.svg") {
    return design::kProductIconSvg;
  }
  return nullptr;
}

namespace {

const char* LookupFile(const std::vector<MerlinPageFile>& files,
                       const std::string& path) {
  if (const char* shared = MerlinSharedFile(path)) {
    return shared;
  }
  for (const MerlinPageFile& f : files) {
    if (path == f.path) {
      return f.content;
    }
  }
  // Section paths (chrome://merlin-settings/keys) serve the page; the query
  // is not part of `path` matching.
  const std::string bare = path.substr(0, path.find_first_of("?#"));
  if (bare.find('.') == std::string::npos) {
    return files.front().content;
  }
  return nullptr;
}

}  // namespace

void AddMerlinPageSource(content::WebUI* web_ui,
                          std::string_view host,
                          base::span<const MerlinPageFile> files) {
  CHECK(!files.empty());
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      web_ui->GetWebContents()->GetBrowserContext(), std::string(host));
  // Page files are copied into the callbacks: they point at static strings.
  std::vector<MerlinPageFile> own(files.begin(), files.end());
  source->SetRequestFilter(
      base::BindRepeating(
          [](const std::vector<MerlinPageFile>& files,
             const std::string& path) {
            return LookupFile(files, path) != nullptr;
          },
          own),
      base::BindRepeating(
          [](const std::vector<MerlinPageFile>& files, const std::string& path,
             content::WebUIDataSource::GotDataCallback callback) {
            std::move(callback).Run(
                base::MakeRefCounted<base::RefCountedString>(
                    std::string(LookupFile(files, path))));
          },
          own));
}

ModalBrowserController* ControllerForWebUI(content::WebUI* web_ui) {
  tabs::TabInterface* tab =
      tabs::TabInterface::MaybeGetFromContents(web_ui->GetWebContents());
  return tab ? ModalBrowserController::From(tab->GetBrowserWindowInterface())
             : nullptr;
}

void InstallMerlinPages() {
  static bool installed = false;
  if (installed) {
    return;
  }
  installed = true;
  content::WebUIConfigMap& map = content::WebUIConfigMap::GetInstance();
  map.AddWebUIConfig(MakeMerlinSettingsConfig());
  map.AddWebUIConfig(MakeMerlinHistoryConfig());
  map.AddWebUIConfig(MakeMerlinDownloadsConfig());
  map.AddWebUIConfig(MakeMerlinBookmarksConfig());
}

}  // namespace modal_browser
