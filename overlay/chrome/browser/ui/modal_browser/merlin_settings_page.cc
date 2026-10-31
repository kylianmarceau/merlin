// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_settings_page.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/no_destructor.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "base/version_info/version_info.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/prefs/session_startup_pref.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/ui/modal_browser/merlin_pages.h"
#include "chrome/browser/ui/modal_browser/merlin_url_rewrite.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/zoom/chrome_zoom_level_prefs.h"
#include "chrome/common/pref_names.h"
#include "components/password_manager/core/common/password_manager_pref_names.h"
#include "components/performance_manager/public/user_tuning/prefs.h"
#include "components/prefs/pref_service.h"
#include "components/search_engines/template_url.h"
#include "components/search_engines/template_url_service.h"
#include "components/search_engines/template_url_starter_pack_data.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_message_handler.h"
#include "content/public/browser/webui_config.h"
#include "content/public/common/url_constants.h"
#include "extensions/browser/disable_reason.h"
#include "extensions/browser/extension_registrar.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/browser/extension_system.h"
#include "extensions/browser/management_policy.h"
#include "extensions/common/extension.h"
#include "extensions/common/manifest.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "ui/base/page_transition_types.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/select_file_policy.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

constexpr int kZoomChoices[] = {50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200};

// Chromium pages Settings links to, for what Merlin does not reimplement.
const std::map<std::string, std::string>& Links() {
  static const base::NoDestructor<std::map<std::string, std::string>> links({
      {"site-permissions", "chrome://settings/content"},
      {"cookies", "chrome://settings/cookies"},
      {"security", "chrome://settings/security"},
      {"clear-data", "chrome://settings/clearBrowserData"},
      {"certificates", "chrome://certificate-manager/"},
      {"passwords", "chrome://password-manager/passwords"},
      {"password-checkup", "chrome://password-manager/checkup"},
      {"addresses", "chrome://settings/addresses"},
      {"payments", "chrome://settings/payments"},
      {"extensions", "chrome://extensions/"},
      {"extension-shortcuts", "chrome://extensions/shortcuts"},
      {"search-engines", "chrome://settings/searchEngines"},
      {"languages", "chrome://settings/languages"},
      {"fonts", "chrome://settings/fonts"},
      {"accessibility", "chrome://settings/accessibility"},
      {"system", "chrome://settings/system"},
      {"import", "chrome://settings/importData"},
      {"reset", "chrome://settings/reset"},
      {"profile", "chrome://settings/manageProfile"},
      {"version", "chrome://version/"},
      {"credits", "chrome://credits/"},
      {"history", "chrome://merlin-history/"},
      {"downloads", "chrome://merlin-downloads/"},
  });
  return *links;
}

constexpr char kIndexHtml[] = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>Settings</title>
<link rel="icon" href="icon.svg">
<link rel="stylesheet" href="merlin.css">
<link rel="stylesheet" href="settings.css">
<script src="merlin.js" defer></script>
<script src="settings.js" defer></script>
</head>
<body>
<div class="frame">
  <nav class="side" aria-label="Sections">
    <div class="brand">
      <span class="mark" aria-hidden="true"><svg width="26" height="26" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="46" fill="#F2ECE0"/><path d="M85.15 135.77L19.81 102.47A90 90 0 0 1 40.95 75.41L89.07 130.75ZM89.97 130.02L45.84 71.46A90 90 0 0 1 76.71 56.4L95.69 127.23ZM104.31 127.23L123.29 56.4A90 90 0 0 1 154.16 71.46L110.03 130.02ZM110.93 130.75L159.05 75.41A90 90 0 0 1 180.19 102.47L114.85 135.77ZM87.5 143.33A12.5 12.5 0 1 1 112.5 143.33A12.5 12.5 0 1 1 87.5 143.33Z" fill="#12352E"/><path d="M96.82 126.97L82.83 54.99A90 90 0 0 1 117.17 54.99L103.18 126.97Z" fill="#C4552D"/></svg></span>
      <span class="word">Settings</span>
    </div>
    <ol id="nav"></ol>
    <p class="hint">Search <kbd>s</kbd> · hints <kbd>f</kbd></p>
  </nav>
  <main class="content">
    <div class="top">
      <h1 id="title">Settings</h1>
      <span class="spacer"></span>
      <label class="search"><input id="q" type="search" placeholder="Search settings" aria-label="Search settings" spellcheck="false"><kbd>s</kbd></label>
    </div>
    <div id="sections"></div>
    <p id="nothing" class="empty" hidden>No setting matches.</p>
  </main>
</div>
</body>
</html>
)HTML";

