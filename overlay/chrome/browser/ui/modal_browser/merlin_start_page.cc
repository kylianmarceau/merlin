// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_start_page.h"

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/memory/ref_counted_memory.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/sessions/tab_restore_service_factory.h"
#include "chrome/browser/ui/browser_live_tab_context.h"
#include "chrome/browser/ui/modal_browser/merlin_pages.h"
#include "chrome/browser/ui/modal_browser/merlin_suggestions.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/webui/favicon_source.h"
#include "components/favicon_base/favicon_url_parser.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/sessions/core/tab_restore_service.h"
#include "components/sessions/core/tab_restore_types.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/page_navigator.h"
#include "content/public/browser/url_data_source.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_data_source.h"
#include "content/public/browser/web_ui_message_handler.h"
#include "content/public/browser/webui_config.h"
#include "content/public/browser/webui_config_map.h"
#include "content/public/common/url_constants.h"
#include "content/public/common/referrer.h"
#include "services/network/public/mojom/content_security_policy.mojom.h"
#include "ui/base/window_open_disposition.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

// Labels for the page's items: letters Merlin leaves unbound in Normal mode
// (core/src/keymap.rs), so they reach the page. Kept in step with start.js.
constexpr size_t kMaxWorkspaces = 3;
constexpr size_t kMaxRecent = 3;
constexpr size_t kMaxInput = 2048;

// -- The page --------------------------------------------------------------

constexpr char kIndexHtml[] = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>Start</title>
<link rel="icon" href="icon.svg">
<link rel="stylesheet" href="merlin-tokens.css">
<link rel="stylesheet" href="start-tokens.css">
<link rel="stylesheet" href="start.css">
<script src="start.js" defer></script>
</head>
<body>
<main class="start">
  <header class="brand">
    <img class="mark" src="icon.svg" alt="" aria-hidden="true">
    <span>Merlin</span>
  </header>

  <div class="omni">
    <form id="go" class="field" autocomplete="off">
      <span class="prompt" aria-hidden="true">:</span>
      <input id="q" aria-label="Search or enter address" placeholder="Search or enter address" spellcheck="false"
             role="combobox" aria-autocomplete="both" aria-expanded="false" aria-controls="sug">
    </form>
    <ol id="sug" class="sug" role="listbox" aria-label="Suggestions" hidden></ol>
  </div>
  <p id="error" class="error" role="alert" hidden></p>

  <div id="cols" class="cols" hidden>
    <section id="ws-sec" aria-labelledby="ws-h" hidden>
      <h2 id="ws-h">Workspaces</h2>
      <ol id="ws" class="list"></ol>
    </section>
    <section id="rc-sec" aria-labelledby="rc-h" hidden>
      <h2 id="rc-h">Recently closed</h2>
      <ol id="rc" class="list"></ol>
    </section>
  </div>
</main>
</body>
</html>
)HTML";

