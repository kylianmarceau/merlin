// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_tab_switcher.h"

#import <AppKit/AppKit.h>
#include <Carbon/Carbon.h>  // kVK_* key codes

#include <algorithm>
#include <optional>
#include <utility>

#include "base/base64.h"
#include "base/functional/bind.h"
#include "base/location.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/thumbnails/thumbnail_image.h"
#include "chrome/browser/ui/thumbnails/thumbnail_tab_helper.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/web_contents.h"

namespace modal_browser {

// A local monitor sees this app's key events before any window does, so the
// page never gets Escape, Return or the arrows while the cards are up, and
// the Control release arrives wherever the focus is. Callbacks are posted,
// never run inside the monitor: they may destroy it.
class TabSwitcher::KeyWatch {
 public:
  KeyWatch(base::RepeatingClosure released,
           base::RepeatingCallback<void(Key)> key)
      : released_(std::move(released)), key_(std::move(key)) {
    base::WeakPtr<KeyWatch> weak = weak_factory_.GetWeakPtr();
    monitor_ = [NSEvent
        addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged |
                                             NSEventMaskKeyDown
                                     handler:^NSEvent*(NSEvent* event) {
                                       KeyWatch* self = weak.get();
                                       return self && self->Handle(event)
                                                  ? nil
                                                  : event;
                                     }];
  }
  ~KeyWatch() {
    if (monitor_) {
      [NSEvent removeMonitor:monitor_];
    }
  }
  static bool ControlDown() {
    return NSEvent.modifierFlags & NSEventModifierFlagControl;
  }

 private:
  bool Handle(NSEvent* event) {
    if (event.type == NSEventTypeFlagsChanged) {
      if (!(event.modifierFlags & NSEventModifierFlagControl)) {
        base::SequencedTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
                                                                 released_);
      }
      return false;
    }
    std::optional<Key> key;
    switch (event.keyCode) {
      case kVK_Escape: key = Key::kEscape; break;
      case kVK_Return:
      case kVK_ANSI_KeypadEnter: key = Key::kReturn; break;
      case kVK_LeftArrow: key = Key::kLeft; break;
      case kVK_RightArrow: key = Key::kRight; break;
      case kVK_UpArrow: key = Key::kUp; break;
      case kVK_DownArrow: key = Key::kDown; break;
      default: return false;
    }
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(key_, *key));
    return true;
  }

  base::RepeatingClosure released_;
  base::RepeatingCallback<void(Key)> key_;
  id __strong monitor_ = nil;
  base::WeakPtrFactory<KeyWatch> weak_factory_{this};
};

TabSwitcher::TabSwitcher(BrowserWindowInterface* browser,
                         base::RepeatingClosure changed)
    : browser_(browser), changed_(std::move(changed)) {}

TabSwitcher::~TabSwitcher() = default;

std::vector<tabs::TabHandle> TabSwitcher::OrderedTabs() const {
  TabStripModel* strip = browser_->GetTabStripModel();
  std::vector<tabs::TabHandle> tabs;
  const int active = strip->active_index();
  if (active < 0) {
    return tabs;
  }
  if (recent_) {
    std::vector<std::pair<base::TimeTicks, int>> by_time;
    for (int i = 0; i < strip->count(); ++i) {
      // The active tab first, then the others from the most recently shown.
      by_time.emplace_back(i == active ? base::TimeTicks::Max()
                                       : strip->GetWebContentsAt(i)
                                             ->GetLastActiveTimeTicks(),
                           i);
    }
    std::stable_sort(by_time.begin(), by_time.end(),
                     [](const auto& a, const auto& b) { return a.first > b.first; });
    for (const auto& [time, index] : by_time) {
      tabs.push_back(strip->GetTabAtIndex(index)->GetHandle());
    }
  } else {
    // Tab strip order, starting at the active tab.
    for (int i = 0; i < strip->count(); ++i) {
      tabs.push_back(
          strip->GetTabAtIndex((active + i) % strip->count())->GetHandle());
    }
  }
  return tabs;
}

