// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_library_pages.h"

#include <algorithm>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "base/values.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/modal_browser/merlin_downloads.h"
#include "chrome/browser/ui/modal_browser/merlin_pages.h"
#include "chrome/browser/ui/modal_browser/merlin_url_rewrite.h"
#include "components/bookmarks/browser/base_bookmark_model_observer.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_node.h"
#include "components/bookmarks/browser/bookmark_utils.h"
#include "components/bookmarks/common/bookmark_metrics.h"
#include "components/download/content/public/all_download_item_notifier.h"
#include "components/download/public/common/download_item.h"
#include "components/history/core/browser/history_service.h"
#include "components/history/core/browser/history_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "content/public/browser/download_manager.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_ui.h"
#include "content/public/browser/web_ui_message_handler.h"
#include "content/public/browser/webui_config.h"
#include "content/public/common/url_constants.h"
#include "ui/base/models/tree_node_iterator.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

constexpr int kHistoryPage = 150;
constexpr size_t kMaxSearchResults = 500;

// -- Shared page frame --------------------------------------------------------

// The frame every list page uses: brand, title, actions, search, list.
std::string Frame(const char* title, const char* script, const char* search) {
  std::string html = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>$TITLE</title>
<link rel="icon" href="icon.svg">
<link rel="stylesheet" href="merlin.css">
<script src="merlin.js" defer></script>
<script src="$SCRIPT" defer></script>
</head>
<body>
<main class="page">
  <div class="top">
    <img class="mark" width="26" height="26" src="icon.svg" alt="" aria-hidden="true">
    <h1>$TITLE</h1>
    <span class="spacer"></span>
    <span id="actions" style="display:flex;gap:8px"></span>
    <label class="search"><input id="q" type="search" placeholder="$SEARCH" aria-label="$SEARCH" spellcheck="false"><kbd>s</kbd></label>
  </div>
  <div id="crumbs"></div>
  <div id="list" aria-live="polite"></div>
  <p class="foot" id="foot"></p>
</main>
</body>
</html>
)HTML";
  base::ReplaceSubstringsAfterOffset(&html, 0, "$TITLE", title);
  base::ReplaceSubstringsAfterOffset(&html, 0, "$SCRIPT", script);
  base::ReplaceSubstringsAfterOffset(&html, 0, "$SEARCH", search);
  return html;
}

// Only addresses a page may open: no javascript: (bookmarklets) or data:.
bool IsOpenable(const GURL& url) {
  return url.is_valid() &&
         (url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile() ||
          url.SchemeIs(content::kChromeUIScheme) || url.SchemeIs("ftp"));
}

const std::string* StringArg(const base::ListValue& args, size_t i = 0) {
  return args.size() > i && args[i].is_string() ? &args[i].GetString()
                                                : nullptr;
}

// -- History ------------------------------------------------------------------

constexpr char kHistoryJs[] = R"JS('use strict';
// Merlin History (merlin_library_pages.cc).
(() => {
  const {$, el, button, toast} = K;
  let items = [];
  let more = false;
  let query = '';

  function render() {
    const list = $('list');
    list.replaceChildren();
    if (!items.length) {
      list.append(el('div', 'group', null));
      list.lastChild.append(el('div', 'empty', query ? 'Nothing in history matches.' : 'No history yet.'));
    }
    let day = '';
    let group = null;
    for (const it of items) {
      const d = K.day(it.time);
      if (d !== day) {
        day = d;
        list.append(el('h2', '', d));
        group = el('div', 'group');
        list.append(group);
      }
      const r = el('div', 'row item');
      const a = el('a', 'text');
      a.href = it.url;
      a.title = it.url;
      a.append(el('span', 'title ellipsis', it.title || it.url), el('span', 'sub ellipsis', it.shown));
      a.style.textDecoration = 'none';
      const acts = el('span', 'acts');
      acts.append(button('×', 'icon-btn', () => {
        chrome.send('remove', [it.url]);
        items = items.filter((x) => x.url !== it.url);
        render();
        toast('Removed from history');
      }, 'Remove from history'));
      r.append(el('span', 'when', K.when(it.time)), K.tile(it.domain || it.title), a, acts);
      group.append(r);
    }
    if (more) {
      const b = button('Show older', 'btn', () => chrome.send('query', [query, items.length ? items[items.length - 1].time : 0]));
      b.style.marginTop = '16px';
      list.append(b);
    }
    $('foot').textContent = 'Type s to search. f labels every entry. Removing an entry removes every visit to that page.';
  }

  window.merlinPage = {
    results(q, append, list, reachedEnd) {
      if (q !== query) return;
      items = append ? items.concat(list) : list;
      more = !reachedEnd;
      render();
    },
  };

  const search = K.debounce(() => {
    query = $('q').value.trim();
    chrome.send('query', [query, 0]);
  }, 150);
  $('q').addEventListener('input', search);
  $('actions').append(button('Clear browsing data…', 'btn', () => chrome.send('clearData')));
  K.key('s', () => $('q').focus());
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) { $('q').value = initial; query = initial; }
  chrome.send('query', [query, 0]);
})();
)JS";

