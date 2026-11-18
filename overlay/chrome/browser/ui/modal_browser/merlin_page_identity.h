// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_IDENTITY_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_IDENTITY_H_

#include <optional>
#include <string>

#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/gurl.h"

namespace modal_browser {

// The page a tab shows. The React shell shows some sites in WebKit in the
// place of Chromium's own page, which then waits on the page before it
// (apps/browser/src/state/webkit.ts). Everything native that describes or
// saves "the tab's page" (bookmarks, workspaces, browserctl, the yank and
// relative navigation commands, session restore) reads it through
// GetVisiblePage, never the hidden Chromium page.
struct VisiblePage {
  GURL url;
  std::u16string title;
  // Shown in WebKit: page commands that run in Chromium's page can't act on it.
  bool webkit = false;
};

VisiblePage GetVisiblePage(content::WebContents* contents);

// Whether the shell shows the tab in WebKit, or will once it claims a
// WebKit page restored with the session.
bool ShowsWebKit(content::WebContents* contents);

// The WebKit page a tab showed when Merlin last quit, restored with the
// session and not yet shown again: the shell reopens it in WebKit.
std::optional<VisiblePage> RestoredWebKitPage(content::WebContents* contents);

// What the shell shows of one tab in WebKit (tabs.setEngineOverlay). It is
// kept on Chromium's current navigation entry too, so the session saves it.
class PageIdentity : public content::WebContentsUserData<PageIdentity>,
                     public content::WebContentsObserver {
 public:
  ~PageIdentity() override;

  // The shell shows the tab in WebKit at `url`, titled `title`.
  static void Show(content::WebContents* contents,
                   const GURL& url,
                   const std::u16string& title);
  // The tab shows Chromium's page again; a restored WebKit page is dropped.
  static void Clear(content::WebContents* contents);

  const GURL& url() const { return url_; }
  const std::u16string& title() const { return title_; }

  // content::WebContentsObserver:
  void NavigationEntryCommitted(
      const content::LoadCommittedDetails& details) override;

 private:
  friend class content::WebContentsUserData<PageIdentity>;
  explicit PageIdentity(content::WebContents* contents);

  // Keeps the identity on the current entry only.
  void Record();

  GURL url_;
  std::u16string title_;
  int recorded_entry_ = 0;

  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

// Bookmarks the page WebKit shows in `contents`, if it shows one (Chromium's
// own bookmarking would save the hidden page). Returns whether it did.
bool BookmarkWebKitPage(content::WebContents* contents);

// Saves and restores a tab's WebKit page with Chromium's session, as extended
// info on its navigation entries. Call before any session is restored, and
// after Chrome has installed its navigation driver (ChromeBrowserMainParts
// does, before any browser window): a handler registered earlier is lost.
void RegisterWebKitSessionData();

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_PAGE_IDENTITY_H_
