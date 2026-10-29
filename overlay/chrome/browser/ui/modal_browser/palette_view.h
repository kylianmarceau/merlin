// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_PALETTE_VIEW_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_PALETTE_VIEW_H_

#include <memory>
#include <string>
#include <string_view>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/ui/modal_browser/overlay_host.h"
#include "components/modal_browser/ffi/src/lib.rs.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/views/controls/textfield/textfield_controller.h"
#include "ui/views/view.h"

class BrowserView;

namespace views {
class Textfield;
}

namespace modal_browser {

// What the palette reports. Implemented by ModalBrowserController.
class PaletteDelegate {
 public:
  virtual ~PaletteDelegate() = default;
  virtual void OnPaletteTextChanged(std::u16string_view text) = 0;
  virtual void OnPaletteKey(ffi::PaletteKey key) = 0;
  virtual void OnPaletteRowClicked(int index) = 0;
  // Favicon for a tab row; empty if none.
  virtual gfx::ImageSkia GetTabIcon(int32_t tab_id) = 0;
};

// A C++ copy of ffi::PaletteState, in UTF-16 for Views.
struct PaletteModel {
  struct Row {
    std::u16string primary;
    std::u16string secondary;
    std::u16string keys;
    std::vector<uint32_t> primary_marks;
    std::vector<uint32_t> secondary_marks;
    int32_t tab_id = -1;
    bool active = false;
    int indent = 0;
    bool folded = false;
  };
  ffi::PaletteKind kind = ffi::PaletteKind::CommandLine;
  std::u16string prompt;
  std::u16string placeholder;
  std::u16string text;
  std::vector<Row> rows;
  int selected = -1;
  std::u16string error;
  // "Loading…" or "No bookmarks yet", shown when there are no rows.
  std::u16string status;

  static PaletteModel From(const ffi::PaletteState& state);
};

class PaletteRowView;

// The floating card: input row, optional error, result rows and a footer
// with the keys that work here. Rows are buttons, so the palette is fully
// usable with the mouse and announced as a list box by screen readers.
class PaletteView : public views::View, public views::TextfieldController {
  METADATA_HEADER(PaletteView, views::View)

 public:
  explicit PaletteView(PaletteDelegate* delegate);
  PaletteView(const PaletteView&) = delete;
  PaletteView& operator=(const PaletteView&) = delete;
  ~PaletteView() override;

  void SetModel(PaletteModel model);
  const PaletteModel& model() const { return model_; }
  void FocusInput();

  // Height of the card (without shadow margins) for the current model.
  int CardHeight() const;

  views::Textfield* textfield() { return textfield_; }
  // Rows currently on screen, top to bottom.
  std::vector<PaletteRowView*> visible_rows_for_testing();

  // views::View:
  void Layout(PassKey) override;
  void OnPaint(gfx::Canvas* canvas) override;
  void OnThemeChanged() override;

  // views::TextfieldController:
  void ContentsChanged(views::Textfield* sender,
                       const std::u16string& new_contents) override;
  bool HandleKeyEvent(views::Textfield* sender,
                      const ui::KeyEvent& key_event) override;

 private:
  gfx::Rect CardBounds() const;
  int VisibleRowCount() const;
  void UpdateRows();
  std::u16string FooterText() const;

  const raw_ptr<PaletteDelegate> delegate_;
  PaletteModel model_;
  raw_ptr<views::Textfield> textfield_ = nullptr;
  std::vector<raw_ptr<PaletteRowView>> row_views_;
  // Index of the first row on screen, so the list scrolls with the
  // selection without jumping.
  int first_visible_ = 0;
  // Set while the model writes into the text field, so that is not
  // reported back as an edit.
  bool setting_text_ = false;
};

// Owns the palette widget, centered near the top of the web contents.
class PaletteHost {
 public:
  PaletteHost(BrowserView* browser_view, PaletteDelegate* delegate);
  PaletteHost(const PaletteHost&) = delete;
  PaletteHost& operator=(const PaletteHost&) = delete;
  ~PaletteHost();

  void Show(const ffi::PaletteState& state);
  void Hide();
  bool IsVisible() const;

  PaletteView* view_for_testing() { return view_; }
  views::Widget* widget_for_testing() { return host_.widget(); }

 private:
  void Layout();

  OverlayHost host_;
  const raw_ptr<PaletteDelegate> delegate_;
  raw_ptr<PaletteView> view_ = nullptr;
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_PALETTE_VIEW_H_
