// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/palette_view.h"

#include <algorithm>
#include <utility>

#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/paint_util.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/events/event.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/image/image_skia_operations.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/border.h"
#include "ui/views/controls/button/button.h"
#include "ui/views/controls/textfield/textfield.h"

namespace modal_browser {

namespace {

constexpr int kInset = 8;          // card padding around rows
constexpr int kInputPaddingX = 18;
constexpr int kPromptGap = 10;
constexpr int kErrorHeight = 26;
constexpr int kRowPaddingX = 12;
constexpr int kIconSize = 16;
constexpr int kRowRadius = 8;
constexpr int kIndentStep = 16;     // outline depth
constexpr int kStatusHeight = 40;   // "Loading…" when there are no rows

std::u16string ToU16(const ::rust::String& s) {
  return base::UTF8ToUTF16(std::string_view(s.data(), s.size()));
}

std::vector<uint32_t> ToMarks(const ::rust::Vec<uint32_t>& marks) {
  return std::vector<uint32_t>(marks.begin(), marks.end());
}

const gfx::FontList& InputFont() {
  return style::UiFont(4);
}
const gfx::FontList& PromptFont(ffi::PaletteKind kind) {
  return kind == ffi::PaletteKind::CommandLine
             ? style::MonoFont(4, gfx::Font::Weight::BOLD)
             : style::UiFont(-1, gfx::Font::Weight::SEMIBOLD);
}
const gfx::FontList& PrimaryFont() {
  return style::UiFont(1);
}
const gfx::FontList& PrimaryMarkFont() {
  return style::UiFont(1, gfx::Font::Weight::BOLD);
}
const gfx::FontList& SecondaryFont() {
  return style::UiFont(-1);
}
const gfx::FontList& SecondaryMarkFont() {
  return style::UiFont(-1, gfx::Font::Weight::SEMIBOLD);
}
const gfx::FontList& SmallFont() {
  return style::UiFont(-2);
}

std::u16string AccessibleInputName(ffi::PaletteKind kind) {
  switch (kind) {
    case ffi::PaletteKind::Tabs:
      return u"Search tabs";
    case ffi::PaletteKind::Commands:
      return u"Search commands";
    case ffi::PaletteKind::History:
      return u"Search history";
    case ffi::PaletteKind::Bookmarks:
      return u"Search bookmarks";
    case ffi::PaletteKind::Workspaces:
      return u"Search workspaces";
    case ffi::PaletteKind::Outline:
      return u"Search the page outline";
    case ffi::PaletteKind::Links:
      return u"Search links on this page";
    default:
      return u"Command line";
  }
}

// A letter tile for tabs without a favicon.
void DrawLetterIcon(gfx::Canvas* canvas,
                    const gfx::Rect& rect,
                    std::u16string_view title,
                    const style::Colors& colors) {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(colors.surface_raised);
  canvas->DrawRoundRect(gfx::RectF(rect), 4, flags);
  std::u16string letter = title.empty() ? u"\u00B7" : std::u16string(title.substr(0, 1));
  canvas->DrawStringRectWithFlags(letter, style::UiFont(-3, gfx::Font::Weight::BOLD),
                                  colors.text_secondary, rect,
                                  gfx::Canvas::TEXT_ALIGN_CENTER);
}

}  // namespace

// static
PaletteModel PaletteModel::From(const ffi::PaletteState& state) {
  PaletteModel model;
  model.kind = state.kind;
  model.prompt = ToU16(state.prompt);
  model.placeholder = ToU16(state.placeholder);
  model.text = ToU16(state.text);
  model.selected = state.selected;
  model.error = ToU16(state.error);
  model.status = ToU16(state.status);
  model.rows.reserve(state.rows.size());
  for (const ffi::PaletteRow& r : state.rows) {
    model.rows.push_back({ToU16(r.primary), ToU16(r.secondary), ToU16(r.keys),
                          ToMarks(r.primary_marks), ToMarks(r.secondary_marks),
                          r.tab_id, r.active,
                          static_cast<int>(std::min<uint32_t>(r.indent, 8)),
                          r.folded});
  }
  if (model.selected >= static_cast<int>(model.rows.size())) {
    model.selected = -1;
  }
  return model;
}

// -- PaletteRowView -----------------------------------------------------------

class PaletteRowView : public views::Button {
  METADATA_HEADER(PaletteRowView, views::Button)