constexpr char kStartCss[] = R"CSS(html, body {
  margin: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 var(--font);
  -webkit-font-smoothing: antialiased;
}
.start {
  max-width: 600px;
  margin: 0 auto;
  padding: 16vh 24px 48px;
}
.brand {
  display: flex; align-items: center; gap: 9px;
  margin-bottom: 22px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em;
}
.mark { width: 20px; height: 20px; flex-shrink: 0; }
.field {
  display: flex; align-items: center; gap: 12px; height: 50px;
  padding: 0 16px; box-sizing: border-box; border-radius: 12px;
  background: var(--field); box-shadow: 0 0 0 1px var(--hair);
}
.field:focus-within { box-shadow: 0 0 0 1px var(--hair-strong); }
.prompt { font: 500 16px var(--mono); color: var(--text3); }
#q {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; caret-color: var(--caret);
  font: 400 15.5px var(--font); color: var(--text);
}
#q::placeholder { color: var(--text3); }
.omni { position: relative; }
.sug {
  position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 2;
  list-style: none; margin: 0; padding: 6px; border-radius: 12px;
  background: var(--field); box-shadow: 0 0 0 1px var(--hair), var(--shadow);
}
.sug-row {
  display: flex; align-items: center; gap: 11px; height: 36px; padding: 0 10px;
  border-radius: 8px; cursor: pointer; font-size: 14px; color: var(--text);
}
.sug-row:hover { background: var(--hover); }
.sug-row[aria-selected="true"] { background: var(--selected); }
.sug-icon { width: 16px; height: 16px; flex-shrink: 0; color: var(--text3); }
.sug-title { flex: 0 1 auto; min-width: 0; max-width: 65%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sug-detail { flex: 1 1 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text3); }
.sug-hint { flex-shrink: 0; margin-left: auto; font-size: 12px; color: var(--text3); }
.error { margin: 10px 2px 0; color: var(--error); font-size: 13px; }
.cols { margin-top: 36px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 40px; }
@media (max-width: 560px) { .cols { grid-template-columns: minmax(0, 1fr); gap: 28px; } }
h2 { margin: 0 0 8px; font-size: 12px; font-weight: 500; color: var(--text3); }
.list { list-style: none; margin: 0 -8px; padding: 0; }
.row {
  width: 100%; height: 30px; display: flex; align-items: center; gap: 10px; padding: 0 8px;
  border: 0; border-radius: 6px; background: transparent; color: var(--text);
  text-align: left; cursor: pointer; font: inherit; font-size: 13.5px;
}
.row:hover { background: var(--hover); }
.row:focus-visible { outline: 2px solid var(--caret); outline-offset: -2px; }
.label {
  min-width: 17px; height: 17px; box-sizing: border-box; padding: 0 4px; border-radius: 4px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #F6D44A; color: #1A1A1A; font: 700 10.5px/1 var(--mono);
}
.name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.when { font-size: 12px; color: var(--text3); flex-shrink: 0; }
)CSS";