constexpr char kSettingsCss[] = R"CSS(.frame { display: flex; min-height: 100vh; }
.side {
  width: 220px; flex-shrink: 0; padding: 40px 14px 24px 24px; position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column; gap: 18px;
}
.brand { display: flex; align-items: center; gap: 10px; padding-left: 6px; }
.word { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
#nav { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
#nav button {
  width: 100%; height: 32px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent;
  color: var(--text2); text-align: left; cursor: pointer; font-size: 13.5px;
}
#nav button:hover { background: var(--hover); color: var(--text); }
#nav button[aria-current="true"] { background: var(--kbd); color: var(--text); font-weight: 600; }
.hint { margin: auto 0 0; padding-left: 6px; font-size: 12px; color: var(--text3); }
.content { flex: 1; min-width: 0; max-width: 820px; padding: 40px 40px 120px 24px; }
section { scroll-margin-top: 24px; margin-bottom: 40px; }
section > h2 { font-size: 18px; color: var(--text); font-weight: 650; margin: 0 0 4px; letter-spacing: -0.01em; }
section > .lede { margin: 0 0 14px; color: var(--text2); font-size: 13px; }
h3 { margin: 22px 0 8px; font-size: 12.5px; font-weight: 600; color: var(--text2); }
.binds { max-height: 360px; overflow: auto; }
.bind { display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: center; min-height: 36px; padding: 4px 16px; border-top: 1px solid var(--hair); font-size: 13px; }
.bind:first-child { border-top: 0; }
.bind .keys { display: flex; flex-wrap: wrap; gap: 4px; }
.bind .cmd { color: var(--text3); font: 12px var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor {
  width: 100%; min-height: 280px; padding: 14px 16px; border: 0; border-radius: 0; resize: vertical;
  background: var(--sunk); color: var(--text); font: 12.5px/1.6 var(--mono); outline: 0; tab-size: 2;
}
.editor:focus { box-shadow: inset 0 0 0 2px var(--focus); }
.edit-bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--hair); }
.edit-bar .status { flex: 1; min-width: 0; font-size: 12.5px; color: var(--text2); }
.edit-bar .status.error { color: var(--danger); }
.path { font: 12px var(--mono); color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; direction: rtl; text-align: left; }
.about { display: flex; align-items: center; gap: 18px; padding: 22px 18px; }
.about .big { width: 56px; height: 56px; border-radius: 15px; }
.about .name { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.about .text { display: flex; flex-direction: column; gap: 2px; }
.ext-icon { width: 28px; height: 28px; border-radius: 7px; background: var(--kbd); display: flex; align-items: center; justify-content: center; font: 700 11px var(--mono); color: var(--text2); flex-shrink: 0; }
.chars { width: 220px; font-family: var(--mono); }
.hidden-by-search { display: none !important; }
@media (max-width: 820px) {
  .frame { display: block; }
  .side { position: static; width: auto; height: auto; padding: 24px 16px 0; }
  #nav { flex-direction: row; flex-wrap: wrap; }
  #nav button { width: auto; }
  .hint { display: none; }
  .content { padding: 24px 16px 80px; }
  .bind { grid-template-columns: 110px minmax(0, 1fr); }
  .bind .cmd { display: none; }
}
)CSS";

