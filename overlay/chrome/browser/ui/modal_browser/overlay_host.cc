// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/overlay_host.h"

#include <utility>

#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/theme_copying_widget.h"
#include "ui/views/controls/webview/webview.h"

namespace modal_browser {

OverlayHost::OverlayHost(BrowserView* browser_view, Options options)
    : browser_view_(browser_view), options_(options) {}

OverlayHost::~OverlayHost() {
  widget_.reset();
}

views::View* OverlayHost::EnsureWidget(
    base::OnceCallback<std::unique_ptr<views::View>()> make_contents) {
  if (widget_) {
    return widget_->GetContentsView();
  }
  views::Widget* browser_widget = browser_view_->GetWidget();
  if (!browser_widget) {
    return nullptr;
  }
  widget_ = std::make_unique<ThemeCopyingWidget>(browser_widget);
  views::Widget::InitParams params(
      views::Widget::InitParams::CLIENT_OWNS_WIDGET,
      views::Widget::InitParams::TYPE_CONTROL);
  params.delegate = this;
  params.name = options_.name;
  params.parent = browser_view_->GetWidgetForAnchoring()->GetNativeView();
  params.opacity = views::Widget::InitParams::WindowOpacity::kTranslucent;
  // Never activatable; see the macOS notes in FindBarHost.
  params.activatable = views::Widget::InitParams::Activatable::kNo;
  params.accept_events = options_.accept_events;
  widget_->Init(std::move(params));
  views::View* contents =
      widget_->SetContentsView(std::move(make_contents).Run());
  browser_widget_observation_.Observe(browser_widget);
  return contents;
}

gfx::Rect OverlayHost::ContentsArea() const {
  views::View* contents = browser_view_->GetActiveContentsWebView();
  if (!contents || contents->bounds().IsEmpty()) {
    contents = browser_view_->contents_container();
  }
  return contents->ConvertRectToWidget(contents->GetLocalBounds());
}

void OverlayHost::ShowAt(const gfx::Rect& bounds_in_parent) {
  if (!widget_) {
    return;
  }
  widget_->SetBounds(bounds_in_parent);
  if (!widget_->IsVisible()) {
    widget_->ShowInactive();
  }
}

void OverlayHost::Hide() {
  if (widget_ && widget_->IsVisible()) {
    widget_->Hide();
  }
}

bool OverlayHost::IsVisible() const {
  return widget_ && widget_->IsVisible();
}

void OverlayHost::OnWidgetBoundsChanged(views::Widget* widget,
                                        const gfx::Rect& new_bounds) {
  if (on_parent_bounds_changed_) {
    on_parent_bounds_changed_.Run();
  }
}

void OverlayHost::OnWidgetDestroying(views::Widget* widget) {
  browser_widget_observation_.Reset();
}

}  // namespace modal_browser