constexpr char kStartJs[] = R"JS('use strict';
// Merlin start page. Data comes from the browser (merlin_start_page.cc);
// everything the user picks goes back as a message and runs through the
// window's command registry.
(() => {
  const WORKSPACE_LABELS = ['a', 's', 'w'];
  const RECENT_LABELS = ['e', 'c', 'x'];
  const actions = new Map();
  const $ = (id) => document.getElementById(id);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function when(seconds) {
    if (!seconds) return '';
    const then = new Date(seconds * 1000);
    const now = new Date();
    const days = Math.floor((new Date(now.toDateString()) - new Date(then.toDateString())) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return then.toLocaleDateString(undefined, {weekday: 'short'});
    return then.toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
  }

  function row(label, title, onActivate, extra) {
    const li = el('li');
    const b = el('button', 'row');
    b.type = 'button';
    b.title = title;
    b.append(el('kbd', 'label', label), el('span', 'name', title));
    if (extra) b.append(extra);
    b.addEventListener('click', onActivate);
    li.append(b);
    actions.set(label, onActivate);
    return li;
  }

  function fill(listId, sectionId, items, makeRow) {
    $(listId).replaceChildren(...items.map(makeRow));
    $(sectionId).hidden = items.length === 0;
    return items.length > 0;
  }

  window.merlinStart = {
    render(data) {
      actions.clear();
      const ws = (data.workspaces || []).slice(0, WORKSPACE_LABELS.length);
      const rc = (data.recent || []).slice(0, RECENT_LABELS.length);
      const any = [
        fill('ws', 'ws-sec', ws, (w, i) => row(WORKSPACE_LABELS[i], w.name,
            () => chrome.send('openWorkspace', [w.name]), el('span', 'when', when(w.modified)))),
        fill('rc', 'rc-sec', rc, (r, i) => row(RECENT_LABELS[i], r.title || r.domain || r.url,
            () => chrome.send('reopen', [r.id]))),
      ].some(Boolean);
      $('cols').hidden = !any;
    },
    error(message) {
      const p = $('error');
      p.textContent = message;
      p.hidden = !message;
    },
    // The browser gave this tab keyboard focus; put the cursor in the field.
    focusField() {
      $('q').focus();
      $('q').select();
    },
    // Rows for query `id`; later calls for the same id add search
    // suggestions, which arrive after the local ones.
    suggestions(id, items) {
      showSuggestions(id, items);
    },
  };

  // -- Suggestions -----------------------------------------------------------
  // The browser answers each query with Chromium's address-bar suggestions
  // (merlin_suggestions.cc). Enter opens the highlighted row; with no rows
  // for what is in the field yet, the text is opened like `:open`.
  const q = $('q');
  const sug = $('sug');
  let queryId = 0;   // the latest query sent
  let shownId = -1;  // the query the rows on screen answer
  let rows = [];
  let selected = -1;
  let moved = false;     // the user picked a row with the arrows
  let typed = '';        // the field's text without the inline completion
  let deleting = false;  // the last edit removed text

  // Built with DOM calls: WebUI pages enforce Trusted Types, which rejects
  // HTML strings.
  function searchIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const attrs = {class: 'sug-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none',
                   stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round'};
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', '7');
    circle.setAttribute('cy', '7');
    circle.setAttribute('r', '4.5');
    const handle = document.createElementNS(NS, 'path');
    handle.setAttribute('d', 'M10.5 10.5L14 14');
    svg.append(circle, handle);
    return svg;
  }

  function favicon(url) {
    const img = el('img', 'sug-icon');
    img.alt = '';
    img.src = 'chrome://favicon2/?size=16&scaleFactor=2x&allowGoogleServerFallback=0&pageUrl=' +
        encodeURIComponent(url);
    return img;
  }

  function hideSuggestions() {
    sug.hidden = true;
    sug.replaceChildren();
    rows = [];
    selected = -1;
    shownId = -1;
    q.setAttribute('aria-expanded', 'false');
    q.removeAttribute('aria-activedescendant');
  }

  function select(i) {
    selected = i;
    sug.querySelectorAll('.sug-row').forEach((r, n) => r.setAttribute('aria-selected', String(n === i)));
    if (i >= 0) q.setAttribute('aria-activedescendant', 'sug-' + i);
    else q.removeAttribute('aria-activedescendant');
  }

  function openRow(i) {
    if (i < 0 || i >= rows.length || shownId !== queryId) return false;
    chrome.send('openSuggestion', [shownId, i]);
    hideSuggestions();
    return true;
  }

  function query() {
    typed = q.value;
    moved = false;
    const text = typed.trim();
    if (!text || text.startsWith(':')) {
      chrome.send('stopSuggest');
      hideSuggestions();
      return;
    }
    queryId++;
    chrome.send('suggest', [typed, queryId, deleting]);
  }

  function showSuggestions(id, items) {
    if (id !== queryId || document.activeElement !== q) return;
    shownId = id;
    rows = items;
    sug.replaceChildren(...items.map((s, i) => {
      const li = el('li', 'sug-row');
      li.id = 'sug-' + i;
      li.setAttribute('role', 'option');
      li.append(s.kind === 'search' ? searchIcon() : favicon(s.url));
      li.append(el('span', 'sug-title', s.title));
      if (s.detail && s.detail !== s.title) li.append(el('span', 'sug-detail', '\u2014 ' + s.detail));
      if (s.kind === 'tab') li.append(el('span', 'sug-hint', 'Switch to tab'));
      // Keep focus in the field while clicking.
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => openRow(i));
      return li;
    }));
    sug.hidden = items.length === 0;
    q.setAttribute('aria-expanded', String(items.length > 0));
    select(items.length ? (moved ? Math.min(Math.max(selected, 0), items.length - 1) : 0) : -1);
    // Complete the field to the first row ("youtu" -> "youtube.com"), with
    // the added part selected so typing replaces it.
    const inline = !moved && !deleting && items.length ? items[0].inline || '' : '';
    if (!moved && q.selectionEnd === q.value.length && q.value.startsWith(typed)) {
      q.value = typed + inline;
      q.setSelectionRange(typed.length, q.value.length);
    }
  }

  q.addEventListener('input', (e) => {
    deleting = (e.inputType || '').startsWith('delete');
    window.merlinStart.error('');
    query();
  });
  q.addEventListener('keydown', (e) => {
    if (e.isComposing || sug.hidden || !rows.length) return;
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if (!down && !up) return;
    e.preventDefault();
    if (!moved && q.value !== typed) q.value = typed;  // drop the completion
    moved = true;
    select((selected + (down ? 1 : rows.length - 1)) % rows.length);
  });
  q.addEventListener('blur', () => {
    chrome.send('stopSuggest');
    hideSuggestions();
  });
  q.addEventListener('focus', () => { if (q.value.trim()) query(); });

  $('go').addEventListener('submit', (e) => {
    e.preventDefault();
    if (openRow(selected)) return;
    const text = q.value.trim();
    if (text) chrome.send('go', [text]);
  });

  // Labels work while nothing on the page is being typed into (Esc leaves
  // the field). In Normal mode Merlin passes these unbound keys to the page.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.isContentEditable)) return;
    const act = actions.get(e.key);
    if (act) {
      e.preventDefault();
      act();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) chrome.send('ready');
  });
  chrome.send('ready');
  // Only on load: a new tab starts in the field, a tab you come back to
  // keeps its focus.
  chrome.send('focusField');
})();
)JS";