constexpr char kSettingsJs[] = R"JS('use strict';
// Merlin Settings. State comes from merlin_settings_page.cc; every change
// is sent back as a message and applied there.
(() => {
  const {$, el, row, linkRow, group, toggle, segmented, select, button, toast} = K;
  const SECTIONS = [
    ['appearance', 'Appearance'], ['keys', 'Keys'], ['browsing', 'Browsing'],
    ['workspaces', 'Workspaces'], ['privacy', 'Privacy'], ['passwords', 'Passwords and autofill'],
    ['extensions', 'Extensions'], ['about', 'About Merlin'],
  ];
  const MERLIN_ONLY = ['keys', 'browsing', 'workspaces', 'about'];
  let state = null;
  let config = {found: false, text: '', error: '', path: ''};

  const send = (name, ...args) => chrome.send(name, args);
  const open = (key) => send('openPage', key);

  function section(id, title, lede, ...children) {
    const s = el('section');
    s.id = id;
    s.append(el('h2', '', title));
    if (lede) s.append(el('p', 'lede', lede));
    s.append(...children);
    return s;
  }

  function sub(text) { return el('h3', '', text); }

  function appearance() {
    return section('appearance', 'Appearance', '',
      group(
        row('Theme', 'Merlin and pages that support it follow this.',
            segmented([[0, 'System'], [1, 'Light'], [2, 'Dark']], state.theme,
                      (v) => send('setTheme', v), 'Theme')),
        row('Tabs', 'A slim sidebar, or a row above the page.',
            segmented([['side', 'Sidebar'], ['top', 'On top']], state.tabs,
                      (v) => send('setTabs', v), 'Tabs')),
        row('Hide tabs', 'The page fills the window. \u2318S shows or hides them any time.',
            toggle(boolOption(config.text, 'hide_tabs') ?? false, (v) => {
              pendingToast = v ? 'Tabs are hidden: \u2318S shows them' : 'Tabs are shown';
              saveConfig(setOption(config.text, 'hide_tabs', String(v)));
            }, 'Hide tabs')),
        linkRow('Fonts and page size', 'Typefaces and minimum font size', () => open('fonts'))));
  }

  // The table a line opens ("options" for "[options]  # x"), or null.
  function tableOf(line) {
    const m = /^\[([^\]]+)\]\s*(#.*)?$/.exec(line.trim());
    return m ? m[1].trim() : null;
  }

  // A true/false option from [options] in the file's text, or null when
  // the file does not set it. Read from the file rather than the window,
  // which rereads it a moment after a save.
  function boolOption(text, name) {
    let table = '';
    for (const line of text.split('\n')) {
      const t = tableOf(line);
      if (t !== null) { table = t; continue; }
      const m = new RegExp('^' + name + '\\s*=\\s*(true|false)\\b').exec(line.trim());
      if (table === 'options' && m) return m[1] === 'true';
    }
    return null;
  }

  function setOption(text, name, literal) {
    const lines = text.split('\n');
    let table = '';
    let header = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      const opened = tableOf(t);
      if (opened !== null) { table = opened; if (table === 'options') header = i; continue; }
      if (table === 'options' && new RegExp('^' + name + '\\s*=').test(t)) {
        lines[i] = name + ' = ' + literal;
        return lines.join('\n');
      }
    }
    if (header >= 0) {
      lines.splice(header + 1, 0, name + ' = ' + literal);
      return lines.join('\n');
    }
    const base = text.replace(/\s*$/, '');
    return (base ? base + '\n\n' : '') + '[options]\n' + name + ' = ' + literal + '\n';
  }

  function keys() {
    const binds = el('div', 'group binds');
    for (const b of state.bindings) {
      const r = el('div', 'bind');
      const ks = el('span', 'keys');
      for (const k of b.keys.split('  ')) ks.append(el('kbd', '', k));
      r.append(ks, el('span', '', b.desc), el('span', 'cmd', ':' + b.command));
      binds.append(r);
    }
    const chars = el('input', 'field chars');
    chars.value = state.hintChars;
    chars.spellcheck = false;
    chars.setAttribute('aria-label', 'Hint characters');
    const applyChars = button('Apply', 'btn', () => {
      const v = chars.value.trim();
      if (!/^[\x21-\x7e]{2,64}$/.test(v) || v.includes('"') || v.includes('\\')) {
        toast('Use 2 to 64 letters, digits or symbols');
        return;
      }
      saveConfig(setOption(config.text, 'hint_chars', '"' + v + '"'));
    });
    const charRow = el('span', '');
    charRow.style.display = 'flex';
    charRow.style.gap = '8px';
    charRow.append(chars, applyChars);

    const editor = el('textarea', 'editor');
    editor.id = 'config';
    editor.spellcheck = false;
    editor.setAttribute('aria-label', 'Configuration file');
    editor.value = config.text;
    editor.placeholder = '[options]\nhint_chars = "asdfghjkl"';
    const status = el('span', 'status');
    status.id = 'config-status';
    showConfigStatus(status);
    const save = button('Save and reload', 'btn primary', () => saveConfig(editor.value));
    const revert = button('Revert', 'btn', () => { editor.value = config.text; showConfigStatus(status); });
    const bar = el('div', 'edit-bar');
    bar.append(status, revert, save);
    editor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveConfig(editor.value); }
      if (e.key === 'Escape') editor.blur();
    });
    const pathRow = row('Configuration file', 'Merlin reads it at startup and on :config-reload.',
                        el('span', 'path', '\u200e' + config.path + '\u200e'));
    const modal = boolOption(config.text, 'modal_browsing') ?? true;
    const modalRow = row('Modal browsing',
        'Modes, link hints and every binding below. Off, Merlin works like any other browser: keys go to the page.',
        toggle(modal, (v) => {
          pendingToast = v ? 'Modal browsing is on' : 'Modal browsing is off: keys go to the page';
          saveConfig(setOption(config.text, 'modal_browsing', String(v)));
        }, 'Modal browsing'));
    return section('keys', 'Keys', 'Every Normal-mode binding. Change them in the configuration file below.',
      group(modalRow),
      binds,
      sub('Link hints'),
      group(row('Hint characters', 'Letters used for the labels f shows, home row first.', charRow)),
      sub('Configuration'),
      group(pathRow, editor, bar));
  }

  function showConfigStatus(status) {
    if (!status) return;
    status.classList.toggle('error', !!config.error);
    status.textContent = config.error ? config.error
        : config.found ? 'Saved on disk. ⌘S saves.' : 'No file yet: saving creates it.';
  }

  // Shown instead of the generic confirmation after the next save.
  let pendingToast = '';

  function saveConfig(text) {
    send('saveConfig', text);
  }

  function browsing() {
    const engines = state.engines.map((e) => [e.id, e.name]);
    const zoom = state.zoomChoices.map((z) => [String(z), z + '%']);
    return section('browsing', 'Browsing', '',
      group(
        row('Search engine', 'Used by :open and the start page for anything that is not an address.',
            state.engineManaged ? el('span', 'faint', 'Set by your organization')
                : select(engines, state.engine, (v) => send('setEngine', v), 'Search engine')),
        linkRow('Manage search engines', 'Add sites and shortcuts', () => open('search-engines')),
        row('On startup', '',
            segmented([['start', 'Start page'], ['last', 'Continue where you left off']], state.startup,
                      (v) => send('setStartup', v), 'On startup')),
        row('Default page size', '',
            select(zoom, String(state.zoom), (v) => send('setZoom', Number(v)), 'Default page size'))),
      sub('Downloads'),
      group(
        row('Save files to', '', (() => {
          const w = el('span', '');
          w.style.display = 'flex'; w.style.alignItems = 'center'; w.style.gap = '10px';
          w.append(el('span', 'path', '\u200e' + state.downloadDir + '\u200e'), button('Change…', 'btn', () => send('chooseDownloadDir')));
          return w;
        })()),
        row('Ask where to save each file', '', toggle(state.askWhere, (v) => send('setAskWhere', v), 'Ask where to save'))),
      sub('Performance'),
      group(
        row('Memory Saver', 'Frees memory from tabs you have not used in a while; they reload when you return.',
            toggle(state.memorySaver, (v) => send('setMemorySaver', v), 'Memory Saver')),
        row('Energy Saver', 'Limits background activity and effects when the battery is at 20% or lower.',
            toggle(state.energySaver, (v) => send('setEnergySaver', v), 'Energy Saver'))),
      sub('More'),
      group(
        linkRow('Languages', 'Page languages and spell check', () => open('languages')),
        linkRow('Accessibility', 'Captions, focus highlight', () => open('accessibility')),
        linkRow('System', 'Hardware acceleration, proxy', () => open('system')),
        linkRow('Import bookmarks and settings', '', () => open('import')),
        linkRow('Reset settings', 'Restore the original settings', () => open('reset'))));
  }

  function workspaces(list) {
    const g = el('div', 'group');
    g.id = 'ws-list';
    if (!list || !list.length) {
      g.append(el('div', 'empty', 'No saved workspaces. :workspace save research saves this window.'));
    }
    for (const w of list || []) {
      const r = el('div', 'row item');
      r.append(K.tile(w.name));
      const t = el('div', 'text');
      t.append(el('span', 'title', w.name), el('span', 'sub', w.modified ? 'saved ' + K.day(w.modified).toLowerCase() : ''));
      const acts = el('span', 'acts');
      acts.style.opacity = '1';
      acts.append(button('Open', 'btn', () => send('openWorkspace', w.name)),
                  button('Delete', 'btn danger', () => {
                    if (confirm('Delete the workspace "' + w.name + '"?')) send('deleteWorkspace', w.name);
                  }));
      r.append(t, acts);
      g.append(r);
    }
    return g;
  }

  function privacy() {
    return section('privacy', 'Privacy', '',
      group(
        linkRow('Clear browsing data', 'History, cookies, cache', () => open('clear-data')),
        linkRow('Site permissions', 'Location, camera, notifications and more, per site', () => open('site-permissions')),
        linkRow('Cookies', 'Third-party cookies and site data', () => open('cookies')),
        linkRow('Security', 'Dangerous sites and downloads, secure DNS', () => open('security')),
        linkRow('Certificates', 'Manage trusted certificates', () => open('certificates'))),
      el('p', 'note', 'These pages keep their own safeguards; Merlin only restyles them.'));
  }

  function passwords() {
    return section('passwords', 'Passwords and autofill', '',
      group(
        row('Offer to save passwords', '', toggle(state.savePasswords, (v) => send('setSavePasswords', v), 'Offer to save passwords')),
        linkRow('Saved passwords', 'View, edit and export', () => open('passwords')),
        linkRow('Password checkup', 'Find weak and reused passwords', () => open('password-checkup')),
        linkRow('Addresses', '', () => open('addresses')),
        linkRow('Payment methods', '', () => open('payments'))));
  }

  function extensions() {
    const g = el('div', 'group');
    if (!state.extensions.length) g.append(el('div', 'empty', 'No extensions installed.'));
    for (const x of state.extensions) {
      const r = el('div', 'row');
      r.append(el('span', 'ext-icon', x.name.charAt(0).toUpperCase()));
      const t = el('div', 'text');
      t.append(el('span', 'label', x.name), el('span', 'desc ellipsis', x.description || ('Version ' + x.version)));
      r.append(t);
      r.append(x.canToggle ? toggle(x.enabled, (v) => send('setExtensionEnabled', x.id, v), 'Enable ' + x.name)
                           : el('span', 'faint', 'Required'));
      g.append(r);
    }
    return section('extensions', 'Extensions', '',
      g,
      group(
        linkRow('Manage extensions', 'Details, permissions, developer mode', () => open('extensions')),
        linkRow('Extension shortcuts', '', () => open('extension-shortcuts'))));
  }

  function about() {
    const head = el('div', 'about');
    const img = el('img', 'big');
    img.src = 'icon.svg';
    img.alt = '';
    const t = el('div', 'text');
    t.append(el('span', 'name', 'Merlin'), el('span', 'muted', 'Version ' + state.about.version + ' · ' + state.about.os));
    head.append(img, t);
    return section('about', 'About Merlin', '',
      group(head,
        linkRow('Build details', '', () => open('version'), 'merlin://version'),
        linkRow('Open-source licenses', 'Merlin is made possible by open-source software', () => open('credits')),
        linkRow('Profile name and picture', '', () => open('profile'))));
  }

  function renderNav(current) {
    const nav = $('nav');
    nav.replaceChildren();
    for (const [id, title] of SECTIONS) {
      const li = el('li');
      const b = el('button', '', title);
      b.type = 'button';
      b.dataset.id = id;
      b.setAttribute('aria-current', String(id === current));
      b.addEventListener('click', () => go(id, true));
      li.append(b);
      nav.append(li);
    }
  }

  function go(id, smooth) {
    const s = document.getElementById(id);
    if (!s) return;
    s.scrollIntoView({behavior: smooth ? 'smooth' : 'auto', block: 'start'});
    // The address may stay chrome://settings (Chromium keeps the typed URL
    // after the rewrite), so only names Chromium's Settings does not use go
    // in the path: a reload must come back here.
    history.replaceState(null, '', '/' + (MERLIN_ONLY.includes(id) ? id : ''));
    for (const b of $('nav').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.id === id));
  }

  function render() {
    const scroll = window.scrollY;
    const editing = $('config');
    const draft = editing && editing.value !== config.text && document.activeElement === editing ? editing.value : null;
    const s = $('sections');
    s.replaceChildren(appearance(), keys(), browsing(),
                      section('workspaces', 'Workspaces', 'Saved windows: tabs, splits and projects.', workspaces(lastWorkspaces)),
                      privacy(), passwords(), extensions(), about());
    if (draft !== null) $('config').value = draft;
    filter();
    window.scrollTo(0, scroll);
  }

  let lastWorkspaces = null;
  let first = true;

  function filter() {
    const q = $('q').value.trim().toLowerCase();
    let any = false;
    for (const sec of document.querySelectorAll('section')) {
      let secHit = !q || sec.querySelector('h2').textContent.toLowerCase().includes(q);
      for (const r of sec.querySelectorAll('.row, .bind')) {
        const hit = !q || secHit || r.textContent.toLowerCase().includes(q);
        r.classList.toggle('hidden-by-search', !hit);
        if (hit) secHit = true;
      }
      sec.classList.toggle('hidden-by-search', !secHit);
      for (const g of sec.querySelectorAll('.group')) {
        const rows = g.querySelectorAll('.row, .bind');
        g.classList.toggle('hidden-by-search', rows.length > 0 && [...rows].every((r) => r.classList.contains('hidden-by-search')));
      }
      for (const h of sec.querySelectorAll('h3')) h.classList.toggle('hidden-by-search', !!q);
      any = any || secHit;
    }
    $('nothing').hidden = any;
  }

  window.merlinPage = {
    render(data) {
      state = data;
      render();
      if (first) {
        first = false;
        let id = location.pathname.replace(/^\/+|\/+$/g, '');
        if (id === 'help') id = 'about';
        renderNav(SECTIONS.some(([s]) => s === id) ? id : 'appearance');
        if (id) go(id, false);
      }
    },
    config(c) {
      config = c;
      if (state) render();
    },
    workspaces(list) {
      lastWorkspaces = list;
      if (state) render();
    },
    saved(error) {
      const done = pendingToast;
      pendingToast = '';
      if (error) { toast(error); return; }
      toast(done || 'Saved. Merlin reloaded its configuration.');
    },
    message(text) { toast(text); },
  };

  // Highlight the section in view.
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const b of $('nav').querySelectorAll('button')) b.setAttribute('aria-current', String(b.dataset.id === e.target.id));
    }
  }, {rootMargin: '-20% 0px -70% 0px'});
  new MutationObserver(() => { seen.disconnect(); document.querySelectorAll('section').forEach((s) => seen.observe(s)); })
      .observe($('sections'), {childList: true});

  $('q').addEventListener('input', filter);
  K.key('s', () => $('q').focus());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) send('ready'); });
  send('ready');
})();
)JS";