void TabSwitcher::Cycle(bool forward) {
  if (open_) {
    Move(forward ? 1 : -1);
    return;
  }
  recent_ = browser_->GetProfile()->GetPrefs()->GetBoolean(prefs::kCtrlTabMru);
  order_ = OrderedTabs();
  if (order_.size() < 2) {
    order_.clear();
    return;
  }
  selected_ = forward ? 1 : static_cast<int>(order_.size()) - 1;
  // From a menu or with Control already up: switch at once.
  if (!KeyWatch::ControlDown()) {
    open_ = true;
    Commit();
    return;
  }
  open_ = true;
  base::WeakPtr<TabSwitcher> weak = weak_factory_.GetWeakPtr();
  key_watch_ = std::make_unique<KeyWatch>(
      base::BindRepeating(&TabSwitcher::CheckControl, weak),
      base::BindRepeating(&TabSwitcher::OnKey, weak));
  control_poll_.Start(FROM_HERE, base::Milliseconds(50),
                      base::BindRepeating(&TabSwitcher::CheckControl, weak));
  show_timer_.Start(FROM_HERE, kShowDelay,
                    base::BindOnce(&TabSwitcher::ShowCards, weak));
}

void TabSwitcher::Move(int delta) {
  const int count = static_cast<int>(order_.size());
  if (!count) {
    return;
  }
  selected_ = ((selected_ + delta) % count + count) % count;
  // Moving on shows the cards straight away.
  ShowCards();
}

void TabSwitcher::OnKey(Key key) {
  if (!open_) {
    return;
  }
  switch (key) {
    case Key::kEscape: Cancel(); break;
    case Key::kReturn: Commit(); break;
    case Key::kLeft:
    case Key::kUp: Move(-1); break;
    case Key::kRight:
    case Key::kDown: Move(1); break;
  }
}

void TabSwitcher::CheckControl() {
  if (open_ && !KeyWatch::ControlDown()) {
    Commit();
  }
}

void TabSwitcher::ShowCards() {
  if (!open_) {
    return;
  }
  show_timer_.Stop();
  visible_ = true;
  changed_.Run();
}

void TabSwitcher::CommitIndex(int index) {
  if (!open_ || index < 0 || index >= static_cast<int>(order_.size())) {
    return;
  }
  selected_ = index;
  Commit();
}

void TabSwitcher::Commit() {
  if (!open_) {
    return;
  }
  tabs::TabInterface* tab = order_[selected_].Get();
  Close();
  TabStripModel* strip = browser_->GetTabStripModel();
  const int index = tab ? strip->GetIndexOfTab(tab) : TabStripModel::kNoTab;
  if (index != TabStripModel::kNoTab && index != strip->active_index()) {
    strip->ActivateTabAt(
        index, TabStripUserGestureDetails(
                   TabStripUserGestureDetails::GestureType::kKeyboard));
  }
}

void TabSwitcher::Cancel() {
  if (open_) {
    Close();
  }
}

void TabSwitcher::Close() {
  const bool was_visible = visible_;
  open_ = false;
  visible_ = false;
  order_.clear();
  selected_ = 0;
  show_timer_.Stop();
  control_poll_.Stop();
  key_watch_.reset();
  if (was_visible) {
    changed_.Run();
  }
}

void TabSwitcher::TabsChanged() {
  if (!open_) {
    return;
  }
  TabStripModel* strip = browser_->GetTabStripModel();
  tabs::TabInterface* chosen = order_[selected_].Get();
  std::erase_if(order_, [strip](tabs::TabHandle handle) {
    tabs::TabInterface* tab = handle.Get();
    return !tab || strip->GetIndexOfTab(tab) == TabStripModel::kNoTab;
  });
  if (order_.size() < 2) {
    Cancel();
    return;
  }
  auto found = std::find(order_.begin(), order_.end(),
                         chosen ? chosen->GetHandle() : tabs::TabHandle());
  selected_ = found == order_.end()
                  ? std::min(selected_, static_cast<int>(order_.size()) - 1)
                  : static_cast<int>(found - order_.begin());
}

base::Value TabSwitcher::State() const {
  if (!visible_) {
    return base::Value();
  }
  base::ListValue ids;
  for (tabs::TabHandle handle : order_) {
    if (handle.Get()) {
      ids.Append(base::NumberToString(handle.raw_value()));
    }
  }
  return base::Value(base::DictValue()
                         .Set("tabs", std::move(ids))
                         .Set("selected", selected_)
                         .Set("recent", recent_));
}

// static
base::Value TabSwitcher::Thumbnail(tabs::TabInterface* tab) {
  ThumbnailTabHelper* helper = tab ? ThumbnailTabHelper::From(tab) : nullptr;
  scoped_refptr<ThumbnailImage> image = helper ? helper->thumbnail() : nullptr;
  if (!image || !image->has_data()) {
    return base::Value();
  }
  ThumbnailImage::CompressedThumbnailData data = image->data();
  if (!data || data->data.empty()) {
    return base::Value();
  }
  return base::Value("data:image/jpeg;base64," + base::Base64Encode(data->data));
}

}  // namespace modal_browser