// -- The browser side ----------------------------------------------------------

std::string DomainOf(const GURL& url) {
  std::string host(url.host());
  if (base::StartsWith(host, "www.")) {
    host = host.substr(4);
  }
  return host;
}

// One saved workspace, summarized for the page from its file (format in
// core/src/workspace.rs). Unreadable files are skipped.
std::optional<base::DictValue> SummarizeWorkspace(const std::string& name,
                                                  const std::string& text) {
  std::optional<base::Value> parsed =
      base::JSONReader::Read(text, base::JSON_PARSE_CHROMIUM_EXTENSIONS);
  if (!parsed || !parsed->is_dict()) {
    return std::nullopt;
  }
  const base::DictValue& file = parsed->GetDict();
  const base::ListValue* tabs = file.FindList("tabs");
  const base::ListValue* splits = file.FindList("splits");
  const std::string* project = file.FindString("project");
  std::optional<double> saved = file.FindDouble("saved");
  const size_t tab_count = tabs ? tabs->size() : 0;
  size_t pinned = 0;
  if (tabs) {
    for (const base::Value& tab : *tabs) {
      if (tab.is_dict() && tab.GetDict().FindBool("pinned").value_or(false)) {
        ++pinned;
      }
    }
  }
  const bool split = splits && !splits->empty();

  std::string summary;
  if (project && !project->empty()) {
    summary = *project;
  } else {
    summary = base::NumberToString(tab_count) +
              (tab_count == 1 ? " tab" : " tabs");
    if (split) {
      summary += " · split view";
    }
    if (pinned) {
      summary += " · " + base::NumberToString(pinned) + " pinned";
    }
  }

  base::DictValue item;
  item.Set("name", name);
  item.Set("summary", summary);
  item.Set("project", project && !project->empty());
  item.Set("layout", project && !project->empty() ? "project"
                     : split                       ? "split"
                                                   : "single");
  item.Set("modified", saved.value_or(0));
  return item;
}

class MerlinStartHandler : public content::WebUIMessageHandler {
 public:
  MerlinStartHandler() = default;
  MerlinStartHandler(const MerlinStartHandler&) = delete;
  MerlinStartHandler& operator=(const MerlinStartHandler&) = delete;
  ~MerlinStartHandler() override = default;