constexpr MerlinPageFile kFiles[] = {
    {"index.html", kIndexHtml},
    {"settings.css", kSettingsCss},
    {"settings.js", kSettingsJs},
};

// Folder picker for "Save files to". Owned by the handler.
class FolderPicker : public ui::SelectFileDialog::Listener {
 public:
  explicit FolderPicker(base::OnceCallback<void(base::FilePath)> done)
      : done_(std::move(done)) {}
  ~FolderPicker() override {
    if (dialog_) {
      dialog_->ListenerDestroyed();
    }
  }

  void Show(content::WebContents* contents, const base::FilePath& start) {
    dialog_ = ui::SelectFileDialog::Create(this, nullptr);
    dialog_->SelectFile(ui::SelectFileDialog::SELECT_FOLDER,
                        u"Save downloads to", start, nullptr, 0,
                        base::FilePath::StringType(),
                        contents->GetTopLevelNativeWindow());
  }

  void FileSelected(const ui::SelectedFileInfo& file, int index) override {
    if (done_) {
      std::move(done_).Run(file.path());
    }
  }
  void FileSelectionCanceled() override {}

 private:
  scoped_refptr<ui::SelectFileDialog> dialog_;
  base::OnceCallback<void(base::FilePath)> done_;
};

class MerlinSettingsHandler : public content::WebUIMessageHandler {
 public:
  MerlinSettingsHandler() = default;
  MerlinSettingsHandler(const MerlinSettingsHandler&) = delete;
  MerlinSettingsHandler& operator=(const MerlinSettingsHandler&) = delete;
  ~MerlinSettingsHandler() override = default;