 public:
  PaletteRowView(PaletteDelegate* delegate, int index)
      : views::Button(base::BindRepeating(&PaletteRowView::OnPressed,
                                          base::Unretained(this))),
        delegate_(delegate),
        index_(index) {
    // The text field keeps keyboard focus; rows are for the mouse and for
    // screen readers (as list box options).
    SetFocusBehavior(FocusBehavior::NEVER);
    GetViewAccessibility().SetRole(ax::mojom::Role::kListBoxOption);
  }

  void SetRow(const PaletteModel::Row& row,
              bool selected,
              gfx::ImageSkia icon,
              bool show_icon) {
    row_ = row;
    selected_ = selected;
    icon_ = std::move(icon);
    show_icon_ = show_icon;
    std::u16string name = row.primary;
    if (!row.secondary.empty()) {
      name += u", " + row.secondary;
    }
    if (row.active) {
      name += u", current";
    }
    if (row.folded) {
      name += u", collapsed";
    }
    GetViewAccessibility().SetName(name);
    GetViewAccessibility().SetIsSelected(selected);
    SchedulePaint();
  }

  void set_index(int index) { index_ = index; }
  const PaletteModel::Row& row() const { return row_; }
  bool selected() const { return selected_; }

  void PaintButtonContents(gfx::Canvas* canvas) override {
    const style::Colors& colors = style::ColorsFor(this);
    const gfx::Rect bounds = GetLocalBounds();
    if (selected_ || GetState() == STATE_HOVERED) {
      cc::PaintFlags flags;
      flags.setAntiAlias(true);
      flags.setColor(selected_ ? colors.accent_soft
                               : SkColorSetA(colors.surface_raised, 0xB0));
      canvas->DrawRoundRect(gfx::RectF(bounds), kRowRadius, flags);
    }
    int x = kRowPaddingX + row_.indent * kIndentStep;
    const int center_y = bounds.CenterPoint().y();
    if (row_.folded) {
      // A collapsed outline entry: a disclosure mark before the text.
      const std::u16string mark = u"\u25B8";
      canvas->DrawStringRect(mark, SecondaryFont(), colors.text_tertiary,
                             gfx::Rect(x - 12, 0, 12, bounds.height()));
    }
    if (show_icon_) {
      gfx::Rect icon_rect(x, center_y - kIconSize / 2, kIconSize, kIconSize);
      if (!icon_.isNull()) {
        canvas->DrawImageInt(icon_, 0, 0, icon_.width(), icon_.height(),
                             icon_rect.x(), icon_rect.y(), kIconSize, kIconSize,
                             true);
      } else {
        DrawLetterIcon(canvas, icon_rect, row_.primary, colors);
      }
      x += kIconSize + 10;
    }

    // Right side: "current" tag and keycaps.
    int right = bounds.width() - kRowPaddingX;
    std::vector<std::u16string> keys = paint::SplitKeys(row_.keys);
    if (!keys.empty()) {
      right = paint::DrawKeycaps(canvas, keys, right, center_y, colors) - 10;
    }
    if (row_.active && row_.keys.empty()) {
      const std::u16string tag = u"Current";
      const int w = gfx::Canvas::GetStringWidth(tag, SmallFont());
      canvas->DrawStringRect(tag, SmallFont(), colors.text_tertiary,
                             gfx::Rect(right - w, 0, w + 1, bounds.height()));
      right -= w + 10;
    }

    // Primary text, then secondary after it on the same line.
    const int available = right - x;
    if (available <= 0) {
      return;
    }
    const int primary_max =
        row_.secondary.empty() ? available : available * 3 / 5;
    const int primary_width = paint::DrawMarkedText(
        canvas, row_.primary, row_.primary_marks,
        gfx::Rect(x, 0, primary_max, bounds.height()), PrimaryFont(),
        PrimaryMarkFont(), colors.text, colors.accent);
    if (!row_.secondary.empty()) {
      const int sx = x + primary_width + 10;
      paint::DrawMarkedText(canvas, row_.secondary, row_.secondary_marks,
                            gfx::Rect(sx, 0, right - sx, bounds.height()),
                            SecondaryFont(), SecondaryMarkFont(),
                            colors.text_secondary, colors.accent);
    }
  }