  void RegisterMessages() override {
    web_ui()->RegisterMessageCallback(
        "ready", base::BindRepeating(&MerlinStartHandler::OnReady,
                                     base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "focusField", base::BindRepeating(&MerlinStartHandler::OnFocusField,
                                          base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "go", base::BindRepeating(&MerlinStartHandler::OnGo,
                                  base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "openWorkspace",
        base::BindRepeating(&MerlinStartHandler::OnOpenWorkspace,
                            base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "reopen", base::BindRepeating(&MerlinStartHandler::OnReopen,
                                      base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "suggest", base::BindRepeating(&MerlinStartHandler::OnSuggest,
                                       base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "stopSuggest", base::BindRepeating(&MerlinStartHandler::OnStopSuggest,
                                           base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "openSuggestion",
        base::BindRepeating(&MerlinStartHandler::OnOpenSuggestion,
                            base::Unretained(this)));
  }

 private:
  Profile* profile() { return Profile::FromWebUI(web_ui()); }

  ModalBrowserController* Controller() {
    tabs::TabInterface* tab =
        tabs::TabInterface::MaybeGetFromContents(web_ui()->GetWebContents());
    return tab ? ModalBrowserController::From(tab->GetBrowserWindowInterface())
               : nullptr;
  }

  void OnReady(const base::ListValue& args) {
    AllowJavascript();
    workspace_store::ReadAll(base::BindOnce(
        &MerlinStartHandler::OnWorkspacesRead, weak_factory_.GetWeakPtr()));
  }

  // A freshly opened start page takes keyboard focus so typing goes
  // straight into its field. Chromium would focus the address bar for a new
  // tab, but Merlin hides it, which left nothing focused. Background tabs
  // (a workspace opening several) leave focus where it is.
  void OnFocusField(const base::ListValue& args) {
    content::WebContents* contents = web_ui()->GetWebContents();
    tabs::TabInterface* tab = tabs::TabInterface::MaybeGetFromContents(contents);
    if (!tab || !tab->IsActivated()) {
      return;
    }
    AllowJavascript();
    contents->Focus();
    // Focusing the field enters Insert mode; Esc leaves it for the labels.
    CallJavascriptFunction("merlinStart.focusField");
  }

  void OnWorkspacesRead(
      std::vector<std::pair<std::string, std::string>> files) {
    if (!IsJavascriptAllowed()) {
      return;
    }
    std::vector<base::DictValue> items;
    for (const auto& [name, text] : files) {
      if (std::optional<base::DictValue> item = SummarizeWorkspace(name, text)) {
        items.push_back(std::move(*item));
      }
    }
    // Most recently saved first.
    std::sort(items.begin(), items.end(),
              [](const base::DictValue& a, const base::DictValue& b) {
                return a.FindDouble("modified").value_or(0) >
                       b.FindDouble("modified").value_or(0);
              });
    base::ListValue workspaces;
    for (base::DictValue& item : items) {
      if (workspaces.size() == kMaxWorkspaces) {
        break;
      }
      workspaces.Append(std::move(item));
    }

    base::DictValue data;
    data.Set("workspaces", std::move(workspaces));
    data.Set("recent", RecentlyClosed());
    CallJavascriptFunction("merlinStart.render", data);
  }

  base::ListValue RecentlyClosed() {
    base::ListValue recent;
    sessions::TabRestoreService* service =
        TabRestoreServiceFactory::GetForProfile(profile());
    if (!service) {
      return recent;
    }
    for (const auto& entry : service->entries()) {
      if (recent.size() == kMaxRecent) {
        break;
      }
      if (entry->type != sessions::tab_restore::TAB) {
        continue;
      }
      const auto& tab = static_cast<const sessions::tab_restore::Tab&>(*entry);
      if (tab.navigations.empty()) {
        continue;
      }
      const sessions::SerializedNavigationEntry& nav =
          tab.navigations[tab.normalized_navigation_index()];
      const GURL& url = nav.virtual_url();
      if (!url.SchemeIsHTTPOrHTTPS()) {
        continue;
      }
      base::DictValue item;
      item.Set("id", base::NumberToString(entry->id.id()));
      item.Set("url", url.spec());
      item.Set("title", nav.title());
      item.Set("domain", DomainOf(url));
      recent.Append(std::move(item));
    }
    return recent;
  }

  void RunLine(const std::string& line) {
    ModalBrowserController* controller = Controller();
    if (!controller) {
      return;
    }
    const std::string error = controller->RunCommandLine(line);
    if (IsJavascriptAllowed()) {
      CallJavascriptFunction("merlinStart.error", base::Value(error));
    }
  }

  // Typed text: ":" runs a command, anything else is opened like `:open`,
  // which decides between an address and a search.
  void OnGo(const base::ListValue& args) {
    if (args.empty() || !args[0].is_string()) {
      return;
    }
    std::string text(base::TrimWhitespaceASCII(args[0].GetString(),
                                               base::TRIM_ALL));
    if (text.empty() || text.size() > kMaxInput) {
      return;
    }
    if (text.front() == ':') {
      RunLine(text.substr(1));
    } else {
      RunLine("open " + text);
    }
  }

  void OnOpenWorkspace(const base::ListValue& args) {
    if (args.empty() || !args[0].is_string()) {
      return;
    }
    const std::string& name = args[0].GetString();
    if (name.empty() || name.size() > 64 ||
        name.find_first_of(" \t\r\n") != std::string::npos) {
      return;
    }
    RunLine("workspace open " + name);
  }

  // Reopens a closed tab in place of the start page.
  void OnReopen(const base::ListValue& args) {
    if (args.empty() || !args[0].is_string()) {
      return;
    }
    int32_t id = 0;
    if (!base::StringToInt(args[0].GetString(), &id)) {
      return;
    }
    sessions::TabRestoreService* service =
        TabRestoreServiceFactory::GetForProfile(profile());
    sessions::LiveTabContext* context =
        BrowserLiveTabContext::FindContextForWebContents(
            web_ui()->GetWebContents());
    if (!service || !context) {
      return;
    }
    service->RestoreEntryById(context, SessionID::FromSerializedValue(id),
                              WindowOpenDisposition::CURRENT_TAB);
  }

  // -- Suggestions ------------------------------------------------------------

  static std::optional<int> IntArg(const base::ListValue& args, size_t i) {
    if (args.size() <= i) {
      return std::nullopt;
    }
    if (args[i].is_int()) {
      return args[i].GetInt();
    }
    // JavaScript numbers may arrive as doubles.
    if (args[i].is_double()) {
      const double d = args[i].GetDouble();
      if (d >= 0 && d <= 1e9 && d == static_cast<int>(d)) {
        return static_cast<int>(d);
      }
    }
    return std::nullopt;
  }

  // [text, query id, whether the last edit deleted text]
  void OnSuggest(const base::ListValue& args) {
    std::optional<int> id = IntArg(args, 1);
    if (args.size() < 3 || !args[0].is_string() || !id ||
        !args[2].is_bool() || args[0].GetString().size() > kMaxInput) {
      return;
    }
    AllowJavascript();
    if (!suggestions_) {
      // Owned here, so the callback never outlives this handler.
      suggestions_ = std::make_unique<MerlinSuggestions>(
          profile(), base::BindRepeating(&MerlinStartHandler::OnSuggestions,
                                         base::Unretained(this)));
    }
    suggest_id_ = *id;
    suggestions_->Query(base::UTF8ToUTF16(args[0].GetString()),
                        args[2].GetBool());
  }

  void OnStopSuggest(const base::ListValue& args) {
    if (suggestions_) {
      suggestions_->Stop();
    }
  }

  void OnSuggestions(
      const std::vector<MerlinSuggestions::Suggestion>& results) {
    if (!IsJavascriptAllowed()) {
      return;
    }
    base::ListValue items;
    for (const MerlinSuggestions::Suggestion& s : results) {
      base::DictValue item;
      item.Set("kind", s.kind == MerlinSuggestions::Kind::kSearch ? "search"
                       : s.kind == MerlinSuggestions::Kind::kTab  ? "tab"
                                                                  : "url");
      item.Set("title", s.title);
      item.Set("detail", s.detail);
      item.Set("url", s.destination.spec());
      item.Set("inline", s.inline_completion);
      items.Append(std::move(item));
    }
    CallJavascriptFunction("merlinStart.suggestions", base::Value(suggest_id_),
                           items);
  }

  // [query id, row]. Opens what the browser suggested for that row, never
  // an address the page supplies.
  void OnOpenSuggestion(const base::ListValue& args) {
    std::optional<int> id = IntArg(args, 0);
    std::optional<int> index = IntArg(args, 1);
    if (!suggestions_ || !id || !index || *id != suggest_id_ ||
        static_cast<size_t>(*index) >= suggestions_->results().size()) {
      return;
    }
    const MerlinSuggestions::Suggestion s = suggestions_->results()[*index];
    suggestions_->Stop();
    // An open tab is switched to (Chromium closes this start page when it
    // does); anything else opens here. Nothing may use `this` after
    // OpenURL, which can close the tab and so this handler.
    content::OpenURLParams params(
        s.destination, content::Referrer(),
        s.kind == MerlinSuggestions::Kind::kTab
            ? WindowOpenDisposition::SWITCH_TO_TAB
            : WindowOpenDisposition::CURRENT_TAB,
        s.transition, /*is_renderer_initiated=*/false);
    web_ui()->GetWebContents()->OpenURL(params,
                                        /*navigation_handle_callback=*/{});
  }

  std::unique_ptr<MerlinSuggestions> suggestions_;
  int suggest_id_ = 0;
  base::WeakPtrFactory<MerlinStartHandler> weak_factory_{this};
};

class MerlinStartUIConfig
    : public content::DefaultWebUIConfig<MerlinStartUI> {
 public:
  MerlinStartUIConfig()
      : DefaultWebUIConfig(content::kChromeUIScheme, kMerlinStartHost) {}
};

}  // namespace

// static
const char* MerlinStartUI::FileForPath(const std::string& path) {
  if (path.empty() || path == "index.html") {
    return kIndexHtml;
  }
  if (path == "start.css") {
    return kStartCss;
  }
  if (path == "start.js") {
    return kStartJs;
  }
  return MerlinSharedFile(path);
}

MerlinStartUI::MerlinStartUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  content::WebUIDataSource* source = content::WebUIDataSource::CreateAndAdd(
      web_ui->GetWebContents()->GetBrowserContext(), kMerlinStartHost);
  source->SetRequestFilter(
      base::BindRepeating([](const std::string& path) {
        return FileForPath(path) != nullptr;
      }),
      base::BindRepeating(
          [](const std::string& path,
             content::WebUIDataSource::GotDataCallback callback) {
            std::move(callback).Run(
                base::MakeRefCounted<base::RefCountedString>(
                    std::string(FileForPath(path))));
          }));
  // Suggestion rows show site icons from chrome://favicon2, as Chromium's
  // history page does.
  Profile* profile = Profile::FromWebUI(web_ui);
  content::URLDataSource::Add(
      profile, std::make_unique<FaviconSource>(
                   profile, chrome::FaviconUrlFormat::kFavicon2));
  source->OverrideContentSecurityPolicy(
      network::mojom::CSPDirectiveName::ImgSrc,
      "img-src chrome://favicon2 'self' data:;");
  web_ui->AddMessageHandler(std::make_unique<MerlinStartHandler>());
}

MerlinStartUI::~MerlinStartUI() = default;

WEB_UI_CONTROLLER_TYPE_IMPL(MerlinStartUI)

void InstallMerlinStartPage() {
  static bool installed = false;
  if (installed) {
    return;
  }
  installed = true;
  content::WebUIConfigMap::GetInstance().AddWebUIConfig(
      std::make_unique<MerlinStartUIConfig>());
}

void SetMerlinStartAsNewTabDefault(Profile* profile) {
  if (!profile || profile->IsOffTheRecord()) {
    return;
  }
  profile->GetPrefs()->SetDefaultPrefValue(prefs::kNewTabPageLocationOverride,
                                           base::Value(kMerlinStartURL));
}

}  // namespace modal_browser