  void RegisterMessages() override {
    auto on = [this](const char* name,
                     void (MerlinSettingsHandler::*method)(
                         const base::ListValue&)) {
      web_ui()->RegisterMessageCallback(
          name, base::BindRepeating(method, base::Unretained(this)));
    };
    on("ready", &MerlinSettingsHandler::OnReady);
    on("setTheme", &MerlinSettingsHandler::OnSetTheme);
    on("setTabs", &MerlinSettingsHandler::OnSetTabs);
    on("setEngine", &MerlinSettingsHandler::OnSetEngine);
    on("setStartup", &MerlinSettingsHandler::OnSetStartup);
    on("setZoom", &MerlinSettingsHandler::OnSetZoom);
    on("chooseDownloadDir", &MerlinSettingsHandler::OnChooseDownloadDir);
    on("setAskWhere", &MerlinSettingsHandler::OnSetAskWhere);
    on("setMemorySaver", &MerlinSettingsHandler::OnSetMemorySaver);
    on("setEnergySaver", &MerlinSettingsHandler::OnSetEnergySaver);
    on("setSavePasswords", &MerlinSettingsHandler::OnSetSavePasswords);
    on("setExtensionEnabled", &MerlinSettingsHandler::OnSetExtensionEnabled);
    on("openWorkspace", &MerlinSettingsHandler::OnOpenWorkspace);
    on("deleteWorkspace", &MerlinSettingsHandler::OnDeleteWorkspace);
    on("saveConfig", &MerlinSettingsHandler::OnSaveConfig);
    on("openPage", &MerlinSettingsHandler::OnOpenPage);
  }

