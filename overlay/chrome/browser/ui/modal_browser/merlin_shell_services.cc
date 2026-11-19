// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_shell_services.h"

#include <algorithm>
#include <limits>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/barrier_callback.h"
#include "base/base64.h"
#include "base/files/file_path.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/escape.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/cancelable_task_tracker.h"
#include "base/time/time.h"
#include "base/task/bind_post_task.h"
#include "chrome/browser/bookmarks/bookmark_html_writer.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "chrome/browser/favicon/favicon_service_factory.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/history/history_service_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_tabstrip.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/ui/modal_browser/merlin_downloads.h"
#include "chrome/browser/ui/modal_browser/merlin_page_identity.h"
#include "chrome/browser/ui/modal_browser/merlin_preferences.h"
#include "chrome/browser/ui/modal_browser/merlin_react_extension_popup.h"
#include "chrome/browser/ui/modal_browser/merlin_react_window.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_vocabulary.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "url/origin.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/common/pref_names.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_node.h"
#include "components/bookmarks/browser/bookmark_utils.h"
#include "components/bookmarks/common/bookmark_metrics.h"
#include "components/favicon/core/favicon_service.h"
#include "components/favicon_base/favicon_types.h"
#include "components/history/core/browser/history_service.h"
#include "components/history/core/browser/history_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/prefs/pref_service.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/browsing_data_filter_builder.h"
#include "content/public/browser/browsing_data_remover.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
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
  if (method == shell::method::kSettingsGet) {
    Reply(std::move(reply), base::Value(Preferences(browser)));
  } else if (method == shell::method::kSettingsSet) {
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
  } else if (method == shell::method::kSettingsChooseDownloadDir) {
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
  } else if (method == shell::method::kSettingsConfig) {
    config_file::Read(base::BindOnce(
        [](ShellServiceReply reply, config_file::ReadResult result) {
          Reply(std::move(reply),
                base::Value(
                    Dict()
                        .Set("found", result.found)
                        .Set("text", result.text)
                        .Set("error", result.error)
                        .Set("revision", result.revision)
                        .Set("path", config_file::ConfigPath().AsUTF8Unsafe())));
        },
        std::move(reply)));
  } else if (method == shell::method::kSettingsSaveConfig) {
    const std::string* text = args.FindString("text");
    // The revision the text was edited from: a save never overwrites a
    // change made since (by setOption, another window or another app).
    const std::string* revision = args.FindString("revision");
    if (!text || text->size() > 512 * 1024) {
      Fail(std::move(reply), "The configuration is too large");
      return true;
    }
    if (!revision || revision->empty() || revision->size() > 64) {
      Fail(std::move(reply), "Invalid configuration revision");
      return true;
    }
    config_file::WriteIfUnchanged(
        *text, *revision,
        base::BindOnce(
            [](ShellServiceReply reply, config_file::WriteResult result) {
              if (result.error.empty()) {
                // Every window rereads it; Settings confirms the save.
                ModalBrowserController::ReloadConfigInAllWindows(nullptr);
              }
              Reply(std::move(reply),
                    base::Value(Dict()
                                    .Set("error", result.error)
                                    .Set("revision", result.revision)));
            },
            std::move(reply)));
  } else if (method == shell::method::kSettingsSetOption) {
    // One [options] value from Settings, written into the config file so the
    // file stays the single source of these options.
    const std::string* name = args.FindString("name");
    const base::Value* value = args.Find("value");
    std::string literal;
    const auto& booleans = shell::boolean_option::kAll;
    if (name && value && value->is_bool() &&
        std::ranges::find(booleans, *name) != booleans.end()) {
      literal = value->GetBool() ? "true" : "false";
    } else if (name && value && value->is_string() &&
               *name == shell::string_option::kHintChars &&
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
    // Read, change and write in one step on the file's sequence, so two
    // options set at once both land.
    config_file::Update(
        base::BindOnce(
            [](std::string name, std::string literal, const std::string& text) {
              return config_file::SetOption(text, name, literal);
            },
            *name, std::move(literal)),
        base::BindOnce(
            [](ShellServiceReply reply, config_file::WriteResult result) {
              if (result.error.empty()) {
                ModalBrowserController::ReloadConfigInAllWindows(nullptr);
              }
              Reply(std::move(reply), base::Value(result.error));
            },
            std::move(reply)));
  } else if (method == shell::method::kSettingsWorkspaces) {
    ListWorkspaces(std::move(reply));
  } else if (method == shell::method::kSettingsDeleteWorkspace) {
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
  } else if (method == shell::method::kSettingsOpenPage) {
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

// A page's icon from the history's favicon database, for rows that show a
// page rather than a tab: bookmarks in the bar, the sidebar and the Library,
// and history. A PNG data URL at 32 pixels (sharp at 16 points), the site's
// icon when the page has none of its own, or null.
bool RunFavicons(BrowserWindowInterface* browser,
                 const std::string& method,
                 const base::DictValue& args,
                 ShellServiceReply& reply) {
  if (method != shell::method::kFaviconsPage) {
    return false;
  }
  const std::string* spec = args.FindString("url");
  const GURL url(spec ? *spec : std::string());
  if (!spec || spec->size() > 8192 || !url.is_valid() ||
      !(url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile())) {
    Fail(std::move(reply), "Invalid page address");
    return true;
  }
  favicon::FaviconService* service = FaviconServiceFactory::GetForProfile(
      browser->GetProfile(), ServiceAccessType::EXPLICIT_ACCESS);
  if (!service) {
    Reply(std::move(reply), base::Value());
    return true;
  }
  service->GetRawFaviconForPageURL(
      url, {favicon_base::IconType::kFavicon}, /*desired_size_in_pixel=*/32,
      /*fallback_to_host=*/true,
      base::BindOnce(
          [](ShellServiceReply reply,
             const favicon_base::FaviconRawBitmapResult& result) {
            if (!result.is_valid() || !result.bitmap_data ||
                !result.bitmap_data->size()) {
              Reply(std::move(reply), base::Value());
              return;
            }
            Reply(std::move(reply),
                  base::Value("data:image/png;base64," +
                              base::Base64Encode(base::span<const uint8_t>(*result.bitmap_data))));
          },
          std::move(reply)),
      &HistoryTracker());
  return true;
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
  if (method == shell::method::kHistorySearch) {
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
  } else if (method == shell::method::kHistoryRemove) {
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
  if (method == shell::method::kBookmarksFolder) {
    Reply(std::move(reply),
          base::Value(BookmarkFolder(model, NodeArg(model, args, "folderId"))));
  } else if (method == shell::method::kBookmarksSearch) {
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
  } else if (method == shell::method::kBookmarksEdit) {
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
  } else if (method == shell::method::kBookmarksRemove) {
    const BookmarkNode* node = NodeArg(model, args, "id");
    if (!Editable(model, node)) {
      Fail(std::move(reply), "This bookmark cannot be removed");
      return true;
    }
    model->Remove(node, edit, FROM_HERE);
    Reply(std::move(reply), base::Value());
  } else if (method == shell::method::kBookmarksExport) {
    // Settings > General > Export bookmarks: the shell's save panel chose
    // the file; Chromium writes the bookmarks.html every browser imports.
    const std::string* path = args.FindString("path");
    const base::FilePath file = path ? base::FilePath(*path) : base::FilePath();
    if (!path || path->size() > kMaxText || !file.IsAbsolute() || file.ReferencesParent()) {
      Fail(std::move(reply), "Choose where to save the bookmarks");
      return true;
    }
    bookmark_html_writer::WriteBookmarks(
        browser->GetProfile(), file,
        base::BindPostTask(
            content::GetUIThreadTaskRunner({}),
            base::BindOnce(
                [](ShellServiceReply reply, bookmark_html_writer::Result result) {
                  if (result == bookmark_html_writer::Result::kSuccess) {
                    Reply(std::move(reply), base::Value());
                  } else {
                    Fail(std::move(reply), "The bookmarks could not be saved there");
                  }
                },
                std::move(reply))));
  } else if (method == shell::method::kBookmarksCreateFolder) {
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
  } else if (method == shell::method::kBookmarksMove) {
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
  if (method == shell::method::kExtensionsList) {
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
  } else if (method == shell::method::kExtensionsSetEnabled) {
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
  } else if (method == shell::method::kExtensionsRun) {
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
  } else if (method == shell::method::kExtensionsManage) {
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
  if (method != shell::method::kDownloadsList) {
    return false;
  }
  // Every download the profile remembers, newest first. Window snapshots
  // carry only the running and most recent ones.
  Reply(std::move(reply),
        base::Value(MerlinDownloadsList(browser->GetProfile(),
                                        std::numeric_limits<size_t>::max())));
  return true;
}

// -- Browsing data ------------------------------------------------------------

// Runs one Chromium removal and answers `done` once: empty, or what failed.
// Owns itself until the remover reports. The remover tells only the
// observers registered with it, so this one observes it meanwhile.
class ChromiumClearing : public content::BrowsingDataRemover::Observer {
 public:
  static void Start(Profile* profile,
                    base::Time since,
                    uint64_t mask,
                    std::unique_ptr<content::BrowsingDataFilterBuilder> filter,
                    base::OnceCallback<void(std::string)> done) {
    content::BrowsingDataRemover* remover = profile->GetBrowsingDataRemover();
    auto* clearing = new ChromiumClearing(remover, std::move(done));
    remover->RemoveWithFilterAndReply(
        since, base::Time::Max(), mask,
        content::BrowsingDataRemover::ORIGIN_TYPE_UNPROTECTED_WEB,
        std::move(filter), clearing);
  }

  void OnBrowsingDataRemoverDone(uint64_t failed_data_types) override {
    observation_.Reset();
    std::move(done_).Run(failed_data_types
                             ? "Some of Chromium's data could not be cleared."
                             : std::string());
    delete this;
  }

 private:
  ChromiumClearing(content::BrowsingDataRemover* remover,
                   base::OnceCallback<void(std::string)> done)
      : done_(std::move(done)) {
    observation_.Observe(remover);
  }
  ~ChromiumClearing() override = default;

  base::OnceCallback<void(std::string)> done_;
  base::ScopedObservation<content::BrowsingDataRemover,
                          content::BrowsingDataRemover::Observer>
      observation_{this};
};

// Clears both engines' data together: Chromium's for the window's profile,
// and WebKit's pages' (the normal store, or the private session for a
// private window). `domain` limits it to one site's data (all time);
// empty is every site since `since`. `done` gets one result for both:
// empty, or what failed.
void ClearBothEngines(Profile* profile,
                      base::Time since,
                      const std::vector<std::string>& types,
                      const std::string& domain,
                      base::OnceCallback<void(std::string)> done) {
  uint64_t mask = 0;
  List webkit_types;
  for (const std::string& type : types) {
    if (type == shell::clear_data_type::kHistory) {
      mask |= chrome_browsing_data_remover::DATA_TYPE_HISTORY;
    } else if (type == shell::clear_data_type::kCookies) {
      mask |= chrome_browsing_data_remover::DATA_TYPE_SITE_DATA;
      webkit_types.Append(type);
    } else if (type == shell::clear_data_type::kCache) {
      mask |= content::BrowsingDataRemover::DATA_TYPE_CACHE;
      webkit_types.Append(type);
    }
  }
  auto both = base::BarrierCallback<std::string>(
      2, base::BindOnce(
             [](base::OnceCallback<void(std::string)> done,
                std::vector<std::string> errors) {
               std::erase(errors, std::string());
               std::move(done).Run(base::JoinString(errors, " "));
             },
             std::move(done)));
  auto filter = content::BrowsingDataFilterBuilder::Create(
      domain.empty() ? content::BrowsingDataFilterBuilder::Mode::kPreserve
                     : content::BrowsingDataFilterBuilder::Mode::kDelete);
  if (!domain.empty()) {
    filter->AddRegisterableDomain(domain);
  }
  ChromiumClearing::Start(profile, domain.empty() ? since : base::Time(), mask,
                          std::move(filter), both);
  if (webkit_types.empty()) {
    both.Run(std::string());
    return;
  }
  Dict request;
  request.Set("since", domain.empty() && !since.is_null()
                           ? since.InSecondsFSinceUnixEpoch()
                           : 0.0);
  request.Set("types", std::move(webkit_types));
  if (!domain.empty()) {
    request.Set("site", domain);
  }
  request.Set("private", profile->IsOffTheRecord());
  ClearWebKitData(
      base::WriteJson(request).value_or("{}"),
      base::BindOnce(
          [](base::OnceCallback<void(std::string)> both, std::string error) {
            std::move(both).Run(error.empty()
                                    ? error
                                    : "WebKit's data could not be cleared: " +
                                          error);
          },
          both));
}

// The domain a site's data is kept under: its registrable domain
// ("netflix.com" for www.netflix.com), or the host itself when it has none
// (localhost, an IP address), as Chromium's and WebKit's records name it.
std::string DataDomain(const GURL& url) {
  std::string domain = net::registry_controlled_domains::GetDomainAndRegistry(
      url, net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES);
  return domain.empty() ? std::string(url.host()) : domain;
}

bool RunBrowsingData(BrowserWindowInterface* browser,
                     const std::string& method,
                     const Dict& args,
                     ShellServiceReply& reply) {
  if (method != shell::method::kPrivacyClearData) {
    return false;
  }
  const List* list = args.FindList("types");
  if (!list) {
    Fail(std::move(reply), "Choose what to clear");
    return true;
  }
  std::vector<std::string> types;
  for (const base::Value& type : *list) {
    if (!type.is_string() ||
        !std::ranges::contains(shell::clear_data_type::kAll, type.GetString())) {
      Fail(std::move(reply), "Unknown kind of browsing data");
      return true;
    }
    types.push_back(type.GetString());
  }
  if (types.empty()) {
    Fail(std::move(reply), "Choose what to clear");
    return true;
  }
  const std::optional<double> since = args.FindDouble("since");
  const std::string* site = args.FindString("site");
  std::string domain;
  if (site && !site->empty()) {
    const GURL url("https://" + *site + "/");
    if (!url.is_valid() || url.host() != *site) {
      Fail(std::move(reply), "Invalid site");
      return true;
    }
    if (std::ranges::contains(types, shell::clear_data_type::kHistory)) {
      Fail(std::move(reply), "A site's history can't be cleared this way");
      return true;
    }
    domain = DataDomain(url);
  }
  ClearBothEngines(
      browser->GetProfile(),
      since && *since > 0 ? base::Time::FromSecondsSinceUnixEpoch(*since)
                          : base::Time(),
      types, domain,
      base::BindOnce(
          [](ShellServiceReply reply, std::string error) {
            if (error.empty()) {
              Reply(std::move(reply), base::Value());
            } else {
              Fail(std::move(reply), std::move(error));
            }
          },
          std::move(reply)));
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
         RunFavicons(browser, method, args, reply) ||
         RunBookmarks(browser, method, args, reply) ||
         RunExtensions(browser, method, args, reply) ||
         RunDownloads(browser, method, args, reply) ||
         RunBrowsingData(browser, method, args, reply);
}

namespace {

const char* ProtectionName(merlin_adblock::Protection state) {
  switch (state) {
    case merlin_adblock::Protection::kEnabled:
      return shell::protection::kEnabled;
    case merlin_adblock::Protection::kDisabledGlobally:
      return shell::protection::kDisabledGlobally;
    case merlin_adblock::Protection::kSiteException:
      return shell::protection::kSiteException;
    case merlin_adblock::Protection::kNotReady:
      return shell::protection::kNotReady;
    case merlin_adblock::Protection::kDegraded:
      return shell::protection::kDegraded;
    case merlin_adblock::Protection::kNotApplicable:
      return shell::protection::kNotApplicable;
  }
}

// Asks before removing a site's cookies, site data and cache from both
// engines, then says what happened.
void ConfirmForgetSite(BrowserWindowInterface* browser, const GURL& url) {
  const std::string domain = DataDomain(url);
  ShowShellPrompt(
      browser,
      Dict()
          .Set("kind", "confirm")
          .Set("anchor", "site")
          .Set("origin", domain)
          .Set("title", "Forget " + domain + "?")
          .Set("message",
               "Its cookies, site data and cached files are removed from "
               "Chromium and WebKit, and you are signed out of it. Your "
               "history, bookmarks and downloads stay.")
          .Set("actions",
               List()
                   .Append(Dict()
                               .Set("id", "cancel")
                               .Set("label", "Cancel")
                               .Set("emphasis", "normal"))
                   .Append(Dict()
                               .Set("id", "forget")
                               .Set("label", "Forget")
                               .Set("emphasis", "danger"))),
      base::BindOnce(
          [](base::WeakPtr<BrowserWindowInterface> browser,
             std::string domain, ShellPromptReply reply) {
            if (!browser || reply.action != "forget") {
              return;
            }
            ClearBothEngines(
                browser->GetProfile(), base::Time(),
                {shell::clear_data_type::kCookies,
                 shell::clear_data_type::kCache},
                domain,
                base::BindOnce(
                    [](base::WeakPtr<BrowserWindowInterface> browser,
                       std::string domain, std::string error) {
                      ModalBrowserController* controller =
                          browser ? Controller(browser.get()) : nullptr;
                      if (!controller) {
                        return;
                      }
                      if (error.empty()) {
                        controller->ShowMessage(ffi::MessageLevel::Info,
                                                "Forgot " + domain);
                      } else {
                        controller->ShowMessage(ffi::MessageLevel::Error,
                                                error);
                      }
                    },
                    browser, domain));
          },
          browser->GetWeakPtr(), domain));
}

}  // namespace

void ShowShellSiteInfo(BrowserWindowInterface* browser) {
  content::WebContents* contents =
      browser ? browser->GetTabStripModel()->GetActiveWebContents() : nullptr;
  if (!contents) {
    return;
  }
  // A tab shown in WebKit: Chromium knows neither its connection nor its
  // blocking, only which site it is, so the panel says that much.
  if (ShowsWebKit(contents)) {
    const GURL url = GetVisiblePage(contents).url;
    ShowShellPrompt(
        browser,
        Dict()
            .Set("kind", "alert")
            .Set("anchor", "site")
            .Set("origin", FormatShellDisplayUrl(url).host)
            .Set("title", "About this site")
            .Set("message",
                 "This page is shown in WebKit, macOS's own engine, so its "
                 "protected video plays. WebKit keeps its own sign-ins, and "
                 "Merlin's ad blocker doesn't reach it.")
            .Set("actions", List()
                                .Append(Dict()
                                            .Set("id", "forget")
                                            .Set("label", "Forget this site")
                                            .Set("emphasis", "normal"))
                                .Append(Dict()
                                            .Set("id", "done")
                                            .Set("label", "Done")
                                            .Set("emphasis", "primary"))),
        base::BindOnce(
            [](base::WeakPtr<BrowserWindowInterface> browser, GURL url,
               ShellPromptReply reply) {
              if (browser && reply.action == "forget") {
                ConfirmForgetSite(browser.get(), url);
              }
            },
            browser->GetWeakPtr(), url));
    return;
  }
  const GURL url = contents->GetLastCommittedURL();
  const bool web = url.SchemeIsHTTPOrHTTPS();
  // The same state the address field and tabs show (merlin_urls.h).
  const std::string security = ShellSecurityState(contents);
  std::string message;
  if (security == shell::security::kSecure) {
    message = "Your connection to this site is private. What you send is "
              "encrypted on its way to the site.";
  } else if (security == shell::security::kDangerous) {
    message = "This site is flagged as dangerous, or its certificate is not "
              "valid. Do not enter passwords, payment details or other "
              "private information.";
  } else if (security == shell::security::kPending) {
    message = "This page is still opening. Merlin can say whether the "
              "connection is private once it has loaded.";
  } else if (web) {
    message = "Your connection to this site is not private. Do not enter "
              "passwords or payment details.";
  } else {
    message = url.SchemeIs(content::kChromeUIScheme)
                  ? "This page is part of Merlin."
                  : "This page does not come from a website.";
  }
  // What blocking really does here, not just whether the host is excepted:
  // it can be off everywhere, have no lists, or still be loading.
  const merlin_adblock::ProtectionState protection =
      merlin_adblock::Service::Get(browser->GetProfile())
          ->EffectiveProtection(url);
  List actions;
  if (web) {
    message += "\n\n" + protection.reason;
    switch (protection.state) {
      case merlin_adblock::Protection::kDisabledGlobally:
        actions.Append(Dict()
                           .Set("id", "adblock-settings")
                           .Set("label", "Ad blocking settings")
                           .Set("emphasis", "normal"));
        break;
      case merlin_adblock::Protection::kSiteException:
        actions.Append(Dict()
                           .Set("id", "blocking")
                           .Set("label", "Turn blocking on")
                           .Set("emphasis", "normal"));
        break;
      case merlin_adblock::Protection::kEnabled:
      case merlin_adblock::Protection::kNotReady:
      case merlin_adblock::Protection::kDegraded:
        actions.Append(Dict()
                           .Set("id", "blocking")
                           .Set("label", "Turn blocking off")
                           .Set("emphasis", "normal"));
        break;
      case merlin_adblock::Protection::kNotApplicable:
        break;
    }
    actions.Append(Dict()
                       .Set("id", "settings")
                       .Set("label", "Site settings")
                       .Set("emphasis", "normal"));
    actions.Append(Dict()
                       .Set("id", "forget")
                       .Set("label", "Forget this site")
                       .Set("emphasis", "normal"));
  }
  actions.Append(
      Dict().Set("id", "done").Set("label", "Done").Set("emphasis", "primary"));
  // The answer acts on the tab and page the panel describes, even if
  // another tab is active by then or this one has moved on.
  tabs::TabInterface* tab = tabs::TabInterface::MaybeGetFromContents(contents);
  const tabs::TabHandle handle = tab ? tab->GetHandle() : tabs::TabHandle();
  const content::WeakDocumentPtr document =
      contents->GetPrimaryMainFrame()->GetWeakDocumentPtr();
  ShowShellPrompt(
      browser,
      Dict()
          .Set("kind", "alert")
          .Set("anchor", "site")
          .Set("security", security)
          .Set("protection", ProtectionName(protection.state))
          .Set("origin", web ? FormatShellDisplayUrl(url).host : std::string("Merlin"))
          .Set("title", web ? "About this site" : "About this page")
          .Set("message", message)
          .Set("actions", std::move(actions)),
      base::BindOnce(
          [](base::WeakPtr<BrowserWindowInterface> browser, GURL url,
             tabs::TabHandle handle, content::WeakDocumentPtr document,
             ShellPromptReply reply) {
            if (!browser) {
              return;
            }
            if (reply.action == "blocking") {
              merlin_adblock::Service::Get(browser->GetProfile())->ToggleSite(url);
              // Reload only that tab, and only while it still shows the
              // page the panel was opened for.
              tabs::TabInterface* tab = handle.Get();
              content::WebContents* contents =
                  tab ? tab->GetContents() : nullptr;
              content::RenderFrameHost* frame =
                  document.AsRenderFrameHostIfValid();
              if (contents && frame &&
                  frame == contents->GetPrimaryMainFrame()) {
                contents->GetController().Reload(content::ReloadType::NORMAL,
                                                 true);
              }
            } else if (reply.action == "forget") {
              ConfirmForgetSite(browser.get(), url);
            } else if (reply.action == "adblock-settings") {
              OpenShellPanel(browser.get(), shell::panel::kSettings);
            } else if (reply.action == "settings") {
              chrome::AddTabAt(
                  browser.get(),
                  GURL("chrome://settings/content/siteDetails?site=" +
                       base::EscapeQueryParamValue(
                           url::Origin::Create(url).Serialize(), true)),
                  -1, true);
            }
          },
          browser->GetWeakPtr(), url, handle, document));
}

}  // namespace modal_browser
