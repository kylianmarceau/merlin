// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_auto_pip.h"

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/time/time.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/prefs/pref_service.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/media_session.h"
#include "content/public/browser/web_contents.h"

namespace modal_browser {

namespace {

// Long enough for a tab switch to settle (a closed tab, a split forming),
// short enough that the video doesn't visibly stop.
constexpr base::TimeDelta kFloatDelay = base::Milliseconds(150);

// The page Merlin floated: its video goes back when the tab is shown again.
base::WeakPtr<content::WebContents>& Floated() {
  static base::NoDestructor<base::WeakPtr<content::WebContents>> floated;
  return *floated;
}

// Whether the window shows `contents`: the active tab, or the other half of
// its split.
bool OnScreen(TabStripModel* strip, content::WebContents* contents) {
  const int active = strip->active_index();
  const int index = strip->GetIndexOfWebContents(contents);
  if (active < 0 || index == TabStripModel::kNoTab) {
    return false;
  }
  if (index == active) {
    return true;
  }
  const auto split = strip->GetSplitForTab(active);
  return split && strip->GetSplitForTab(index) == split;
}

void MaybeFloat(base::WeakPtr<content::WebContents> weak) {
  content::WebContents* contents = weak.get();
  tabs::TabInterface* tab =
      contents ? tabs::TabInterface::MaybeGetFromContents(contents) : nullptr;
  BrowserWindowInterface* browser =
      tab ? tab->GetBrowserWindowInterface() : nullptr;
  if (!browser || browser->GetType() != BrowserWindowInterface::TYPE_NORMAL ||
      !browser->GetProfile()->GetPrefs()->GetBoolean(kAutoPipPref) ||
      OnScreen(browser->GetTabStripModel(), contents)) {
    return;
  }
  // Only video someone is watching: playing and with its sound on. A muted
  // autoplaying banner stays where it is.
  if (contents->GetCurrentlyPlayingVideoCount() == 0 ||
      !contents->IsCurrentlyAudible() || contents->HasPictureInPictureVideo() ||
      contents->HasPictureInPictureDocument()) {
    return;
  }
  // One floating window at a time, and never in place of the user's own.
  if (PictureInPictureWindowManager::GetInstance()->GetWebContents()) {
    return;
  }
  // The page's own "enterpictureinpicture" handler if it has one, else its
  // video (MediaSessionImpl::EnterPictureInPicture).
  content::MediaSession::Get(contents)->EnterPictureInPicture();
  Floated() = contents->GetWeakPtr();
}

void MaybeReturn(base::WeakPtr<content::WebContents> weak) {
  content::WebContents* contents = weak.get();
  if (!contents || Floated().get() != contents) {
    return;
  }
  Floated().reset();
  auto* manager = PictureInPictureWindowManager::GetInstance();
  if (manager->GetWebContents() == contents) {
    manager->ExitPictureInPicture();
  }
}

}  // namespace

void MerlinAutoPipActiveTabChanged(content::WebContents* previous,
                                   content::WebContents* current) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  auto runner = content::GetUIThreadTaskRunner({});
  // Not inside the tab strip's notification: opening or closing a window
  // can change the strip.
  if (current && Floated().get() == current) {
    runner->PostTask(FROM_HERE,
                     base::BindOnce(&MaybeReturn, current->GetWeakPtr()));
  }
  if (previous && previous != current) {
    runner->PostDelayedTask(FROM_HERE,
                            base::BindOnce(&MaybeFloat, previous->GetWeakPtr()),
                            kFloatDelay);
  }
}

}  // namespace modal_browser