 private:
  Profile* profile() { return Profile::FromWebUI(web_ui()); }
  PrefService* prefs() { return profile()->GetPrefs(); }

  static const std::string* StringArg(const base::ListValue& args,
                                      size_t i = 0) {
    return args.size() > i && args[i].is_string() ? &args[i].GetString()
                                                  : nullptr;
  }
  static std::optional<bool> BoolArg(const base::ListValue& args,
                                     size_t i = 0) {
    return args.size() > i && args[i].is_bool()
               ? std::optional<bool>(args[i].GetBool())
               : std::nullopt;
  }

  void OnReady(const base::ListValue& args) {
    AllowJavascript();
    SendState();
    SendConfig();
    SendWorkspaces();
  }

  void SendState() {
    if (!IsJavascriptAllowed()) {
      return;
    }
    base::DictValue data;
    ModalBrowserController* controller = ControllerForWebUI(web_ui());

    ThemeService* theme = ThemeServiceFactory::GetForProfile(profile());
    data.Set("theme", theme ? static_cast<int>(theme->GetBrowserColorScheme())
                            : 0);
    data.Set("tabs",
             controller && !controller->TabsInSidebar() ? "top" : "side");

    base::ListValue bindings;
    if (controller) {
      for (const ModalInputRouter::Binding& b : controller->KeyBindings()) {
        base::DictValue item;
        item.Set("keys", b.keys);
        item.Set("command", b.command);
        item.Set("desc", b.description);
        bindings.Append(std::move(item));
      }
    }
    data.Set("bindings", std::move(bindings));
    data.Set("hintChars", controller ? controller->HintChars() : "");

    base::ListValue engines;
    std::string current_engine;
    bool managed = false;
    if (TemplateURLService* service =
            TemplateURLServiceFactory::GetForProfile(profile())) {
      if (!service->loaded()) {
        service->Load();
      }
      managed = service->is_default_search_managed();
      const TemplateURL* current = service->GetDefaultSearchProvider();
      for (TemplateURL* url : service->GetTemplateURLs()) {
        if (url != current && !service->CanMakeDefault(url)) {
          continue;
        }
        if (url->starter_pack_id() !=
                template_url_starter_pack_data::StarterPackId::kNone ||
            url->url().empty()) {
          continue;
        }
        base::DictValue item;
        item.Set("id", base::NumberToString(url->id()));
        item.Set("name", url->short_name());
        engines.Append(std::move(item));
        if (url == current) {
          current_engine = base::NumberToString(url->id());
        }
      }
    }
    data.Set("engines", std::move(engines));
    data.Set("engine", current_engine);
    data.Set("engineManaged", managed);

    const SessionStartupPref startup =
        SessionStartupPref::GetStartupPref(profile());
    data.Set("startup", startup.type == SessionStartupPref::LAST ||
                                startup.type == SessionStartupPref::LAST_AND_URLS
                            ? "last"
                            : "start");

    double level = 0;
    if (ChromeZoomLevelPrefs* zoom = profile()->GetZoomLevelPrefs()) {
      level = zoom->GetDefaultZoomLevelPref();
    }
    data.Set("zoom",
             static_cast<int>(std::lround(
                 blink::ZoomLevelToZoomFactor(level) * 100)));
    base::ListValue zoom_choices;
    for (int z : kZoomChoices) {
      zoom_choices.Append(z);
    }
    data.Set("zoomChoices", std::move(zoom_choices));

    data.Set("downloadDir",
             prefs()->GetFilePath(prefs::kDownloadDefaultDirectory)
                 .AsUTF8Unsafe());
    data.Set("askWhere", prefs()->GetBoolean(prefs::kPromptForDownload));
    // Memory and Energy Saver are machine-wide (local state).
    namespace tuning = performance_manager::user_tuning::prefs;
    PrefService* local = g_browser_process->local_state();
    data.Set("memorySaver",
             local && local->GetInteger(tuning::kMemorySaverModeState) ==
                          static_cast<int>(
                              tuning::MemorySaverModeState::kEnabled));
    data.Set("energySaver",
             local && local->GetInteger(tuning::kBatterySaverModeState) !=
                          static_cast<int>(
                              tuning::BatterySaverModeState::kDisabled));
    data.Set("savePasswords", prefs()->GetBoolean(
                                  password_manager::prefs::
                                      kCredentialsEnableService));
    data.Set("extensions", Extensions());

    base::DictValue about;
    about.Set("version", std::string(version_info::GetVersionNumber()));
    about.Set("os", std::string(version_info::GetOSType()));
    data.Set("about", std::move(about));
    CallJavascriptFunction("merlinPage.render", data);
  }

  base::ListValue Extensions() {
    base::ListValue list;
    auto* registry = extensions::ExtensionRegistry::Get(profile());
    auto* system = extensions::ExtensionSystem::Get(profile());
    if (!registry || !system) {
      return list;
    }
    extensions::ManagementPolicy* policy = system->management_policy();
    std::vector<scoped_refptr<const extensions::Extension>> all;
    for (const auto& ext : registry->GenerateInstalledExtensionsSet()) {
      if (!ext->is_extension() ||
          extensions::Manifest::IsComponentLocation(ext->location())) {
        continue;
      }
      all.push_back(ext);
    }
    std::sort(all.begin(), all.end(), [](const auto& a, const auto& b) {
      return a->name() < b->name();
    });
    for (const auto& ext : all) {
      base::DictValue item;
      item.Set("id", ext->id());
      item.Set("name", ext->name());
      item.Set("version", ext->VersionString());
      item.Set("enabled", registry->enabled_extensions().Contains(ext->id()));
      item.Set("canToggle", !policy ||
                                (policy->UserMayModifySettings(ext.get(),
                                                               nullptr) &&
                                 !policy->MustRemainEnabled(ext.get(),
                                                            nullptr)));
      list.Append(std::move(item));
    }
    return list;
  }

