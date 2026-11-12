// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_shell_services.h"

#include <algorithm>
#include <limits>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/escape.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/time/time.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_avatar_icon_util.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_window.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/ui/modal_browser/merlin_downloads.h"
#include "chrome/browser/ui/modal_browser/merlin_preferences.h"
#include "chrome/browser/ui/modal_browser/merlin_react_extension_popup.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "components/omnibox/browser/location_bar_model.h"
#include "components/security_state/core/security_state.h"
#include "url/origin.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/pref_names.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_node.h"
#include "components/bookmarks/browser/bookmark_utils.h"
#include "components/bookmarks/common/bookmark_metrics.h"
#include "components/history/core/browser/history_service.h"
#include "components/history/core/browser/history_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "ui/base/models/tree_node_iterator.h"
#include "ui/base/base_window.h"
#include "ui/shell_dialogs/select_file_dialog.h"
#include "ui/shell_dialogs/select_file_policy.h"
#include "ui/shell_dialogs/selected_file_info.h"
#include "url/gurl.h"

namespace modal_browser {

namespace {

using Dict = base::DictValue;
using List = base::ListValue;
using bookmarks::BookmarkModel;
using bookmarks::BookmarkNode;

constexpr size_t kHistoryPage = 100;
constexpr size_t kBookmarkSearchLimit = 200;
constexpr size_t kMaxText = 4096;

void Reply(ShellServiceReply reply, base::Value value) {
  std::move(reply).Run({std::move(value), {}});
}
void Fail(ShellServiceReply reply, std::string error) {
  std::move(reply).Run({base::Value(), std::move(error)});
}

ModalBrowserController* Controller(BrowserWindowInterface* browser) {
  return ModalBrowserController::From(browser);
}

// Lists are ordinary user content; a malformed name never reaches the store.
bool ValidWorkspaceName(const std::string& name) {
  return !name.empty() && name.size() <= 64 &&
         name.find_first_of(" \t\r\n\"'/\\") == std::string::npos;
}

std::string Host(const GURL& url) {
  if (url.SchemeIs(content::kChromeUIScheme)) {
    return "merlin://" + std::string(url.host());
  }
  std::string host(url.host());
  return base::StartsWith(host, "www.") ? host.substr(4) : host;
}

// -- Settings -----------------------------------------------------------------

Dict Preferences(BrowserWindowInterface* browser) {
  return MerlinPreferences(browser->GetProfile(), Controller(browser));
}

// Owns itself until the system folder picker closes.
class FolderPicker : public ui::SelectFileDialog::Listener {
 public:
  static void Show(BrowserWindowInterface* browser,
                   base::OnceCallback<void(base::FilePath)> done) {
    auto* picker = new FolderPicker(std::move(done));
    PrefService* prefs = browser->GetProfile()->GetPrefs();
    picker->dialog_ = ui::SelectFileDialog::Create(picker, nullptr);
    picker->dialog_->SelectFile(
        ui::SelectFileDialog::SELECT_FOLDER, u"Save downloads to",
        prefs->GetFilePath(prefs::kDownloadDefaultDirectory), nullptr, 0,
        base::FilePath::StringType(),
        browser->GetWindow() ? browser->GetWindow()->GetNativeWindow()
                             : gfx::NativeWindow());
  }

  void FileSelected(const ui::SelectedFileInfo& file, int) override {
    Finish(file.path());
  }
  void FileSelectionCanceled() override { Finish(base::FilePath()); }

 private:
  explicit FolderPicker(base::OnceCallback<void(base::FilePath)> done)
      : done_(std::move(done)) {}
  ~FolderPicker() override {
    if (dialog_) {
      dialog_->ListenerDestroyed();
    }
  }
  void Finish(base::FilePath path) {
    if (done_) {
      std::move(done_).Run(std::move(path));
    }
    delete this;
  }

