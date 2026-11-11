// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#include "chrome/browser/ui/modal_browser/merlin_react_find_bar.h"
#include <algorithm>
#include "base/memory/raw_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/modal_browser/merlin_shell_bridge.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/find_in_page/find_notification_details.h"
#include "content/public/browser/web_contents.h"
#include "ui/gfx/range/range.h"

namespace modal_browser {
namespace {
class ReactFindBar final : public FindBar {
 public:
  ReactFindBar(BrowserWindowInterface* browser, views::Widget* widget) : browser_(browser), widget_(widget) {}
  FindBarController* GetFindBarController() const override { return controller_; }
  void SetFindBarController(FindBarController* controller) override { controller_ = controller; }
  void Show(bool, bool focus) override { visible_ = true; if (focus) ++focus_; Publish(); }
  void Hide(bool) override { visible_ = false; Publish(); }
  void SetFocusAndSelection() override { ++focus_; Publish(); }
  void ClearResults(const find_in_page::FindNotificationDetails&) override { text_.clear(); matches_ = ordinal_ = 0; Publish(); }
  void StopAnimation() override {}
  void MoveWindowIfNecessary() override {}
  void SetFindTextAndSelectedRange(const std::u16string& text, const gfx::Range& range) override { text_ = text; range_ = range; Publish(); }
  std::u16string_view GetFindText() const override { return text_; }
  gfx::Range GetSelectedRange() const override { return range_; }
  void UpdateUIForFindResult(const find_in_page::FindNotificationDetails& result, const std::u16string& text) override {
    text_ = text; matches_ = std::max(0, result.number_of_matches()); ordinal_ = std::max(0, result.active_match_ordinal()); Publish();
  }
  void AudibleAlert() override {}
  bool IsFindBarVisible() const override { return visible_; }
  void RestoreSavedFocus() override {
    if (auto* contents = browser_->GetTabStripModel()->GetActiveWebContents()) contents->Focus();
  }
  bool HasGlobalFindPasteboard() const override { return true; }
  void UpdateFindBarForChangedWebContents() override { Publish(); }
  bool CanPopulateFromSelectedText() override { return true; }
  const FindBarTesting* GetFindBarTesting() const override { return nullptr; }
  bool HasFocus() const override { return visible_ && ShellFindHasFocus(browser_); }
  void CloseOverlappingBubbles() override {}
  views::Widget* GetHostWidget() override { return widget_; }
 private:
  void Publish() {
    SetShellFindState(browser_, base::DictValue().Set("visible", visible_).Set("text", base::UTF16ToUTF8(text_))
        .Set("matches", matches_).Set("ordinal", ordinal_).Set("focus", focus_));
  }
  raw_ptr<BrowserWindowInterface> browser_;
  raw_ptr<views::Widget> widget_;
  raw_ptr<FindBarController> controller_ = nullptr;
  std::u16string text_;
  gfx::Range range_;
  bool visible_ = false;
  int matches_ = 0;
  int ordinal_ = 0;
  int focus_ = 0;
};
}
std::unique_ptr<FindBar> CreateReactFindBar(BrowserWindowInterface* browser, views::Widget* widget) {
  return std::make_unique<ReactFindBar>(browser, widget);
}
}