  void SendConfig() {
    config_file::Read(base::BindOnce(&MerlinSettingsHandler::OnConfigRead,
                                     weak_factory_.GetWeakPtr()));
  }

  void OnConfigRead(config_file::ReadResult result) {
    if (!IsJavascriptAllowed()) {
      return;
    }
    base::DictValue config;
    config.Set("found", result.found);
    config.Set("text", result.text);
    config.Set("error", result.error);
    config.Set("path", config_file::ConfigPath().AsUTF8Unsafe());
    CallJavascriptFunction("merlinPage.config", config);
  }

  void SendWorkspaces() {
    workspace_store::List(base::BindOnce(
        &MerlinSettingsHandler::OnWorkspacesListed,
        weak_factory_.GetWeakPtr()));
  }

  void OnWorkspacesListed(std::vector<workspace_store::Entry> entries) {
    if (!IsJavascriptAllowed()) {
      return;
    }
    std::sort(entries.begin(), entries.end(),
              [](const auto& a, const auto& b) {
                return a.modified > b.modified;
              });
    base::ListValue list;
    for (const workspace_store::Entry& e : entries) {
      base::DictValue item;
      item.Set("name", e.name);
      item.Set("modified", static_cast<double>(e.modified));
      list.Append(std::move(item));
    }
    CallJavascriptFunction("merlinPage.workspaces", list);
  }

  void Message(const std::string& text) {
    if (IsJavascriptAllowed() && !text.empty()) {
      CallJavascriptFunction("merlinPage.message", base::Value(text));
    }
  }

  void OnSetTheme(const base::ListValue& args) {
    if (args.empty() || !args[0].is_int()) {
      return;
    }
    const int value = args[0].GetInt();
    ThemeService* theme = ThemeServiceFactory::GetForProfile(profile());
    if (!theme || value < 0 || value > 2) {
      return;
    }
    theme->SetBrowserColorScheme(
        static_cast<ThemeService::BrowserColorScheme>(value));
  }

  void OnSetTabs(const base::ListValue& args) {
    const std::string* value = StringArg(args);
    ModalBrowserController* controller = ControllerForWebUI(web_ui());
    if (!value || !controller || (*value != "side" && *value != "top")) {
      return;
    }
    Message(controller->RunCommandLine("set tabs=" + *value));
  }

  void OnSetEngine(const base::ListValue& args) {
    const std::string* value = StringArg(args);
    int64_t id = 0;
    TemplateURLService* service =
        TemplateURLServiceFactory::GetForProfile(profile());
    if (!value || !service || !base::StringToInt64(*value, &id)) {
      return;
    }
    for (TemplateURL* url : service->GetTemplateURLs()) {
      if (url->id() == id && service->CanMakeDefault(url)) {
        service->SetUserSelectedDefaultSearchProvider(url);
        return;
      }
    }
  }

  void OnSetStartup(const base::ListValue& args) {
    const std::string* value = StringArg(args);
    if (!value || (*value != "last" && *value != "start")) {
      return;
    }
    SessionStartupPref pref = SessionStartupPref::GetStartupPref(profile());
    pref.type =
        *value == "last" ? SessionStartupPref::LAST : SessionStartupPref::DEFAULT;
    SessionStartupPref::SetStartupPref(profile(), pref);
  }

  void OnSetZoom(const base::ListValue& args) {
    if (args.empty() || !args[0].is_int()) {
      return;
    }
    const int percent = args[0].GetInt();
    if (std::find(std::begin(kZoomChoices), std::end(kZoomChoices), percent) ==
        std::end(kZoomChoices)) {
      return;
    }
    if (ChromeZoomLevelPrefs* zoom = profile()->GetZoomLevelPrefs()) {
      zoom->SetDefaultZoomLevelPref(
          blink::ZoomFactorToZoomLevel(percent / 100.0));
    }
  }

  void OnChooseDownloadDir(const base::ListValue& args) {
    picker_ = std::make_unique<FolderPicker>(base::BindOnce(
        &MerlinSettingsHandler::OnDownloadDirChosen,
        weak_factory_.GetWeakPtr()));
    picker_->Show(web_ui()->GetWebContents(),
                  prefs()->GetFilePath(prefs::kDownloadDefaultDirectory));
  }

  void OnDownloadDirChosen(base::FilePath path) {
    if (path.empty()) {
      return;
    }
    prefs()->SetFilePath(prefs::kDownloadDefaultDirectory, path);
    prefs()->SetFilePath(prefs::kSaveFileDefaultDirectory, path);
    SendState();
  }

  void OnSetAskWhere(const base::ListValue& args) {
    if (std::optional<bool> on = BoolArg(args)) {
      prefs()->SetBoolean(prefs::kPromptForDownload, *on);
    }
  }