class HistoryHandler : public content::WebUIMessageHandler {
 public:
  HistoryHandler() = default;
  ~HistoryHandler() override = default;

  void RegisterMessages() override {
    web_ui()->RegisterMessageCallback(
        "query", base::BindRepeating(&HistoryHandler::OnQuery,
                                     base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "remove", base::BindRepeating(&HistoryHandler::OnRemove,
                                      base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "clearData", base::BindRepeating(&HistoryHandler::OnClearData,
                                         base::Unretained(this)));
  }

 private:
  history::HistoryService* Service() {
    return HistoryServiceFactory::GetForProfile(
        Profile::FromWebUI(web_ui()), ServiceAccessType::EXPLICIT_ACCESS);
  }

  // args: text, and the time (seconds) to continue before, or 0.
  void OnQuery(const base::ListValue& args) {
    AllowJavascript();
    const std::string* text = StringArg(args);
    history::HistoryService* service = Service();
    if (!text || text->size() > 512 || !service) {
      return;
    }
    history::QueryOptions options;
    options.max_count = kHistoryPage;
    options.duplicate_policy =
        history::QueryOptions::REMOVE_DUPLICATES_PER_DAY;
    double before = args.size() > 1 && args[1].is_double() ? args[1].GetDouble()
                    : args.size() > 1 && args[1].is_int()  ? args[1].GetInt()
                                                           : 0;
    if (before > 0) {
      options.end_time = base::Time::FromSecondsSinceUnixEpoch(before);
    }
    tracker_.TryCancelAll();
    service->QueryHistory(
        base::UTF8ToUTF16(*text), options,
        base::BindOnce(&HistoryHandler::OnResults, weak_factory_.GetWeakPtr(),
                       *text, before > 0),
        &tracker_);
  }

  void OnResults(std::string text,
                 bool append,
                 history::QueryResults results) {
    if (!IsJavascriptAllowed()) {
      return;
    }
    base::ListValue list;
    for (const history::URLResult& r : results) {
      base::DictValue item;
      item.Set("url", r.url().spec());
      item.Set("title", r.title());
      item.Set("shown", r.url().SchemeIs(content::kChromeUIScheme)
                            ? "merlin://" + std::string(r.url().host())
                            : std::string(r.url().host()));
      std::string host(r.url().host());
      if (base::StartsWith(host, "www.")) {
        host = host.substr(4);
      }
      item.Set("domain", host);
      item.Set("time", r.visit_time().InSecondsFSinceUnixEpoch());
      list.Append(std::move(item));
    }
    CallJavascriptFunction("merlinPage.results", base::Value(text),
                           base::Value(append), list,
                           base::Value(results.reached_beginning()));
  }

  void OnRemove(const base::ListValue& args) {
    const std::string* spec = StringArg(args);
    history::HistoryService* service = Service();
    if (!spec || !service) {
      return;
    }
    GURL url(*spec);
    if (url.is_valid()) {
      service->DeleteURLs({url});
    }
  }

  void OnClearData(const base::ListValue& args) {
    web_ui()->GetWebContents()->GetController().LoadURL(
        GURL("chrome://settings/clearBrowserData"), content::Referrer(),
        ui::PAGE_TRANSITION_LINK, std::string());
  }

  base::CancelableTaskTracker tracker_;
  base::WeakPtrFactory<HistoryHandler> weak_factory_{this};
};

// -- Downloads ----------------------------------------------------------------

constexpr char kDownloadsJs[] = R"JS('use strict';
// Merlin Downloads (merlin_library_pages.cc). The browser pushes the list
// whenever a download changes, at most a few times a second.
(() => {
  const {$, el, button} = K;
  let items = [];

  function ext(name) {
    const m = /\.([A-Za-z0-9]{1,4})$/.exec(name || '');
    return m ? m[1].toUpperCase() : 'FILE';
  }

  function act(name, id) { chrome.send('act', [name, String(id)]); }

  function render() {
    const q = $('q').value.trim().toLowerCase();
    const shown = items.filter((d) => !q || (d.name + ' ' + d.url).toLowerCase().includes(q));
    const list = $('list');
    list.replaceChildren();
    const g = el('div', 'group');
    list.append(g);
    if (!shown.length) g.append(el('div', 'empty', q ? 'No download matches.' : 'No downloads yet.'));
    for (const d of shown) {
      const r = el('div', 'row item');
      const icon = el('span', 'tile', ext(d.name));
      icon.style.background = d.state === 'done' ? '#3A372F' : '#857F70';
      icon.style.width = '34px';
      icon.style.fontSize = '9px';
      const t = el('div', 'text');
      const title = el('span', 'title ellipsis', d.name);
      if (d.state === 'done') {
        title.style.cursor = 'pointer';
        title.addEventListener('click', () => act('download-open', d.id));
      }
      if (d.state === 'removed' || d.state === 'cancelled') title.style.textDecoration = 'line-through';
      t.append(title);
      const sub = el('span', 'sub ellipsis', d.detail);
      t.append(sub);
      if (d.state === 'progress' || d.state === 'paused') {
        const bar = el('div', 'bar');
        const fill = el('span');
        fill.style.width = Math.max(2, d.percent) + '%';
        bar.append(fill);
        t.append(bar);
      }
      r.append(icon, t);
      if (d.state === 'dangerous') r.append(el('span', 'badge warn', 'Kept back'));
      const acts = el('span', 'acts');
      acts.style.opacity = '1';
      const B = (label, name, cls) => acts.append(button(label, cls || 'btn', () => act(name, d.id)));
      switch (d.state) {
        case 'done': B('Open', 'download-open'); B('Show in Finder', 'download-show'); break;
        case 'progress': B('Pause', 'download-pause'); B('Cancel', 'download-cancel', 'btn danger'); break;
        case 'paused': B('Resume', 'download-pause'); B('Cancel', 'download-cancel', 'btn danger'); break;
        case 'failed': if (d.canResume) B('Retry', 'download-retry'); break;
        case 'dangerous':
          acts.append(button('Review…', 'btn', () => chrome.send('review')));
          B('Discard', 'download-discard', 'btn danger');
          break;
      }
      if (d.state !== 'progress' && d.state !== 'paused' && d.state !== 'dangerous') {
        acts.append(button('×', 'icon-btn', () => act('download-forget', d.id), 'Remove from list'));
      }
      r.append(acts);
      g.append(r);
    }
    $('foot').textContent = 'Kept-back files may be harmful: Review shows why and lets you keep them.';
  }

  window.merlinPage = {
    list(data) { items = data; render(); },
  };
  $('q').addEventListener('input', render);
  $('actions').append(
    button('Open folder', 'btn', () => chrome.send('openFolder')),
    button('Clear list', 'btn', () => chrome.send('clearAll')));
  K.key('s', () => $('q').focus());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) chrome.send('ready'); });
  chrome.send('ready');
})();
)JS";