  void StateChanged(ButtonState old_state) override { SchedulePaint(); }

 private:
  void OnPressed(const ui::Event& event) {
    delegate_->OnPaletteRowClicked(index_);
  }

  const raw_ptr<PaletteDelegate> delegate_;
  int index_;
  PaletteModel::Row row_;
  bool selected_ = false;
  gfx::ImageSkia icon_;
  bool show_icon_ = false;
};

BEGIN_METADATA(PaletteRowView)
END_METADATA

// -- PaletteView --------------------------------------------------------------

PaletteView::PaletteView(PaletteDelegate* delegate) : delegate_(delegate) {
  GetViewAccessibility().SetRole(ax::mojom::Role::kListBox);
  GetViewAccessibility().SetName(u"Results");
  auto textfield = std::make_unique<views::Textfield>();
  textfield->set_controller(this);
  textfield->SetBorder(views::NullBorder());
  textfield->SetBackgroundEnabled(false);
  textfield->SetFontList(InputFont());
  textfield_ = AddChildView(std::move(textfield));
  for (int i = 0; i < style::kPaletteMaxVisibleRows; ++i) {
    auto row = std::make_unique<PaletteRowView>(delegate_, i);
    row->SetVisible(false);
    row_views_.push_back(AddChildView(std::move(row)));
  }
}

PaletteView::~PaletteView() = default;

void PaletteView::SetModel(PaletteModel model) {
  const bool kind_changed = model.kind != model_.kind;
  model_ = std::move(model);
  if (textfield_->GetText() != model_.text) {
    base::AutoReset<bool> setting(&setting_text_, true);
    textfield_->SetText(model_.text);
    textfield_->SetSelectedRange(gfx::Range(model_.text.size()));
  }
  textfield_->SetPlaceholderText(model_.placeholder);
  textfield_->GetViewAccessibility().SetName(AccessibleInputName(model_.kind));
  if (kind_changed) {
    first_visible_ = 0;
  }
  // Keep the selection on screen without jumping when it is already there.
  const int n = VisibleRowCount();
  if (model_.selected >= 0) {
    if (model_.selected < first_visible_) {
      first_visible_ = model_.selected;
    } else if (model_.selected >= first_visible_ + n) {
      first_visible_ = model_.selected - n + 1;
    }
  }
  first_visible_ = std::clamp(
      first_visible_, 0,
      std::max(0, static_cast<int>(model_.rows.size()) - n));
  UpdateRows();
  PreferredSizeChanged();
  InvalidateLayout();
  SchedulePaint();
}

void PaletteView::FocusInput() {
  textfield_->RequestFocus();
}

int PaletteView::VisibleRowCount() const {
  return std::min(static_cast<int>(model_.rows.size()),
                  style::kPaletteMaxVisibleRows);
}

int PaletteView::CardHeight() const {
  int height = style::kPaletteInputHeight;
  if (!model_.error.empty()) {
    height += kErrorHeight;
  }
  const int rows = VisibleRowCount();
  if (rows > 0) {
    height += 1 + kInset + rows * style::kPaletteRowHeight + kInset;
  } else if (!model_.status.empty()) {
    height += 1 + kStatusHeight;
  }
  height += style::kPaletteFooterHeight;
  return height;
}

gfx::Rect PaletteView::CardBounds() const {
  gfx::Rect card = GetLocalBounds();
  card.Inset(style::kShadowMargin);
  return card;
}

void PaletteView::UpdateRows() {
  const int n = VisibleRowCount();
  const bool icons = model_.kind == ffi::PaletteKind::Tabs;
  for (int i = 0; i < static_cast<int>(row_views_.size()); ++i) {
    PaletteRowView* view = row_views_[i];
    if (i >= n) {
      view->SetVisible(false);
      continue;
    }
    const int index = first_visible_ + i;
    const PaletteModel::Row& row = model_.rows[index];
    view->set_index(index);
    view->SetRow(row, index == model_.selected,
                 icons && row.tab_id >= 0 ? delegate_->GetTabIcon(row.tab_id)
                                          : gfx::ImageSkia(),
                 icons);
    view->SetVisible(true);
    if (index == model_.selected) {
      textfield_->GetViewAccessibility().SetActiveDescendant(*view);
    }
  }
  if (model_.selected < 0) {
    textfield_->GetViewAccessibility().ClearActiveDescendant();
  }
}

std::vector<PaletteRowView*> PaletteView::visible_rows_for_testing() {
  std::vector<PaletteRowView*> out;
  for (PaletteRowView* row : row_views_) {
    if (row->GetVisible()) {
      out.push_back(row);
    }
  }
  return out;
}

std::u16string PaletteView::FooterText() const {
  switch (model_.kind) {
    case ffi::PaletteKind::CommandLine:
      return u"Tab complete    \u2191\u2193 history    \u21B5 run    esc close";
    case ffi::PaletteKind::Tabs:
      return u"\u2191\u2193 select    \u21B5 switch    esc close";
    case ffi::PaletteKind::Outline:
      return u"\u2191\u2193 select    \u2190\u2192 fold    \u21B5 jump    esc "
             u"close";
    case ffi::PaletteKind::History:
    case ffi::PaletteKind::Bookmarks:
    case ffi::PaletteKind::Links:
    case ffi::PaletteKind::Workspaces:
      return u"\u2191\u2193 select    \u21B5 open    esc close";
    default:
      return u"\u2191\u2193 select    \u21B5 run    esc close";
  }
}

void PaletteView::Layout(PassKey) {
  const gfx::Rect card = CardBounds();
  const int prompt_width =
      gfx::Canvas::GetStringWidth(model_.prompt, PromptFont(model_.kind)) +
      (model_.kind == ffi::PaletteKind::CommandLine ? 0 : 16);
  const int x = card.x() + kInputPaddingX + prompt_width + kPromptGap;
  textfield_->SetBounds(x, card.y() + 8, card.right() - kInputPaddingX - x,
                        style::kPaletteInputHeight - 16);
  int y = card.y() + style::kPaletteInputHeight +
          (model_.error.empty() ? 0 : kErrorHeight) + 1 + kInset;
  for (PaletteRowView* row : row_views_) {
    if (!row->GetVisible()) {
      continue;
    }
    row->SetBounds(card.x() + kInset, y, card.width() - 2 * kInset,
                   style::kPaletteRowHeight);
    y += style::kPaletteRowHeight;
  }
}

void PaletteView::OnPaint(gfx::Canvas* canvas) {
  const style::Colors& colors = style::ColorsFor(this);
  const gfx::Rect card = CardBounds();
  // Frosted like the other pop-ups when the pop-up transparency setting
  // allows it; a flat card otherwise.
  if (!paint::DrawGlassCard(canvas, this, card, style::kPaletteRadius,
                            colors)) {
    paint::DrawCard(canvas, card, style::kPaletteRadius, colors,
                    colors.surface);
  }

  // Prompt: ':' in the accent for the command line, a chip for the others.
  const gfx::FontList& prompt_font = PromptFont(model_.kind);
  const int prompt_width =
      gfx::Canvas::GetStringWidth(model_.prompt, prompt_font);
  gfx::Rect input_row(card.x(), card.y(), card.width(),
                      style::kPaletteInputHeight);
  if (model_.kind == ffi::PaletteKind::CommandLine) {
    canvas->DrawStringRect(model_.prompt, prompt_font, colors.accent,
                           gfx::Rect(card.x() + kInputPaddingX, input_row.y(),
                                     prompt_width + 1, input_row.height()));
  } else {
    gfx::Rect chip(card.x() + kInputPaddingX,
                   input_row.CenterPoint().y() - 12, prompt_width + 16, 24);
    cc::PaintFlags flags;
    flags.setAntiAlias(true);
    flags.setColor(colors.accent_soft);
    canvas->DrawRoundRect(gfx::RectF(chip), 6, flags);
    canvas->DrawStringRectWithFlags(model_.prompt, prompt_font, colors.accent,
                                    chip, gfx::Canvas::TEXT_ALIGN_CENTER);
  }

  int y = input_row.bottom();
  if (!model_.error.empty()) {
    canvas->DrawStringRect(model_.error, SecondaryFont(), colors.error,
                           gfx::Rect(card.x() + kInputPaddingX, y,
                                     card.width() - 2 * kInputPaddingX,
                                     kErrorHeight - 6));
    y += kErrorHeight;
  }
  if (VisibleRowCount() > 0 || !model_.status.empty()) {
    cc::PaintFlags rule;
    rule.setColor(colors.border);
    canvas->DrawRect(gfx::Rect(card.x(), y, card.width(), 1), rule);
  }
  if (VisibleRowCount() == 0 && !model_.status.empty()) {
    canvas->DrawStringRect(model_.status, SecondaryFont(),
                           colors.text_secondary,
                           gfx::Rect(card.x() + kInputPaddingX, y + 1,
                                     card.width() - 2 * kInputPaddingX,
                                     kStatusHeight));
  }

  // Footer: what the keys do here, plus a count when the list scrolls.
  gfx::Rect footer(card.x() + kInputPaddingX,
                   card.bottom() - style::kPaletteFooterHeight,
                   card.width() - 2 * kInputPaddingX,
                   style::kPaletteFooterHeight);
  cc::PaintFlags rule;
  rule.setColor(colors.border);
  canvas->DrawRect(gfx::Rect(card.x(), footer.y(), card.width(), 1), rule);
  canvas->DrawStringRect(FooterText(), SmallFont(), colors.text_tertiary,
                         footer);
  if (static_cast<int>(model_.rows.size()) > VisibleRowCount()) {
    const std::u16string count =
        base::NumberToString16(model_.selected + 1 > 0 ? model_.selected + 1
                                                       : first_visible_ + 1) +
        u" of " + base::NumberToString16(model_.rows.size());
    canvas->DrawStringRectWithFlags(count, SmallFont(), colors.text_tertiary,
                                    footer, gfx::Canvas::TEXT_ALIGN_RIGHT);
  }
}

void PaletteView::OnThemeChanged() {
  views::View::OnThemeChanged();
  SchedulePaint();
}

void PaletteView::ContentsChanged(views::Textfield* sender,
                                  const std::u16string& new_contents) {
  if (!setting_text_) {
    delegate_->OnPaletteTextChanged(new_contents);
  }
}

bool PaletteView::HandleKeyEvent(views::Textfield* sender,
                                 const ui::KeyEvent& key_event) {
  if (key_event.type() != ui::EventType::kKeyPressed ||
      sender->IsIMEComposing()) {
    // Never interfere with an input method's own keys.
    return false;
  }
  const bool ctrl = key_event.IsControlDown() && !key_event.IsCommandDown();
  std::optional<ffi::PaletteKey> key;
  switch (key_event.key_code()) {
    case ui::VKEY_RETURN:
      key = ffi::PaletteKey::Accept;
      break;
    case ui::VKEY_ESCAPE:
      key = ffi::PaletteKey::Cancel;
      break;
    case ui::VKEY_TAB:
      key = key_event.IsShiftDown() ? ffi::PaletteKey::Previous
                                    : ffi::PaletteKey::Next;
      break;
    case ui::VKEY_UP:
      key = ffi::PaletteKey::Up;
      break;
    case ui::VKEY_DOWN:
      key = ffi::PaletteKey::Down;
      break;
    case ui::VKEY_LEFT:
    case ui::VKEY_RIGHT:
      // In the outline, with nothing typed, the arrows fold and unfold, as
      // in a tree view. Otherwise they move the caret.
      if (model_.kind == ffi::PaletteKind::Outline &&
          sender->GetText().empty()) {
        key = key_event.key_code() == ui::VKEY_LEFT ? ffi::PaletteKey::Collapse
                                                    : ffi::PaletteKey::Expand;
      }
      break;
    case ui::VKEY_N:
      if (ctrl) {
        key = ffi::PaletteKey::Next;
      }
      break;
    case ui::VKEY_P:
      if (ctrl) {
        key = ffi::PaletteKey::Previous;
      }
      break;
    default:
      break;
  }
  if (!key) {
    return false;  // ordinary text editing
  }
  delegate_->OnPaletteKey(*key);
  return true;
}

BEGIN_METADATA(PaletteView)
END_METADATA

// -- PaletteHost --------------------------------------------------------------

PaletteHost::PaletteHost(BrowserView* browser_view, PaletteDelegate* delegate)
    : host_(browser_view, {.name = "ModalBrowserPalette", .accept_events = true}),
      delegate_(delegate) {
  host_.set_on_parent_bounds_changed(base::BindRepeating(
      [](PaletteHost* self) {
        // Re-anchor when the window resizes; never re-show a closed palette.
        if (self->IsVisible()) {
          self->Layout();
        }
      },
      base::Unretained(this)));
}

PaletteHost::~PaletteHost() = default;

void PaletteHost::Show(const ffi::PaletteState& state) {
  if (!state.visible) {
    Hide();
    return;
  }
  // Read before the widget exists: a new child widget can report itself
  // visible as soon as it is created, which would skip focusing the input
  // on the first open.
  const bool was_visible = view_ && host_.IsVisible();
  if (!view_) {
    view_ = static_cast<PaletteView*>(host_.EnsureWidget(base::BindOnce(
        [](PaletteDelegate* delegate) -> std::unique_ptr<views::View> {
          return std::make_unique<PaletteView>(delegate);
        },
        delegate_.get())));
    if (!view_) {
      return;
    }
  }
  view_->SetModel(PaletteModel::From(state));
  Layout();
  // Lay out now, not at the next frame: the input moves with the prompt
  // (":" vs a chip), and a stale position would overlap it for a frame.
  host_.widget()->LayoutRootViewIfNecessary();
  if (!was_visible) {
    view_->FocusInput();
  }
}

void PaletteHost::Hide() {
  host_.Hide();
}

bool PaletteHost::IsVisible() const {
  return host_.IsVisible();
}

void PaletteHost::Layout() {
  if (!view_) {
    return;
  }
  const gfx::Rect area = host_.ContentsArea();
  const int width =
      std::min(style::kPaletteWidth, area.width() - 2 * style::kPaletteMinMargin);
  const int top = area.y() + std::max(40, area.height() * 12 / 100);
  gfx::Rect card(area.x() + (area.width() - width) / 2, top, width,
                 view_->CardHeight());
  gfx::Rect bounds = card;
  bounds.Outset(style::kShadowMargin);
  host_.ShowAt(bounds);
}

}  // namespace modal_browser