  scoped_refptr<ui::SelectFileDialog> dialog_;
  base::OnceCallback<void(base::FilePath)> done_;
};

void ListWorkspaces(ShellServiceReply reply) {
  workspace_store::List(base::BindOnce(
      [](ShellServiceReply reply, std::vector<workspace_store::Entry> entries) {
        std::sort(entries.begin(), entries.end(),
                  [](const auto& a, const auto& b) {
                    return a.modified > b.modified;
                  });
        List list;
        for (const auto& entry : entries) {
          list.Append(Dict()
                          .Set("name", entry.name)
                          .Set("modified", static_cast<double>(entry.modified)));
        }
        Reply(std::move(reply), base::Value(std::move(list)));
      },
      std::move(reply)));
}

bool RunSettings(BrowserWindowInterface* browser,
                 const std::string& method,
                 const Dict& args,
                 ShellServiceReply& reply) {
  Profile* profile = browser->GetProfile();
  if (method == "settings.get") {
    Reply(std::move(reply), base::Value(Preferences(browser)));
  } else if (method == "settings.set") {
    const std::string* key = args.FindString("key");
    const base::Value* value = args.Find("value");
    if (!key || !value) {
      Fail(std::move(reply), "Invalid setting");
      return true;
    }
    const std::string error =
        SetMerlinPreference(profile, Controller(browser), *key, *value);
    if (!error.empty()) {
      Fail(std::move(reply), error);
    } else {
      Reply(std::move(reply), base::Value(Preferences(browser)));
    }
  } else if (method == "settings.chooseDownloadDir") {
    FolderPicker::Show(
        browser,
        base::BindOnce(
            [](base::WeakPtr<Profile> profile, ShellServiceReply reply,
               base::FilePath path) {
              if (!profile) {
                Fail(std::move(reply), "This profile has closed");
                return;
              }
              if (!path.empty()) {
                profile->GetPrefs()->SetFilePath(
                    prefs::kDownloadDefaultDirectory, path);
                profile->GetPrefs()->SetFilePath(
                    prefs::kSaveFileDefaultDirectory, path);
              }
              Reply(std::move(reply),
                    base::Value(profile->GetPrefs()
                                    ->GetFilePath(
                                        prefs::kDownloadDefaultDirectory)
                                    .AsUTF8Unsafe()));
            },
            profile->GetWeakPtr(), std::move(reply)));
  } else if (method == "settings.config") {
    config_file::Read(base::BindOnce(
        [](ShellServiceReply reply, config_file::ReadResult result) {
          Reply(std::move(reply),
                base::Value(
                    Dict()
                        .Set("found", result.found)
                        .Set("text", result.text)
                        .Set("error", result.error)
                        .Set("path", config_file::ConfigPath().AsUTF8Unsafe())));
        },
        std::move(reply)));
  } else if (method == "settings.saveConfig") {
    const std::string* text = args.FindString("text");
    if (!text || text->size() > 512 * 1024) {
      Fail(std::move(reply), "The configuration is too large");
      return true;
    }
    config_file::Write(
        *text, base::BindOnce(
                   [](ShellServiceReply reply, std::string error) {
                     if (error.empty()) {
                       // Every window rereads it; Settings confirms the save.
                       ModalBrowserController::ReloadConfigInAllWindows(
                           nullptr);
                     }
                     Reply(std::move(reply), base::Value(error));
                   },
                   std::move(reply)));
  } else if (method == "settings.setOption") {
    // One [options] value from Settings, written into the config file so the
    // file stays the single source of these options.
    const std::string* name = args.FindString("name");
    const base::Value* value = args.Find("value");
    std::string literal;
    if (name && value && value->is_bool() &&
        (*name == "modal_browsing" || *name == "auto_insert" ||
         *name == "smooth_scroll")) {
      literal = value->GetBool() ? "true" : "false";
    } else if (name && value && value->is_string() && *name == "hint_chars" &&
               value->GetString().size() >= 2 &&
               value->GetString().size() <= 32 &&
               std::ranges::all_of(value->GetString(), [](char c) {
                 return base::IsAsciiLower(c) || base::IsAsciiDigit(c);
               })) {
      literal = "\"" + value->GetString() + "\"";
    } else {
      Fail(std::move(reply), "Invalid setting");
      return true;
    }
    config_file::Read(base::BindOnce(
        [](ShellServiceReply reply, std::string name, std::string literal,
           config_file::ReadResult file) {
          if (!file.error.empty()) {
            Fail(std::move(reply), file.error);
            return;
          }
          config_file::Write(
              config_file::SetOption(file.text, name, literal),
              base::BindOnce(
                  [](ShellServiceReply reply, std::string error) {
                    if (error.empty()) {
                      ModalBrowserController::ReloadConfigInAllWindows(
                          nullptr);
                    }
                    Reply(std::move(reply), base::Value(error));
                  },
                  std::move(reply)));
        },
        std::move(reply), *name, std::move(literal)));
  } else if (method == "settings.workspaces") {
    ListWorkspaces(std::move(reply));
  } else if (method == "settings.deleteWorkspace") {
    const std::string* name = args.FindString("name");
    if (!name || !ValidWorkspaceName(*name)) {
      Fail(std::move(reply), "Invalid workspace name");
      return true;
    }
    workspace_store::Delete(
        *name, base::BindOnce(
                   [](ShellServiceReply reply, bool) {
                     ListWorkspaces(std::move(reply));
                   },
                   std::move(reply)));
  } else if (method == "settings.openPage") {
    const std::string* key = args.FindString("key");
    const std::string target = key ? MerlinPreferenceLink(*key) : std::string();
    if (target.empty()) {
      Fail(std::move(reply), "Unknown settings page");
      return true;
    }
    chrome::AddTabAt(browser, GURL(target), -1, true);
    Reply(std::move(reply), base::Value());
  } else {
    return false;
  }
  return true;
}

// -- History ------------------------------------------------------------------

base::CancelableTaskTracker& HistoryTracker() {
  static base::NoDestructor<base::CancelableTaskTracker> tracker;
  return *tracker;
}

bool RunHistory(BrowserWindowInterface* browser,
                const std::string& method,
                const Dict& args,
                ShellServiceReply& reply) {
  if (!method.starts_with("history.")) {
    return false;
  }
  history::HistoryService* service = HistoryServiceFactory::GetForProfile(
      browser->GetProfile(), ServiceAccessType::EXPLICIT_ACCESS);
  if (!service) {
    Fail(std::move(reply), "History is not available in this window");
    return true;
  }
  if (method == "history.search") {
    const std::string* text = args.FindString("text");
    if (!text || text->size() > 512) {
      Fail(std::move(reply), "Invalid history search");
      return true;
    }
    history::QueryOptions options;
    options.max_count = kHistoryPage;
    options.duplicate_policy = history::QueryOptions::REMOVE_DUPLICATES_PER_DAY;
    // `before` is milliseconds since the Unix epoch, for the next page.
    if (const auto before = args.FindDouble("before"); before && *before > 0) {
      options.end_time =
          base::Time::FromMillisecondsSinceUnixEpoch(*before);
    }
    service->QueryHistory(
        base::UTF8ToUTF16(*text), options,
        base::BindOnce(
            [](ShellServiceReply reply, history::QueryResults results) {
              List items;
              for (const history::URLResult& r : results) {
                items.Append(
                    Dict()
                        .Set("url", r.url().spec())
                        .Set("title", r.title())
                        .Set("domain", Host(r.url()))
                        .Set("time",
                             r.visit_time().InMillisecondsFSinceUnixEpochIgnoringNull()));
              }
              Reply(std::move(reply),
                    base::Value(Dict()
                                    .Set("items", std::move(items))
                                    .Set("done", results.reached_beginning())));
            },
            std::move(reply)),
        &HistoryTracker());
  } else if (method == "history.remove") {
    const List* urls = args.FindList("urls");
    std::vector<GURL> targets;
    if (urls) {
      for (const auto& url : *urls) {
        if (url.is_string() && GURL(url.GetString()).is_valid()) {
          targets.emplace_back(url.GetString());
        }
      }
    }
    if (targets.empty() || targets.size() > kHistoryPage) {
      Fail(std::move(reply), "Choose pages to remove");
      return true;
    }
    service->DeleteURLs(targets);
    Reply(std::move(reply), base::Value());
  } else {
    Fail(std::move(reply), "Unknown history request");
  }
  return true;
}

// -- Bookmarks ----------------------------------------------------------------

bool Editable(BookmarkModel* model, const BookmarkNode* node) {
  return node && !model->is_permanent_node(node) && node != model->root_node();
}

const BookmarkNode* NodeArg(BookmarkModel* model,
                            const Dict& args,
                            const char* key) {
  const std::string* id = args.FindString(key);
  int64_t value = 0;
  return id && base::StringToInt64(*id, &value)
             ? bookmarks::GetBookmarkNodeByID(model, value)
             : nullptr;
}

Dict DescribeBookmark(BookmarkModel* model,
                      const BookmarkNode* node,
                      bool with_folder) {
  Dict item;
  item.Set("id", base::NumberToString(node->id()));
  item.Set("title", node->GetTitle());
  item.Set("folder", node->is_folder());
  item.Set("editable", Editable(model, node));
  if (node->is_folder()) {
    item.Set("count", static_cast<int>(node->children().size()));
  } else {
    item.Set("url", node->url().spec());
    item.Set("domain", Host(node->url()));
  }
  if (with_folder && node->parent()) {
    item.Set("where", node->parent()->GetTitle());
  }
  return item;
}

// The root lists the permanent folders (bar, other, and mobile when used).
Dict BookmarkFolder(BookmarkModel* model, const BookmarkNode* folder) {
  if (!folder || !folder->is_folder()) {
    folder = model->root_node();
  }
  List path;
  for (const BookmarkNode* n = folder; n; n = n->parent()) {
    path.Insert(path.begin(),
                base::Value(Dict()
                                .Set("id", n == model->root_node()
                                               ? std::string()
                                               : base::NumberToString(n->id()))
                                .Set("title", n == model->root_node()
                                                  ? u"All bookmarks"
                                                  : n->GetTitle())));
  }
  List items;
  for (const auto& child : folder->children()) {
    if (folder == model->root_node() && child->children().empty() &&
        child.get() != model->bookmark_bar_node() &&
        child.get() != model->other_node()) {
      continue;
    }
    items.Append(DescribeBookmark(model, child.get(), false));
  }
  // New folders go into the shown folder, or Other bookmarks at the root.
  const BookmarkNode* target =
      folder == model->root_node() ? model->other_node() : folder;
  return Dict()
      .Set("path", std::move(path))
      .Set("items", std::move(items))
      .Set("folderId", base::NumberToString(target->id()));
}

bool RunBookmarks(BrowserWindowInterface* browser,
                  const std::string& method,
                  const Dict& args,
                  ShellServiceReply& reply) {
  if (!method.starts_with("bookmarks.")) {
    return false;
  }
  BookmarkModel* model =
      BookmarkModelFactory::GetForBrowserContext(browser->GetProfile());
  if (!model || !model->loaded()) {
    Fail(std::move(reply), "Bookmarks are still loading; try again");
    return true;
  }
  const auto edit = bookmarks::metrics::BookmarkEditSource::kUser;
  if (method == "bookmarks.folder") {
    Reply(std::move(reply),
          base::Value(BookmarkFolder(model, NodeArg(model, args, "folderId"))));
  } else if (method == "bookmarks.search") {
    const std::string* text = args.FindString("text");
    if (!text || text->empty() || text->size() > 512) {
      Fail(std::move(reply), "Invalid bookmark search");
      return true;
    }
    const std::u16string needle = base::ToLowerASCII(base::UTF8ToUTF16(*text));
    List items;
    ui::TreeNodeIterator<const BookmarkNode> it(model->root_node());
    while (it.has_next() && items.size() < kBookmarkSearchLimit) {
      const BookmarkNode* node = it.Next();
      const std::u16string hay = base::ToLowerASCII(
          node->GetTitle() + u" " +
          (node->is_url() ? base::UTF8ToUTF16(node->url().spec()) : u""));
      if (hay.find(needle) != std::u16string::npos) {
        items.Append(DescribeBookmark(model, node, true));
      }
    }
    Reply(std::move(reply),
          base::Value(Dict()
                          .Set("path", List())
                          .Set("items", std::move(items))
                          .Set("folderId",
                               base::NumberToString(model->other_node()->id()))));
  } else if (method == "bookmarks.edit") {
    const BookmarkNode* node = NodeArg(model, args, "id");
    const std::string* title = args.FindString("title");
    const std::string* url = args.FindString("url");
    if (!Editable(model, node) || !title || title->size() > kMaxText) {
      Fail(std::move(reply), "This bookmark cannot be changed");
      return true;
    }
    GURL target;
    if (node->is_url()) {
      target = GURL(url ? *url : std::string());
      if (!target.is_valid() || target.SchemeIs("javascript")) {
        Fail(std::move(reply), "Enter a valid address");
        return true;
      }
    }
    model->SetTitle(node, base::UTF8ToUTF16(*title), edit);
    if (node->is_url()) {
      model->SetURL(node, target, edit);
    }
    Reply(std::move(reply), base::Value());
  } else if (method == "bookmarks.remove") {
    const BookmarkNode* node = NodeArg(model, args, "id");
    if (!Editable(model, node)) {
      Fail(std::move(reply), "This bookmark cannot be removed");
      return true;
    }
    model->Remove(node, edit, FROM_HERE);
    Reply(std::move(reply), base::Value());
  } else if (method == "bookmarks.createFolder") {
    const BookmarkNode* parent = NodeArg(model, args, "parentId");
    const std::string* title = args.FindString("title");
    if (!parent || !parent->is_folder() || parent == model->root_node() ||
        !title || title->empty() || title->size() > kMaxText) {
      Fail(std::move(reply), "Name the new folder");
      return true;
    }
    model->AddFolder(parent, parent->children().size(),
                     base::UTF8ToUTF16(*title));
    Reply(std::move(reply), base::Value());
  } else if (method == "bookmarks.move") {
    const BookmarkNode* node = NodeArg(model, args, "id");
    const BookmarkNode* parent = NodeArg(model, args, "parentId");
    const auto index = args.FindInt("index");
    if (!Editable(model, node) || !parent || !parent->is_folder() ||
        parent == model->root_node() || parent->HasAncestor(node) || !index ||
        *index < 0 || static_cast<size_t>(*index) > parent->children().size()) {
      Fail(std::move(reply), "The bookmark cannot move there");
      return true;
    }
    model->Move(node, parent, static_cast<size_t>(*index));
    Reply(std::move(reply), base::Value());
  } else {
    Fail(std::move(reply), "Unknown bookmarks request");
  }
  return true;
}

// -- Extensions ---------------------------------------------------------------

bool RunExtensions(BrowserWindowInterface* browser,
                   const std::string& method,
                   const Dict& args,
                   ShellServiceReply& reply) {
  if (!method.starts_with("extensions.")) {
    return false;
  }
  Profile* profile = browser->GetProfile();
  content::WebContents* contents =
      browser->GetTabStripModel()->GetActiveWebContents();
  const int tab_id =
      contents ? extensions::ExtensionTabUtil::GetTabId(contents) : -1;
  auto* registry = extensions::ExtensionRegistry::Get(profile);
  auto* actions = extensions::ExtensionActionManager::Get(profile);
  if (method == "extensions.list") {
    List list = MerlinExtensionList(profile);
    for (auto& value : list) {
      Dict& item = value.GetDict();
      const auto* ext =
          registry->enabled_extensions().GetByID(*item.FindString("id"));
      const auto* action =
          ext && actions ? actions->GetExtensionAction(*ext) : nullptr;
      item.Set("hasAction", !!action);
      item.Set("actionTitle", action && tab_id >= 0 ? action->GetTitle(tab_id)
                                                    : std::string());
    }
    Reply(std::move(reply), base::Value(std::move(list)));
  } else if (method == "extensions.setEnabled") {
    const std::string* id = args.FindString("id");
    const auto enabled = args.FindBool("enabled");
    if (!id || !enabled) {
      Fail(std::move(reply), "Invalid extension setting");
      return true;
    }
    const std::string error = SetMerlinPreference(
        profile, Controller(browser), "extension",
        base::Value(Dict().Set("id", *id).Set("enabled", *enabled)));
    if (error.empty()) {
      Reply(std::move(reply), base::Value());
    } else {
      Fail(std::move(reply), error);
    }
  } else if (method == "extensions.run") {
    const std::string* id = args.FindString("id");
    const auto* ext = id ? registry->enabled_extensions().GetByID(*id) : nullptr;
    auto* runner = contents
                       ? extensions::ExtensionActionRunner::GetForWebContents(
                             contents)
                       : nullptr;
    const auto* action =
        ext && actions ? actions->GetExtensionAction(*ext) : nullptr;
    if (!ext || !runner || !action || tab_id < 0) {
      Fail(std::move(reply), "This extension has no action for this page");
      return true;
    }
    switch (runner->RunAction(ext, /*grant_tab_permissions=*/true)) {
      case extensions::ExtensionAction::ShowAction::kShowPopup:
        // Shown in the window's extension popover; see the snapshot's
        // `extensionPopup`.
        ShowShellExtensionPopup(browser, *ext, action->GetPopupUrl(tab_id));
        break;
      case extensions::ExtensionAction::ShowAction::kToggleSidePanel:
        Fail(std::move(reply), "Side panels are not part of Merlin");
        return true;
      case extensions::ExtensionAction::ShowAction::kNone:
        break;
    }
    Reply(std::move(reply), base::Value());
  } else if (method == "extensions.manage") {
    const std::string* id = args.FindString("id");
    GURL target(id && registry->GetInstalledExtension(*id)
                    ? "chrome://extensions/?id=" + *id
                    : "chrome://extensions/");
    chrome::AddTabAt(browser, target, -1, true);
    Reply(std::move(reply), base::Value());
  } else {
    Fail(std::move(reply), "Unknown extensions request");
  }
  return true;
}

// -- Downloads ----------------------------------------------------------------

bool RunDownloads(BrowserWindowInterface* browser,
                  const std::string& method,
                  const Dict& args,
                  ShellServiceReply& reply) {
  if (method != "downloads.list") {
    return false;
  }
  // Every download the profile remembers, newest first. Window snapshots
  // carry only the running and most recent ones.
  Reply(std::move(reply),
        base::Value(MerlinDownloadsList(browser->GetProfile(),
                                        std::numeric_limits<size_t>::max())));
  return true;
}

// -- Profiles -----------------------------------------------------------------

bool RunProfiles(BrowserWindowInterface* browser,
                 const std::string& method,
                 const Dict& args,
                 ShellServiceReply& reply) {
  if (!method.starts_with("profiles.")) {
    return false;
  }
  ProfileManager* manager = g_browser_process->profile_manager();
  if (!manager) {
    Fail(std::move(reply), "Profiles are not available");
    return true;
  }
  ProfileAttributesStorage& storage = manager->GetProfileAttributesStorage();
  const base::FilePath current =
      browser->GetProfile()->GetOriginalProfile()->GetPath();
  if (method == "profiles.list") {
    List list;
    for (ProfileAttributesEntry* entry :
         storage.GetAllProfilesAttributesSortedByNameWithCheck()) {
      list.Append(Dict()
                      .Set("id", entry->GetPath().AsUTF8Unsafe())
                      .Set("name", entry->GetName())
                      .Set("active", entry->GetPath() == current));
    }
    Reply(std::move(reply), base::Value(std::move(list)));
  } else if (method == "profiles.open") {
    const std::string* id = args.FindString("id");
    const base::FilePath path =
        id ? base::FilePath::FromUTF8Unsafe(*id) : base::FilePath();
    if (!id || !storage.GetProfileAttributesWithPath(path)) {
      Fail(std::move(reply), "That profile no longer exists");
      return true;
    }
    profiles::SwitchToProfile(path, /*always_create=*/false);
    Reply(std::move(reply), base::Value());
  } else if (method == "profiles.create") {
    const std::string* name = args.FindString("name");
    if (!name || name->empty() || name->size() > 64) {
      Fail(std::move(reply), "Name the new profile");
      return true;
    }
    ProfileManager::CreateMultiProfileAsync(
        base::UTF8ToUTF16(*name), profiles::GetPlaceholderAvatarIndex(),
        /*is_hidden=*/false, base::BindOnce([](Profile* profile) {
          if (profile) {
            profiles::SwitchToProfile(profile->GetPath(),
                                      /*always_create=*/true);
          }
        }));
    Reply(std::move(reply), base::Value());
  } else {
    Fail(std::move(reply), "Unknown profiles request");
  }
  return true;
}

}  // namespace

bool RunShellService(BrowserWindowInterface* browser,
                     const std::string& method,
                     const base::DictValue& args,
                     ShellServiceReply reply) {
  if (!browser) {
    Fail(std::move(reply), "Browser window has closed");
    return true;
  }
  return RunSettings(browser, method, args, reply) ||
         RunHistory(browser, method, args, reply) ||
         RunBookmarks(browser, method, args, reply) ||
         RunExtensions(browser, method, args, reply) ||
         RunDownloads(browser, method, args, reply) ||
         RunProfiles(browser, method, args, reply);
}

void ShowShellSiteInfo(BrowserWindowInterface* browser) {
  content::WebContents* contents =
      browser ? browser->GetTabStripModel()->GetActiveWebContents() : nullptr;
  const LocationBarModel* model = browser ? LocationBarModel::From(browser) : nullptr;
  if (!contents || !model) {
    return;
  }
  const GURL url = contents->GetLastCommittedURL();
  const bool web = url.SchemeIsHTTPOrHTTPS();
  std::string message;
  const char* security = "insecure";
  switch (model->GetSecurityLevel()) {
    case security_state::SECURE:
      security = "secure";
      message = "Your connection to this site is private. What you send is "
                "encrypted on its way to the site.";
      break;
    case security_state::DANGEROUS:
      security = "dangerous";
      message = "This site is flagged as dangerous. Do not enter passwords, "
                "payment details or other private information.";
      break;
    default:
      if (!web) {
        security = "internal";
      }
      message = web ? "Your connection to this site is not private. Do not "
                      "enter passwords or payment details."
                : url.SchemeIs(content::kChromeUIScheme)
                    ? "This page is part of Merlin."
                    : "This page does not come from a website.";
      break;
  }
  auto* adblock = merlin_adblock::Service::Get(browser->GetProfile());
  List actions;
  if (web) {
    const auto exceptions = adblock->Exceptions();
    const bool off = std::find(exceptions.begin(), exceptions.end(),
                               url.host()) != exceptions.end();
    message += off ? "\n\nBlocking is off for this site."
                   : "\n\nAds and trackers are blocked on this site.";
    actions.Append(Dict()
                       .Set("id", "blocking")
                       .Set("label", off ? "Turn blocking on" : "Turn blocking off")
                       .Set("emphasis", "normal"));
    actions.Append(Dict()
                       .Set("id", "settings")
                       .Set("label", "Site settings")
                       .Set("emphasis", "normal"));
  }
  actions.Append(
      Dict().Set("id", "done").Set("label", "Done").Set("emphasis", "primary"));
  ShowShellPrompt(
      browser,
      Dict()
          .Set("kind", "alert")
          .Set("anchor", "site")
          .Set("security", security)
          .Set("origin", web ? Host(url) : std::string("Merlin"))
          .Set("title", web ? "About this site" : "About this page")
          .Set("message", message)
          .Set("actions", std::move(actions)),
      base::BindOnce(
          [](base::WeakPtr<BrowserWindowInterface> browser, GURL url,
             ShellPromptReply reply) {
            if (!browser) {
              return;
            }
            if (reply.action == "blocking") {
              merlin_adblock::Service::Get(browser->GetProfile())->ToggleSite(url);
              if (auto* contents =
                      browser->GetTabStripModel()->GetActiveWebContents()) {
                contents->GetController().Reload(content::ReloadType::NORMAL,
                                                 true);
              }
            } else if (reply.action == "settings") {
              chrome::AddTabAt(
                  browser.get(),
                  GURL("chrome://settings/content/siteDetails?site=" +
                       base::EscapeQueryParamValue(
                           url::Origin::Create(url).Serialize(), true)),
                  -1, true);
            }
          },
          browser->GetWeakPtr(), url));
}

}  // namespace modal_browser