class DownloadsHandler : public content::WebUIMessageHandler,
                         public download::AllDownloadItemNotifier::Observer {
 public:
  DownloadsHandler() = default;
  ~DownloadsHandler() override = default;

  void RegisterMessages() override {
    web_ui()->RegisterMessageCallback(
        "ready", base::BindRepeating(&DownloadsHandler::OnReady,
                                     base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "act", base::BindRepeating(&DownloadsHandler::OnAct,
                                   base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "clearAll", base::BindRepeating(&DownloadsHandler::OnClearAll,
                                        base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "openFolder", base::BindRepeating(&DownloadsHandler::OnOpenFolder,
                                          base::Unretained(this)));
    web_ui()->RegisterMessageCallback(
        "review", base::BindRepeating(&DownloadsHandler::OnReview,
                                      base::Unretained(this)));
  }

  // AllDownloadItemNotifier::Observer:
  void OnDownloadCreated(content::DownloadManager*,
                         download::DownloadItem*) override {
    Schedule();
  }
  void OnDownloadUpdated(content::DownloadManager*,
                         download::DownloadItem*) override {
    Schedule();
  }
  void OnDownloadRemoved(content::DownloadManager*,
                         download::DownloadItem*) override {
    Schedule();
  }

 private:
  Profile* profile() { return Profile::FromWebUI(web_ui()); }

  void OnReady(const base::ListValue& args) {
    AllowJavascript();
    if (!notifier_) {
      if (content::DownloadManager* manager =
              profile()->GetDownloadManager()) {
        notifier_ = std::make_unique<download::AllDownloadItemNotifier>(
            manager, this);
      }
    }
    Push();
  }

  void OnJavascriptDisallowed() override {
    notifier_.reset();
    timer_.Stop();
  }

  // Coalesces bursts of updates (progress arrives many times a second).
  void Schedule() {
    if (!IsJavascriptAllowed() || timer_.IsRunning()) {
      return;
    }
    timer_.Start(FROM_HERE, base::Milliseconds(250),
                 base::BindOnce(&DownloadsHandler::Push,
                                base::Unretained(this)));
  }

  void Push() {
    if (!IsJavascriptAllowed()) {
      return;
    }
    base::ListValue list;
    for (download::DownloadItem* item : MerlinDownloads(profile())) {
      list.Append(DescribeMerlinDownload(item));
    }
    CallJavascriptFunction("merlinPage.list", list);
  }

  void OnAct(const base::ListValue& args) {
    const std::string* name = StringArg(args, 0);
    const std::string* id = StringArg(args, 1);
    uint32_t value = 0;
    if (!name || !id || !base::StringToUint(*id, &value)) {
      return;
    }
    RunMerlinDownloadAction(profile(), *name, value);
    Push();
  }

  void OnClearAll(const base::ListValue& args) {
    for (download::DownloadItem* item : MerlinDownloads(profile())) {
      if (item->GetState() != download::DownloadItem::IN_PROGRESS) {
        item->Remove();
      }
    }
    Push();
  }

  void OnOpenFolder(const base::ListValue& args) {
    OpenMerlinDownloadsFolder(profile());
  }

  // Chromium's own page explains the danger and lets the user keep the
  // file; Merlin does not reimplement that decision.
  void OnReview(const base::ListValue& args) {
    web_ui()->GetWebContents()->GetController().LoadURL(
        GURL("chrome://downloads/?classic"), content::Referrer(),
        ui::PAGE_TRANSITION_LINK, std::string());
  }

  std::unique_ptr<download::AllDownloadItemNotifier> notifier_;
  base::OneShotTimer timer_;
};

// -- Bookmarks ----------------------------------------------------------------

constexpr char kBookmarksJs[] = R"JS('use strict';
// Merlin Bookmarks (merlin_library_pages.cc). A folder at a time, or
// search across all of them.
(() => {
  const {$, el, button, toast} = K;
  let view = {path: [], items: [], folder: ''};
  let editing = null;

  function folderId() { return location.hash.replace(/^#/, ''); }

  function load() {
    const q = $('q').value.trim();
    if (q) chrome.send('search', [q]); else chrome.send('folder', [folderId()]);
  }

  function crumbs() {
    const c = $('crumbs');
    c.replaceChildren();
    c.style.cssText = 'display:flex;align-items:center;gap:6px;margin:-12px 0 14px;font-size:13px;color:var(--text2)';
    if ($('q').value.trim()) { c.append(el('span', '', 'Search results')); return; }
    view.path.forEach((p, i) => {
      if (i) c.append(el('span', 'faint', '›'));
      if (i === view.path.length - 1) { c.append(el('span', '', p.title)); return; }
      const a = el('a', '', p.title);
      a.href = '#' + p.id;
      c.append(a);
    });
  }

  function editRow(it) {
    const r = el('div', 'row');
    const title = el('input', 'field');
    title.value = it.title;
    title.setAttribute('aria-label', 'Name');
    title.style.flex = '1';
    r.append(title);
    let url = null;
    if (!it.folder) {
      url = el('input', 'field');
      url.value = it.url;
      url.setAttribute('aria-label', 'Address');
      url.style.flex = '1.4';
      url.classList.add('mono');
      r.append(url);
    }
    const save = () => {
      chrome.send('edit', [it.id, title.value, url ? url.value : '']);
      editing = null;
    };
    for (const f of [title, url].filter(Boolean)) {
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') { editing = null; render(); }
      });
    }
    r.append(button('Save', 'btn primary', save), button('Cancel', 'btn', () => { editing = null; render(); }));
    setTimeout(() => title.focus(), 0);
    return r;
  }

  function render() {
    crumbs();
    const list = $('list');
    list.replaceChildren();
    const g = el('div', 'group');
    list.append(g);
    if (!view.items.length) g.append(el('div', 'empty', $('q').value.trim() ? 'No bookmark matches.' : 'This folder is empty.'));
    for (const it of view.items) {
      if (editing === it.id) { g.append(editRow(it)); continue; }
      const r = el('div', 'row item');
      let a;
      if (it.folder) {
        const f = el('span', 'tile', '▸');
        f.style.background = '#B8920E';
        r.append(f);
        a = el('a', 'text');
        a.href = '#' + it.id;
        a.append(el('span', 'title ellipsis', it.title), el('span', 'sub', it.count + (it.count === 1 ? ' item' : ' items')));
      } else {
        r.append(K.tile(K.domain(it.url) || it.title));
        a = el(it.openable ? 'a' : 'span', 'text');
        if (it.openable) a.href = it.url;
        a.title = it.url;
        a.append(el('span', 'title ellipsis', it.title || it.url),
                 el('span', 'sub ellipsis', it.where ? it.where + ' · ' + it.shown : it.shown));
      }
      a.style.textDecoration = 'none';
      r.append(a);
      const acts = el('span', 'acts');
      acts.append(button('✎', 'icon-btn', () => { editing = it.id; render(); }, it.folder ? 'Rename' : 'Edit'),
                  button('×', 'icon-btn', () => {
                    if (it.folder && it.count && !confirm('Delete "' + it.title + '" and the ' + it.count + ' items in it?')) return;
                    chrome.send('remove', [it.id]);
                    toast('Deleted');
                  }, 'Delete'));
      if (!it.editable) acts.replaceChildren();
      r.append(acts);
      g.append(r);
    }
    $('foot').textContent = 'Type s to search, f to pick a bookmark. ⌘-click opens in a new tab.';
  }

  window.merlinPage = {
    show(data) { view = data; render(); },
    changed() { load(); },
  };
  $('q').addEventListener('input', K.debounce(load, 120));
  $('actions').append(button('New folder', 'btn', () => {
    const name = prompt('Folder name');
    if (name && name.trim()) chrome.send('newFolder', [view.folder, name.trim()]);
  }));
  window.addEventListener('hashchange', () => { $('q').value = ''; editing = null; load(); });
  K.key('s', () => $('q').focus());
  load();
})();
)JS";

class BookmarksHandler : public content::WebUIMessageHandler,
                         public bookmarks::BaseBookmarkModelObserver {
 public:
  BookmarksHandler() = default;
  ~BookmarksHandler() override {
    if (model_) {
      model_->RemoveObserver(this);
    }
  }

  void RegisterMessages() override {
    auto on = [this](const char* name,
                     void (BookmarksHandler::*method)(const base::ListValue&)) {
      web_ui()->RegisterMessageCallback(
          name, base::BindRepeating(method, base::Unretained(this)));
    };
    on("folder", &BookmarksHandler::OnFolder);
    on("search", &BookmarksHandler::OnSearch);
    on("edit", &BookmarksHandler::OnEdit);
    on("remove", &BookmarksHandler::OnRemove);
    on("newFolder", &BookmarksHandler::OnNewFolder);
  }

  // BaseBookmarkModelObserver:
  void BookmarkModelChanged() override {
    if (IsJavascriptAllowed()) {
      CallJavascriptFunction("merlinPage.changed");
    }
  }
  void BookmarkModelLoaded(bool ids_reassigned) override {
    BookmarkModelChanged();
  }
  void BookmarkModelBeingDeleted() override {
    model_->RemoveObserver(this);
    model_ = nullptr;
  }

 private:
  bookmarks::BookmarkModel* Model() {
    if (!model_) {
      model_ = BookmarkModelFactory::GetForBrowserContext(
          Profile::FromWebUI(web_ui()));
      if (model_) {
        model_->AddObserver(this);
      }
    }
    return model_ && model_->loaded() ? model_.get() : nullptr;
  }

  const bookmarks::BookmarkNode* NodeArg(const base::ListValue& args,
                                         size_t i = 0) {
    const std::string* id = StringArg(args, i);
    int64_t value = 0;
    bookmarks::BookmarkModel* model = Model();
    if (!id || !model || !base::StringToInt64(*id, &value)) {
      return nullptr;
    }
    return bookmarks::GetBookmarkNodeByID(model, value);
  }

  bool Editable(const bookmarks::BookmarkNode* node) {
    return node && !model_->is_permanent_node(node) &&
           node != model_->root_node();
  }

  base::DictValue Describe(const bookmarks::BookmarkNode* node,
                           bool with_folder) {
    base::DictValue item;
    item.Set("id", base::NumberToString(node->id()));
    item.Set("title", node->GetTitle());
    item.Set("folder", node->is_folder());
    item.Set("editable", Editable(node));
    if (node->is_folder()) {
      item.Set("count", static_cast<int>(node->children().size()));
    } else {
      item.Set("url", node->url().spec());
      item.Set("openable", IsOpenable(node->url()));
      item.Set("shown", node->url().SchemeIs(content::kChromeUIScheme)
                            ? "merlin://" + std::string(node->url().host())
                            : std::string(node->url().host()));
      if (with_folder && node->parent()) {
        item.Set("where", node->parent()->GetTitle());
      }
    }
    return item;
  }

  // The root lists the permanent folders (bar, other, mobile when used).
  void OnFolder(const base::ListValue& args) {
    AllowJavascript();
    bookmarks::BookmarkModel* model = Model();
    if (!model) {
      return;  // BookmarkModelLoaded() asks the page to load again.
    }
    const bookmarks::BookmarkNode* folder = NodeArg(args);
    if (!folder || !folder->is_folder()) {
      folder = model->root_node();
    }
    base::ListValue path;
    for (const bookmarks::BookmarkNode* n = folder; n; n = n->parent()) {
      base::DictValue crumb;
      crumb.Set("id", n == model->root_node()
                          ? std::string()
                          : base::NumberToString(n->id()));
      crumb.Set("title", n == model->root_node() ? u"All bookmarks"
                                                 : n->GetTitle());
      path.Insert(path.begin(), base::Value(std::move(crumb)));
    }
    base::ListValue items;
    for (const auto& child : folder->children()) {
      // Empty permanent folders other than the bar and Other (mobile,
      // managed) are noise at the top level.
      if (folder == model->root_node() && child->children().empty() &&
          child.get() != model->bookmark_bar_node() &&
          child.get() != model->other_node()) {
        continue;
      }
      items.Append(Describe(child.get(), false));
    }
    base::DictValue view;
    view.Set("path", std::move(path));
    view.Set("items", std::move(items));
    view.Set("folder", folder == model->root_node()
                           ? base::NumberToString(model->other_node()->id())
                           : base::NumberToString(folder->id()));
    CallJavascriptFunction("merlinPage.show", view);
  }

  void OnSearch(const base::ListValue& args) {
    AllowJavascript();
    const std::string* text = StringArg(args);
    bookmarks::BookmarkModel* model = Model();
    if (!text || !model) {
      return;
    }
    const std::u16string needle = base::ToLowerASCII(base::UTF8ToUTF16(*text));
    base::ListValue items;
    ui::TreeNodeIterator<const bookmarks::BookmarkNode> it(model->root_node());
    while (it.has_next() && items.size() < kMaxSearchResults) {
      const bookmarks::BookmarkNode* node = it.Next();
      const std::u16string hay = base::ToLowerASCII(
          node->GetTitle() + u" " +
          (node->is_url() ? base::UTF8ToUTF16(node->url().spec()) : u""));
      if (hay.find(needle) != std::u16string::npos) {
        items.Append(Describe(node, true));
      }
    }
    base::DictValue view;
    view.Set("path", base::ListValue());
    view.Set("items", std::move(items));
    view.Set("folder", base::NumberToString(model->other_node()->id()));
    CallJavascriptFunction("merlinPage.show", view);
  }

  void OnEdit(const base::ListValue& args) {
    const bookmarks::BookmarkNode* node = NodeArg(args, 0);
    const std::string* title = StringArg(args, 1);
    const std::string* url = StringArg(args, 2);
    if (!Editable(node) || !title || !url || title->size() > 4096) {
      return;
    }
    model_->SetTitle(node, base::UTF8ToUTF16(*title),
                     bookmarks::metrics::BookmarkEditSource::kUser);
    if (node->is_url()) {
      GURL target(*url);
      if (target.is_valid()) {
        model_->SetURL(node, target,
                       bookmarks::metrics::BookmarkEditSource::kUser);
      }
    }
  }

  void OnRemove(const base::ListValue& args) {
    const bookmarks::BookmarkNode* node = NodeArg(args);
    if (Editable(node)) {
      model_->Remove(node, bookmarks::metrics::BookmarkEditSource::kUser,
                     FROM_HERE);
    }
  }

  void OnNewFolder(const base::ListValue& args) {
    const bookmarks::BookmarkNode* parent = NodeArg(args, 0);
    const std::string* title = StringArg(args, 1);
    if (!parent || !parent->is_folder() || !title || title->empty() ||
        title->size() > 4096) {
      return;
    }
    model_->AddFolder(parent, parent->children().size(),
                      base::UTF8ToUTF16(*title));
  }

  raw_ptr<bookmarks::BookmarkModel> model_ = nullptr;
};

// -- Pages ----------------------------------------------------------------------

const std::string& HistoryHtml() {
  static const base::NoDestructor<std::string> html(
      Frame("History", "history.js", "Search history"));
  return *html;
}
const std::string& DownloadsHtml() {
  static const base::NoDestructor<std::string> html(
      Frame("Downloads", "downloads.js", "Search downloads"));
  return *html;
}
const std::string& BookmarksHtml() {
  static const base::NoDestructor<std::string> html(
      Frame("Bookmarks", "bookmarks.js", "Search bookmarks"));
  return *html;
}

template <typename UI>
class LibraryConfig : public content::DefaultWebUIConfig<UI> {
 public:
  explicit LibraryConfig(const char* host)
      : content::DefaultWebUIConfig<UI>(content::kChromeUIScheme, host) {}
};

}  // namespace

MerlinHistoryUI::MerlinHistoryUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  const MerlinPageFile files[] = {{"index.html", HistoryHtml().c_str()},
                                   {"history.js", kHistoryJs}};
  AddMerlinPageSource(web_ui, kMerlinHistoryHost, files);
  web_ui->AddMessageHandler(std::make_unique<HistoryHandler>());
}
MerlinHistoryUI::~MerlinHistoryUI() = default;
WEB_UI_CONTROLLER_TYPE_IMPL(MerlinHistoryUI)

