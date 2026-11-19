// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_page_identity.h"

#include <memory>
#include <utility>

#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/location.h"
#include "base/strings/utf_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/values.h"
#include "chrome/browser/bookmarks/bookmark_model_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "components/bookmarks/browser/bookmark_model.h"
#include "components/bookmarks/browser/bookmark_utils.h"
#include "components/sessions/content/content_serialized_navigation_driver.h"
#include "components/sessions/content/extended_info_handler.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"

namespace modal_browser {

namespace {

// The key in the session file; it must never change.
constexpr char kSessionKey[] = "merlin_webkit";
constexpr size_t kMaxUrl = 8 * 1024;
constexpr size_t kMaxTitle = 1024;

bool Usable(const GURL& url) {
  return url.is_valid() && url.SchemeIsHTTPOrHTTPS() &&
         url.spec().size() <= kMaxUrl;
}

// The WebKit page shown in place of this entry's page.
class WebKitEntry : public base::SupportsUserData::Data {
 public:
  WebKitEntry(GURL url, std::u16string title)
      : url(std::move(url)), title(std::move(title)) {}
  std::unique_ptr<Data> Clone() override {
    return std::make_unique<WebKitEntry>(url, title);
  }
  GURL url;
  std::u16string title;
};

WebKitEntry* EntryData(content::NavigationEntry* entry) {
  return entry ? static_cast<WebKitEntry*>(entry->GetUserData(kSessionKey))
               : nullptr;
}

content::NavigationEntry* CurrentEntry(content::WebContents* contents) {
  content::NavigationController& controller = contents->GetController();
  // A restored tab that hasn't loaded yet has no committed entry of its own
  // making, but its restored current entry is its last committed one.
  content::NavigationEntry* entry = controller.GetLastCommittedEntry();
  return entry ? entry : controller.GetVisibleEntry();
}

content::NavigationEntry* EntryWithID(content::NavigationController& controller,
                                      int id) {
  for (int i = 0; id && i < controller.GetEntryCount(); ++i) {
    if (controller.GetEntryAtIndex(i)->GetUniqueID() == id) {
      return controller.GetEntryAtIndex(i);
    }
  }
  return nullptr;
}

class WebKitSessionHandler : public sessions::ExtendedInfoHandler {
 public:
  std::string GetExtendedInfo(content::NavigationEntry* entry) const override {
    const WebKitEntry* data = EntryData(entry);
    if (!data) {
      return std::string();
    }
    return base::WriteJson(base::DictValue()
                               .Set("url", data->url.spec())
                               .Set("title", base::UTF16ToUTF8(data->title)))
        .value_or(std::string());
  }