  void OnSetMemorySaver(const base::ListValue& args) {
    namespace tuning = performance_manager::user_tuning::prefs;
    PrefService* local = g_browser_process->local_state();
    if (std::optional<bool> on = BoolArg(args); on && local) {
      local->SetInteger(
          tuning::kMemorySaverModeState,
          static_cast<int>(*on ? tuning::MemorySaverModeState::kEnabled
                               : tuning::MemorySaverModeState::kDisabled));
    }
  }

  void OnSetEnergySaver(const base::ListValue& args) {
    namespace tuning = performance_manager::user_tuning::prefs;
    if (std::optional<bool> on = BoolArg(args)) {
      // On means Chromium's default: when the battery is low.
      if (PrefService* local = g_browser_process->local_state()) {
        local->SetInteger(
            tuning::kBatterySaverModeState,
            static_cast<int>(
                *on ? tuning::BatterySaverModeState::kEnabledBelowThreshold
                    : tuning::BatterySaverModeState::kDisabled));
      }
    }
  }

  void OnSetSavePasswords(const base::ListValue& args) {
    if (std::optional<bool> on = BoolArg(args)) {
      prefs()->SetBoolean(password_manager::prefs::kCredentialsEnableService,
                          *on);
    }
  }

  void OnSetExtensionEnabled(const base::ListValue& args) {
    const std::string* id = StringArg(args, 0);
    std::optional<bool> on = BoolArg(args, 1);
    auto* registry = extensions::ExtensionRegistry::Get(profile());
    auto* system = extensions::ExtensionSystem::Get(profile());
    auto* registrar = extensions::ExtensionRegistrar::Get(profile());
    if (!id || !on || !registry || !system || !registrar) {
      return;
    }
    const extensions::Extension* ext = registry->GetInstalledExtension(*id);
    extensions::ManagementPolicy* policy = system->management_policy();
    if (!ext || (policy && (!policy->UserMayModifySettings(ext, nullptr) ||
                            policy->MustRemainEnabled(ext, nullptr)))) {
      return;
    }
    if (*on) {
      registrar->EnableExtension(*id);
    } else {
      registrar->DisableExtension(
          *id, {extensions::disable_reason::DISABLE_USER_ACTION});
    }
  }

  void OnOpenWorkspace(const base::ListValue& args) {
    const std::string* name = StringArg(args);
    ModalBrowserController* controller = ControllerForWebUI(web_ui());
    if (!name || !controller || name->empty() || name->size() > 64 ||
        name->find_first_of(" \t\r\n\"'") != std::string::npos) {
      return;
    }
    Message(controller->RunCommandLine("workspace open " + *name));
  }

  void OnDeleteWorkspace(const base::ListValue& args) {
    const std::string* name = StringArg(args);
    if (!name || name->empty() || name->size() > 64 ||
        name->find_first_of(" \t\r\n\"'/\\") != std::string::npos) {
      return;
    }
    workspace_store::Delete(
        *name, base::BindOnce(
                   [](base::WeakPtr<MerlinSettingsHandler> self, bool) {
                     if (self) {
                       self->SendWorkspaces();
                     }
                   },
                   weak_factory_.GetWeakPtr()));
  }

  void OnSaveConfig(const base::ListValue& args) {
    const std::string* text = StringArg(args);
    if (!text) {
      return;
    }
    config_file::Write(*text, base::BindOnce(
                                  &MerlinSettingsHandler::OnConfigWritten,
                                  weak_factory_.GetWeakPtr()));
  }

  void OnConfigWritten(std::string error) {
    if (error.empty()) {
      // Every window rereads it; errors show in each status bar, as with
      // :config-reload, and this one also confirms the reload.
      ModalBrowserController::ReloadConfigInAllWindows(
          ControllerForWebUI(web_ui()));
    }
    if (IsJavascriptAllowed()) {
      CallJavascriptFunction("merlinPage.saved", base::Value(error));
    }
    SendConfig();
    SendState();
  }

  void OnOpenPage(const base::ListValue& args) {
    const std::string* key = StringArg(args);
    if (!key) {
      return;
    }
    const std::string target = MerlinSettingsUI::LinkTarget(*key);
    if (target.empty()) {
      return;
    }
    web_ui()->GetWebContents()->GetController().LoadURL(
        GURL(target), content::Referrer(), ui::PAGE_TRANSITION_LINK,
        std::string());
  }

  std::unique_ptr<FolderPicker> picker_;
  base::WeakPtrFactory<MerlinSettingsHandler> weak_factory_{this};
};

class MerlinSettingsUIConfig
    : public content::DefaultWebUIConfig<MerlinSettingsUI> {
 public:
  MerlinSettingsUIConfig()
      : DefaultWebUIConfig(content::kChromeUIScheme, kMerlinSettingsHost) {}
};

}  // namespace

// static
std::string MerlinSettingsUI::LinkTarget(const std::string& key) {
  auto it = Links().find(key);
  return it == Links().end() ? std::string() : it->second;
}

MerlinSettingsUI::MerlinSettingsUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  AddMerlinPageSource(web_ui, kMerlinSettingsHost, kFiles);
  web_ui->AddMessageHandler(std::make_unique<MerlinSettingsHandler>());
}

MerlinSettingsUI::~MerlinSettingsUI() = default;

WEB_UI_CONTROLLER_TYPE_IMPL(MerlinSettingsUI)

std::unique_ptr<content::WebUIConfig> MakeMerlinSettingsConfig() {
  return std::make_unique<MerlinSettingsUIConfig>();
}

}  // namespace modal_browser