MerlinDownloadsUI::MerlinDownloadsUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  const MerlinPageFile files[] = {{"index.html", DownloadsHtml().c_str()},
                                   {"downloads.js", kDownloadsJs}};
  AddMerlinPageSource(web_ui, kMerlinDownloadsHost, files);
  web_ui->AddMessageHandler(std::make_unique<DownloadsHandler>());
}
MerlinDownloadsUI::~MerlinDownloadsUI() = default;
WEB_UI_CONTROLLER_TYPE_IMPL(MerlinDownloadsUI)

MerlinBookmarksUI::MerlinBookmarksUI(content::WebUI* web_ui)
    : content::WebUIController(web_ui) {
  const MerlinPageFile files[] = {{"index.html", BookmarksHtml().c_str()},
                                   {"bookmarks.js", kBookmarksJs}};
  AddMerlinPageSource(web_ui, kMerlinBookmarksHost, files);
  web_ui->AddMessageHandler(std::make_unique<BookmarksHandler>());
}
MerlinBookmarksUI::~MerlinBookmarksUI() = default;
WEB_UI_CONTROLLER_TYPE_IMPL(MerlinBookmarksUI)

std::unique_ptr<content::WebUIConfig> MakeMerlinHistoryConfig() {
  return std::make_unique<LibraryConfig<MerlinHistoryUI>>(kMerlinHistoryHost);
}
std::unique_ptr<content::WebUIConfig> MakeMerlinDownloadsConfig() {
  return std::make_unique<LibraryConfig<MerlinDownloadsUI>>(
      kMerlinDownloadsHost);
}
std::unique_ptr<content::WebUIConfig> MakeMerlinBookmarksConfig() {
  return std::make_unique<LibraryConfig<MerlinBookmarksUI>>(
      kMerlinBookmarksHost);
}

}  // namespace modal_browser