  void RestoreExtendedInfo(const std::string& info,
                           content::NavigationEntry* entry) override {
    std::optional<base::Value> value = base::JSONReader::Read(info, 0);
    const base::DictValue* dict = value ? value->GetIfDict() : nullptr;
    const std::string* url = dict ? dict->FindString("url") : nullptr;
    const std::string* title = dict ? dict->FindString("title") : nullptr;
    if (!url || !Usable(GURL(*url))) {
      return;
    }
    entry->SetUserData(
        kSessionKey,
        std::make_unique<WebKitEntry>(
            GURL(*url), base::UTF8ToUTF16(title ? title->substr(
                                                      0, kMaxTitle)
                                                : std::string())));
  }
};

}  // namespace

VisiblePage GetVisiblePage(content::WebContents* contents) {
  if (!contents) {
    return {};
  }
  if (const PageIdentity* identity = PageIdentity::FromWebContents(contents)) {
    return {identity->url(), identity->title(), true};
  }
  if (std::optional<VisiblePage> restored = RestoredWebKitPage(contents)) {
    return *restored;
  }
  return {contents->GetVisibleURL(), contents->GetTitle(), false};
}

bool ShowsWebKit(content::WebContents* contents) {
  return contents && (PageIdentity::FromWebContents(contents) ||
                      RestoredWebKitPage(contents));
}

std::optional<VisiblePage> RestoredWebKitPage(content::WebContents* contents) {
  if (!contents || PageIdentity::FromWebContents(contents)) {
    return std::nullopt;
  }
  const WebKitEntry* data = EntryData(CurrentEntry(contents));
  if (!data) {
    return std::nullopt;
  }
  return VisiblePage{data->url, data->title, true};
}

PageIdentity::PageIdentity(content::WebContents* contents)
    : content::WebContentsUserData<PageIdentity>(*contents),
      content::WebContentsObserver(contents) {}

PageIdentity::~PageIdentity() = default;

// static
void PageIdentity::Show(content::WebContents* contents,
                        const GURL& url,
                        const std::u16string& title) {
  if (!contents || !Usable(url)) {
    return;
  }
  PageIdentity::CreateForWebContents(contents);
  PageIdentity* identity = PageIdentity::FromWebContents(contents);
  identity->url_ = url;
  identity->title_ = title.substr(0, kMaxTitle);
  identity->Record();
}

// static
void PageIdentity::Clear(content::WebContents* contents) {
  if (!contents) {
    return;
  }
  content::NavigationController& controller = contents->GetController();
  auto forget = [&controller](content::NavigationEntry* entry) {
    if (EntryData(entry)) {
      entry->RemoveUserData(kSessionKey);
      controller.NotifyEntryChanged(entry);
    }
  };
  if (PageIdentity* identity = PageIdentity::FromWebContents(contents)) {
    forget(EntryWithID(controller, identity->recorded_entry_));
  }
  forget(CurrentEntry(contents));
  contents->RemoveUserData(UserDataKey());
}

void PageIdentity::Record() {
  content::NavigationController& controller = web_contents()->GetController();
  content::NavigationEntry* entry = CurrentEntry(web_contents());
  if (!entry) {
    return;
  }
  if (recorded_entry_ && recorded_entry_ != entry->GetUniqueID()) {
    if (content::NavigationEntry* old =
            EntryWithID(controller, recorded_entry_);
        old && EntryData(old)) {
      old->RemoveUserData(kSessionKey);
      controller.NotifyEntryChanged(old);
    }
  }
  recorded_entry_ = entry->GetUniqueID();
  const WebKitEntry* data = EntryData(entry);
  if (data && data->url == url_ && data->title == title_) {
    return;
  }
  entry->SetUserData(kSessionKey, std::make_unique<WebKitEntry>(url_, title_));
  // A WebKit page over Chromium's blank page lends that page its title, so
  // the Tab menu, Window menu and History › Recently Closed name the site
  // rather than "about:blank". A real page underneath keeps its own title:
  // the history saves it under that page's address.
  if (entry->GetURL().IsAboutBlank() && !title_.empty() && entry->GetTitle() != title_) {
    web_contents()->UpdateTitleForEntry(entry, title_);
  }
  // The session service writes an entry again when it hears it changed.
  controller.NotifyEntryChanged(entry);
}

void PageIdentity::DidStartNavigation(content::NavigationHandle* navigation) {
  if (navigation->IsInPrimaryMainFrame()) {
    user_initiated_ = !navigation->IsRendererInitiated();
  }
}

void PageIdentity::NavigationEntryCommitted(
    const content::LoadCommittedDetails& details) {
  // Chromium's page moved (back off the site, say): the record moves with it.
  Record();
}

bool BookmarkWebKitPage(content::WebContents* contents) {
  if (!ShowsWebKit(contents)) {
    return false;
  }
  const VisiblePage page = GetVisiblePage(contents);
  bookmarks::BookmarkModel* model = BookmarkModelFactory::GetForBrowserContext(
      contents->GetBrowserContext());
  if (!model || !model->loaded()) {
    return false;
  }
  bookmarks::AddIfNotBookmarked(
      model, page.url, page.title.empty() ? base::UTF8ToUTF16(page.url.host())
                                          : page.title);
  return true;
}

namespace {
// Web pages and files; never a start page or an internal page.
bool Bookmarkable(const GURL& url) {
  return url.is_valid() && (url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile());
}
bookmarks::BookmarkModel* LoadedBookmarks(content::WebContents* contents) {
  bookmarks::BookmarkModel* model =
      BookmarkModelFactory::GetForBrowserContext(contents->GetBrowserContext());
  return model && model->loaded() ? model : nullptr;
}
}  // namespace

bool IsPageBookmarked(content::WebContents* contents) {
  if (!contents) {
    return false;
  }
  bookmarks::BookmarkModel* model = LoadedBookmarks(contents);
  const GURL url = GetVisiblePage(contents).url;
  return model && Bookmarkable(url) && model->IsBookmarked(url);
}

bool SetPageBookmarked(content::WebContents* contents, bool bookmarked) {
  if (!contents) {
    return false;
  }
  bookmarks::BookmarkModel* model = LoadedBookmarks(contents);
  const VisiblePage page = GetVisiblePage(contents);
  if (!model || !Bookmarkable(page.url)) {
    return false;
  }
  if (!bookmarked) {
    bookmarks::RemoveAllBookmarks(model, page.url, FROM_HERE);
    return true;
  }
  if (model->IsBookmarked(page.url)) {
    return true;
  }
  const bookmarks::BookmarkNode* bar = model->bookmark_bar_node();
  model->AddNewURL(bar, bar->children().size(),
                   page.title.empty() ? base::UTF8ToUTF16(page.url.host())
                                      : page.title,
                   page.url);
  return true;
}

void RegisterWebKitSessionData() {
  static bool registered = false;
  if (registered) {
    return;
  }
  registered = true;
  sessions::ContentSerializedNavigationDriver::GetInstance()
      ->RegisterExtendedInfoHandler(kSessionKey,
                                    std::make_unique<WebKitSessionHandler>());
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(PageIdentity);

}  // namespace modal_browser
