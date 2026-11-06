// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_address_editor.h"

#include <algorithm>
#include <utility>

#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/autocomplete/autocomplete_classifier_factory.h"
#include "chrome/browser/favicon/favicon_service_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/modal_browser/merlin_start_page.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/paint_util.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "components/favicon/core/favicon_service.h"
#include "components/favicon_base/favicon_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "components/omnibox/browser/autocomplete_classifier.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/url_formatter/url_formatter.h"
#include "components/vector_icons/vector_icons.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "third_party/metrics_proto/omnibox_event.pb.h"
#include "ui/accessibility/ax_action_data.h"
#include "ui/accessibility/ax_enums.mojom.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/events/event.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/gfx/paint_vector_icon.h"
#include "ui/gfx/text_elider.h"
#include "ui/gfx/text_utils.h"
#include "ui/views/accessibility/view_accessibility.h"
#include "ui/views/border.h"
#include "ui/views/controls/textfield/textfield.h"
#include "ui/views/view.h"
#include "ui/views/widget/widget.h"
#include "url/url_constants.h"

namespace modal_browser {

namespace {

// The card, in DIPs.
constexpr int kCardRadius = 12;
constexpr int kInputHeight = 40;
// The address's left edge inside the card; the card opens this much left
// of the toolbar's field so the text does not move.
constexpr int kInputPadX = 12;
constexpr int kFieldTextInset = 8;  // MerlinAddressField's own padding
constexpr int kRowHeight = 36;
constexpr int kRowInsetX = 6;
constexpr int kRowRadius = 8;
constexpr int kRowPadX = 10;
constexpr int kIconSize = 16;
constexpr int kIconGap = 12;
constexpr int kListPadTop = 5;
constexpr int kListPadBottom = 6;

// The card paints the rows, but each has a real accessibility node and action.
// Keyboard focus stays in the textfield, just as in Chromium's omnibox.
class MerlinAddressOption : public views::View {
  METADATA_HEADER(MerlinAddressOption, views::View)

 public:
  MerlinAddressOption(MerlinAddressEditor* editor, int index)
      : editor_(editor), index_(index) {
    SetFocusBehavior(FocusBehavior::NEVER);
    GetViewAccessibility().SetRole(ax::mojom::Role::kListBoxOption);
    GetViewAccessibility().SetDefaultActionVerb(
        ax::mojom::DefaultActionVerb::kClick);
  }

  bool HandleAccessibleAction(const ui::AXActionData& action) override {
    if (action.action == ax::mojom::Action::kFocus) {
      editor_->SelectRow(index_);
      return true;
    }
    if (action.action == ax::mojom::Action::kDoDefault) {
      editor_->OpenRow(index_, WindowOpenDisposition::CURRENT_TAB);
      return true;
    }
    return views::View::HandleAccessibleAction(action);
  }

 private:
  const raw_ptr<MerlinAddressEditor> editor_;
  const int index_;
};

BEGIN_METADATA(MerlinAddressOption)
END_METADATA

}  // namespace

// The card: the address on top, suggestions under a hairline. Transparent
// option views expose the painted rows without taking keyboard or mouse focus.
class MerlinAddressCard : public views::View {
  METADATA_HEADER(MerlinAddressCard, views::View)

 public:
  struct Row {
    MerlinSuggestions::Kind kind = MerlinSuggestions::Kind::kUrl;
    std::u16string title;
    std::u16string detail;
    gfx::ImageSkia icon;
  };

  explicit MerlinAddressCard(MerlinAddressEditor* editor) : editor_(editor) {
    GetViewAccessibility().SetRole(ax::mojom::Role::kGroup);
    auto textfield = std::make_unique<views::Textfield>();
    textfield->set_controller(editor);
    textfield->SetBorder(views::NullBorder());
    textfield->SetBackgroundEnabled(false);
    textfield->SetFontList(style::UiFont());
    textfield->SetPlaceholderText(u"Search or enter address");
    textfield->GetViewAccessibility().SetName(u"Address and search bar");
    textfield->GetViewAccessibility().SetAutoComplete("both");
    textfield->GetViewAccessibility().SetHasPopup(
        ax::mojom::HasPopup::kListbox);
    textfield->GetViewAccessibility().SetIsCollapsed();
    textfield_ = AddChildView(std::move(textfield));
    auto list = std::make_unique<views::View>();
    list->GetViewAccessibility().SetRole(ax::mojom::Role::kListBox);
    list->GetViewAccessibility().SetName(u"Suggestions");
    list->SetCanProcessEventsWithinSubtree(false);
    list->SetVisible(false);
    list_ = AddChildView(std::move(list));
  }
  MerlinAddressCard(const MerlinAddressCard&) = delete;
  MerlinAddressCard& operator=(const MerlinAddressCard&) = delete;
  ~MerlinAddressCard() override = default;

  views::Textfield* textfield() { return textfield_; }
  views::View* list() { return list_; }
  const std::vector<Row>& rows() const { return rows_; }

  void SetRows(std::vector<Row> rows, int selected) {
    const bool changed = rows.size() != rows_.size() ||
                         !std::equal(rows.begin(), rows.end(), rows_.begin(),
                                     [](const Row& a, const Row& b) {
                                       return a.kind == b.kind &&
                                              a.title == b.title &&
                                              a.detail == b.detail;
                                     });
    rows_ = std::move(rows);
    selected_ = selected;
    auto& field_ax = textfield_->GetViewAccessibility();
    if (rows_.size() < list_->children().size())
      field_ax.ClearActiveDescendant();
    // Reuse option views so arrow selection and favicon delivery keep IDs.
    while (list_->children().size() > rows_.size())
      list_->RemoveChildViewT(list_->children().back());
    while (list_->children().size() < rows_.size())
      list_->AddChildView(std::make_unique<MerlinAddressOption>(
          editor_, static_cast<int>(list_->children().size())));
    list_->SetVisible(!rows_.empty());
    for (size_t i = 0; i < rows_.size(); ++i) {
      const Row& row = rows_[i];
      std::u16string name = row.title;
      if (!row.detail.empty() && row.detail != row.title)
        name += u", " + row.detail;
      if (row.kind == MerlinSuggestions::Kind::kTab)
        name += u", Switch to tab";
      auto& option = list_->children()[i]->GetViewAccessibility();
      option.SetName(name);
      option.SetIsSelected(static_cast<int>(i) == selected_);
      option.SetPosInSet(static_cast<int>(i + 1));
      option.SetSetSize(static_cast<int>(rows_.size()));
    }
    if (rows_.empty()) {
      field_ax.SetIsCollapsed();
      field_ax.RemoveControlIds();
    } else {
      field_ax.SetIsExpanded();
      field_ax.SetControlIds({list_->GetViewAccessibility().GetUniqueId()});
      if (selected_ >= 0 && selected_ < static_cast<int>(rows_.size())) {
        auto& option = list_->children()[selected_]->GetViewAccessibility();
        if (changed && field_ax.GetActiveDescendantView() == &option) {
          // The selected index can stay the same while its result changes.
          field_ax.NotifyEvent(ax::mojom::Event::kActiveDescendantChanged,
                               true);
          option.NotifyEvent(ax::mojom::Event::kSelection, true);
        } else {
          field_ax.SetActiveDescendant(option);
        }
      } else {
        field_ax.ClearActiveDescendant();
      }
    }
    if (changed)
      list_->GetViewAccessibility().NotifyEvent(
          ax::mojom::Event::kChildrenChanged, true);
    hovered_ = -1;
    pressed_ = -1;
    InvalidateLayout();
    SchedulePaint();
  }

  // The card's height, without the shadow around it.
  int CardHeight() const {
    int height = kInputHeight;
    if (!rows_.empty()) {
      height += 1 + kListPadTop + static_cast<int>(rows_.size()) * kRowHeight +
                kListPadBottom;
    }
    return height;
  }

  // views::View:
  void Layout(PassKey) override {
    const gfx::Rect card = CardBounds();
    textfield_->SetBounds(card.x() + kInputPadX, card.y(),
                          std::max(0, card.width() - 2 * kInputPadX),
                          kInputHeight);
    list_->SetBounds(card.x() + kRowInsetX,
                     card.y() + kInputHeight + 1 + kListPadTop,
                     std::max(0, card.width() - 2 * kRowInsetX),
                     static_cast<int>(rows_.size()) * kRowHeight);
    for (size_t i = 0; i < list_->children().size(); ++i)
      list_->children()[i]->SetBounds(0, static_cast<int>(i) * kRowHeight,
                                      list_->width(), kRowHeight);
  }

  void OnPaint(gfx::Canvas* canvas) override {
    const style::Colors& c = style::ColorsFor(this);
    const gfx::Rect card = CardBounds();
    if (!paint::DrawGlassCard(canvas, this, card, kCardRadius, c)) {
      paint::DrawCard(canvas, card, kCardRadius, c, c.surface);
    }
    if (rows_.empty()) {
      return;
    }
    canvas->FillRect(gfx::Rect(card.x() + kInputPadX, card.y() + kInputHeight,
                               card.width() - 2 * kInputPadX, 1),
                     c.border);
    for (int i = 0; i < static_cast<int>(rows_.size()); ++i) {
      PaintRow(canvas, i, c);
    }
  }

  bool OnMousePressed(const ui::MouseEvent& event) override {
    pressed_ = RowAt(event.location());
    // The card swallows clicks between rows, so they do not reach the page.
    return true;
  }

  void OnMouseReleased(const ui::MouseEvent& event) override {
    const int row = RowAt(event.location());
    const int pressed = pressed_;
    pressed_ = -1;
    if (row < 0 || row != pressed) {
      return;
    }
    WindowOpenDisposition disposition = WindowOpenDisposition::CURRENT_TAB;
    if (event.IsMiddleMouseButton() || event.IsCommandDown()) {
      disposition = event.IsShiftDown()
                        ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                        : WindowOpenDisposition::NEW_BACKGROUND_TAB;
    } else if (event.IsShiftDown()) {
      disposition = WindowOpenDisposition::NEW_WINDOW;
    }
    editor_->OpenRow(row, disposition);
  }

  void OnMouseMoved(const ui::MouseEvent& event) override {
    SetHovered(RowAt(event.location()));
  }

  void OnMouseExited(const ui::MouseEvent& event) override { SetHovered(-1); }

  void OnThemeChanged() override {
    views::View::OnThemeChanged();
    SchedulePaint();
  }

 private:
  gfx::Rect CardBounds() const {
    gfx::Rect card = GetLocalBounds();
    card.Inset(style::kShadowMargin);
    return card;
  }

  gfx::Rect RowBounds(int index) const {
    const gfx::Rect card = CardBounds();
    return gfx::Rect(card.x() + kRowInsetX,
                     card.y() + kInputHeight + 1 + kListPadTop +
                         index * kRowHeight,
                     card.width() - 2 * kRowInsetX, kRowHeight);
  }

  int RowAt(const gfx::Point& point) const {
    for (int i = 0; i < static_cast<int>(rows_.size()); ++i) {
      if (RowBounds(i).Contains(point)) {
        return i;
      }
    }
    return -1;
  }

  void SetHovered(int row) {
    if (hovered_ != row) {
      hovered_ = row;
      SchedulePaint();
    }
  }

  void PaintRow(gfx::Canvas* canvas, int index, const style::Colors& c) {
    const Row& row = rows_[index];
    const gfx::Rect bounds = RowBounds(index);
    cc::PaintFlags fill;
    fill.setAntiAlias(true);
    // A quiet neutral highlight; the accent is kept for Merlin's modes.
    if (index == selected_) {
      fill.setColor(c.surface_raised);
      canvas->DrawRoundRect(gfx::RectF(bounds), kRowRadius, fill);
    } else if (index == hovered_) {
      fill.setColor(SkColorSetA(c.surface_raised, 0x80));
      canvas->DrawRoundRect(gfx::RectF(bounds), kRowRadius, fill);
    }

    const int center_y = bounds.CenterPoint().y();
    const gfx::Rect icon(bounds.x() + kRowPadX, center_y - kIconSize / 2,
                         kIconSize, kIconSize);
    if (row.kind == MerlinSuggestions::Kind::kSearch) {
      canvas->DrawImageInt(gfx::CreateVectorIcon(vector_icons::kSearchIcon,
                                                 kIconSize, c.text_secondary),
                           icon.x(), icon.y());
    } else if (!row.icon.isNull()) {
      canvas->DrawImageInt(row.icon, 0, 0, row.icon.width(),
                           row.icon.height(), icon.x(), icon.y(), kIconSize,
                           kIconSize, true);
    } else {
      canvas->DrawImageInt(gfx::CreateVectorIcon(vector_icons::kGlobeIcon,
                                                 kIconSize, c.text_secondary),
                           icon.x(), icon.y());
    }

    int x = icon.right() + kIconGap;
    int right = bounds.right() - kRowPadX;
    const gfx::FontList& small = style::UiFont(-2, gfx::Font::Weight::MEDIUM);
    if (row.kind == MerlinSuggestions::Kind::kTab) {
      // An open tab: choosing it switches there.
      const std::u16string tag = u"Switch to tab";
      const int tag_width = gfx::GetStringWidth(tag, small) + 14;
      const gfx::Rect pill(right - tag_width, center_y - 10, tag_width, 20);
      cc::PaintFlags tag_fill;
      tag_fill.setAntiAlias(true);
      tag_fill.setColor(index == selected_ ? c.surface : c.surface_raised);
      canvas->DrawRoundRect(gfx::RectF(pill), 6, tag_fill);
      canvas->DrawStringRectWithFlags(tag, small, c.text_secondary, pill,
                                      gfx::Canvas::TEXT_ALIGN_CENTER);
      right = pill.x() - 10;
    }
    if (right <= x) {
      return;
    }

    const gfx::FontList& font = style::UiFont();
    const std::u16string title =
        gfx::ElideText(row.title, font, right - x, gfx::ELIDE_TAIL);
    const int title_width = std::min(gfx::GetStringWidth(title, font), right - x);
    canvas->DrawStringRect(title, font, c.text,
                           gfx::Rect(x, bounds.y(), title_width, bounds.height()));
    x += title_width;
    if (row.detail.empty() || row.detail == row.title || right - x < 48) {
      return;
    }
    // The address after the title, quieter.
    const gfx::FontList& detail_font = style::UiFont(-1);
    const std::u16string detail = gfx::ElideText(
        u"  —  " + row.detail, detail_font, right - x, gfx::ELIDE_TAIL);
    canvas->DrawStringRect(detail, detail_font, c.text_tertiary,
                           gfx::Rect(x, bounds.y(), right - x, bounds.height()));
  }

  const raw_ptr<MerlinAddressEditor> editor_;
  raw_ptr<views::Textfield> textfield_ = nullptr;
  raw_ptr<views::View> list_ = nullptr;
  std::vector<Row> rows_;
  int selected_ = -1;
  int hovered_ = -1;
  int pressed_ = -1;
};

BEGIN_METADATA(MerlinAddressCard)
END_METADATA

// MerlinAddressEditor --------------------------------------------------------

MerlinAddressEditor::MerlinAddressEditor(BrowserView* browser_view,
                                         BrowserWindowInterface* browser,
                                         views::View* field,
                                         base::RepeatingClosure on_end,
                                         base::RepeatingClosure focus_page)
    : browser_view_(browser_view),
      browser_(browser),
      field_(field),
      on_end_(std::move(on_end)),
      focus_page_(std::move(focus_page)),
      host_(browser_view,
            {.name = "MerlinAddressCard", .accept_events = true}) {
  host_.set_on_parent_bounds_changed(base::BindRepeating(
      [](MerlinAddressEditor* self) {
        if (self->editing_) {
          self->Layout();
        }
      },
      base::Unretained(this)));
}

MerlinAddressEditor::~MerlinAddressEditor() {
  StopWatching();
}

views::Textfield* MerlinAddressEditor::textfield_for_testing() {
  return card_ ? card_->textfield() : nullptr;
}

views::View* MerlinAddressEditor::suggestions_for_testing() {
  return card_ ? card_->list() : nullptr;
}

void MerlinAddressEditor::Begin() {
  if (!card_) {
    card_ = static_cast<MerlinAddressCard*>(host_.EnsureWidget(base::BindOnce(
        [](MerlinAddressEditor* editor) -> std::unique_ptr<views::View> {
          return std::make_unique<MerlinAddressCard>(editor);
        },
        base::Unretained(this))));
    if (!card_) {
      return;  // No browser widget yet.
    }
  }
  if (!editing_) {
    editing_ = true;
    // Starts from the page's address; empty on the start page.
    std::u16string text;
    content::WebContents* contents =
        browser_->GetTabStripModel()->GetActiveWebContents();
    if (contents) {
      const GURL url = contents->GetVisibleURL();
      const bool start_page = url.SchemeIs(content::kChromeUIScheme) &&
                              (url.host() == kMerlinStartHost ||
                               url.host() == "newtab");
      if (!start_page && !url.is_empty()) {
        text = url.SchemeIs(content::kChromeUIScheme)
                   ? base::UTF8ToUTF16(MerlinDisplayUrl(url))
                   : url_formatter::FormatUrl(
                         url, url_formatter::kFormatUrlOmitDefaults,
                         base::UnescapeRule::SPACES, nullptr, nullptr, nullptr);
      }
    }
    typed_ = text;
    results_.clear();
    selected_ = -1;
    deleting_ = false;
    {
      base::AutoReset<bool> setting(&setting_text_, true);
      card_->textfield()->SetText(text);
    }
    if (!suggestions_) {
      suggestions_ = std::make_unique<MerlinSuggestions>(
          browser_->GetProfile(),
          base::BindRepeating(&MerlinAddressEditor::OnResults,
                              weak_factory_.GetWeakPtr()));
    }
    // What is typed opens in this tab, so the likely page is readied here.
    suggestions_->SetTarget(contents);
    UpdateCard();
    Layout();
    focus_manager_ = card_->textfield()->GetFocusManager();
    if (focus_manager_) {
      focus_manager_->AddFocusChangeListener(this);
    }
  }
  // Focused with the address selected, as Chromium does on ⌘L.
  card_->textfield()->RequestFocus();
  card_->textfield()->SelectAll(/*reversed=*/false);
}

void MerlinAddressEditor::End() {
  if (!editing_) {
    return;
  }
  editing_ = false;
  StopWatching();
  if (suggestions_) {
    suggestions_->Stop();
  }
  icon_tracker_.TryCancelAll();
  // Icons that never arrived are asked for again next time; the rest are
  // kept a while.
  std::erase_if(icons_, [](const auto& entry) { return entry.second.isNull(); });
  if (icons_.size() > 200) {
    icons_.clear();
  }
  results_.clear();
  UpdateCard();
  host_.Hide();
  on_end_.Run();
}

void MerlinAddressEditor::StopWatching() {
  if (focus_manager_) {
    focus_manager_->RemoveFocusChangeListener(this);
    focus_manager_ = nullptr;
  }
}

void MerlinAddressEditor::OnDidChangeFocus(views::View* focused_before,
                                           views::View* focused_now) {
  // No focused view while the window is in the background; the field gets
  // focus back when the window does.
  if (!focused_now || (card_ && card_->Contains(focused_now))) {
    return;
  }
  End();
}

void MerlinAddressEditor::ContentsChanged(views::Textfield* sender,
                                          const std::u16string& new_contents) {
  if (setting_text_) {
    return;
  }
  // Typing over a completion replaces it, so the text is what was typed.
  deleting_ = new_contents.size() <= typed_.size();
  typed_ = new_contents;
  selected_ = -1;
  if (base::TrimWhitespace(new_contents, base::TRIM_ALL).empty()) {
    suggestions_->Stop();
    results_.clear();
    UpdateCard();
    Layout();
    return;
  }
  suggestions_->Query(new_contents, /*prevent_inline=*/deleting_);
}

void MerlinAddressEditor::OnResults(
    const std::vector<MerlinSuggestions::Suggestion>& results) {
  if (!editing_ || !card_) {
    return;
  }
  results_ = results;
  if (selected_ >= static_cast<int>(results_.size())) {
    selected_ = -1;
  }
  // Complete in place, selected, so typing on replaces it.
  views::Textfield* field = card_->textfield();
  if (!deleting_ && !results_.empty() &&
      !results_[0].inline_completion.empty() &&
      field->GetText() == typed_ &&
      field->GetSelectedRange() == gfx::Range(typed_.size())) {
    const std::u16string full = typed_ + results_[0].inline_completion;
    base::AutoReset<bool> setting(&setting_text_, true);
    field->SetText(full);
    field->SetSelectedRange(gfx::Range(typed_.size(), full.size()));
  }
  for (const MerlinSuggestions::Suggestion& s : results_) {
    if (s.kind != MerlinSuggestions::Kind::kSearch &&
        !icons_.contains(s.destination)) {
      FetchIcon(s.destination);
    }
  }
  UpdateCard();
  Layout();
}

void MerlinAddressEditor::UpdateCard() {
  if (!card_) {
    return;
  }
  std::vector<MerlinAddressCard::Row> rows;
  for (const MerlinSuggestions::Suggestion& s : results_) {
    MerlinAddressCard::Row row;
    row.kind = s.kind;
    row.title = s.title;
    row.detail = s.detail;
    if (auto it = icons_.find(s.destination); it != icons_.end()) {
      row.icon = it->second;
    }
    rows.push_back(std::move(row));
  }
  // With no row picked, the first is what Enter opens, as in Chromium.
  const int highlighted = selected_ >= 0 ? selected_ : (rows.empty() ? -1 : 0);
  card_->SetRows(std::move(rows), highlighted);
}

void MerlinAddressEditor::Layout() {
  if (!card_ || !editing_ || !field_->GetWidget()) {
    return;
  }
  const gfx::Rect field = field_->ConvertRectToWidget(field_->GetLocalBounds());
  // The address stays where the toolbar showed it, and the card runs across
  // the page, as Dia's does, rather than stopping at the width of the
  // address.
  const int x = field.x() + kFieldTextInset - kInputPadX;
  // Centred on the page: as much room after the card's right edge as there
  // is before its left edge.
  const gfx::Rect page = host_.ContentsArea();
  const int right = std::max(field.right(), page.right() - (x - page.x()));
  const int width = std::max(0, right - x);
  const gfx::Rect card(x, field.CenterPoint().y() - kInputHeight / 2, width,
                       card_->CardHeight());
  gfx::Rect bounds = card;
  bounds.Outset(style::kShadowMargin);
  host_.ShowAt(bounds);
  host_.widget()->LayoutRootViewIfNecessary();
}

bool MerlinAddressEditor::HandleKeyEvent(views::Textfield* sender,
                                         const ui::KeyEvent& key_event) {
  if (key_event.type() != ui::EventType::kKeyPressed) {
    return false;
  }
  const int count = static_cast<int>(results_.size());
  switch (key_event.key_code()) {
    case ui::VKEY_DOWN:
    case ui::VKEY_UP: {
      if (count == 0) {
        return true;
      }
      const int from = selected_ >= 0 ? selected_ : 0;
      const int step = key_event.key_code() == ui::VKEY_DOWN ? 1 : -1;
      SelectRow(std::clamp(from + step, 0, count - 1));
      return true;
    }
    case ui::VKEY_RETURN: {
      const WindowOpenDisposition disposition =
          key_event.IsAltDown() || key_event.IsCommandDown()
              ? WindowOpenDisposition::NEW_FOREGROUND_TAB
              : WindowOpenDisposition::CURRENT_TAB;
      if (selected_ >= 0) {
        OpenRow(selected_, disposition);
      } else {
        OpenTyped(disposition);
      }
      return true;
    }
    case ui::VKEY_ESCAPE:
      // Back to the page; the unfinished edit is dropped.
      End();
      focus_page_.Run();
      return true;
    case ui::VKEY_TAB: {
      // Accepts the completion; focus stays here either way.
      const gfx::Range selection = sender->GetSelectedRange();
      if (!selection.is_empty() &&
          selection.GetMax() == sender->GetText().size()) {
        sender->SetSelectedRange(gfx::Range(sender->GetText().size()));
        typed_ = std::u16string(sender->GetText());
      }
      return true;
    }
    default:
      return false;
  }
}

void MerlinAddressEditor::SelectRow(int index) {
  if (index < 0 || index >= static_cast<int>(results_.size()))
    return;
  selected_ = index;
  UpdateCard();
}

void MerlinAddressEditor::OpenRow(int index, WindowOpenDisposition disposition) {
  if (index < 0 || index >= static_cast<int>(results_.size())) {
    return;
  }
  const MerlinSuggestions::Suggestion s = results_[index];
  if (s.kind == MerlinSuggestions::Kind::kTab &&
      disposition == WindowOpenDisposition::CURRENT_TAB) {
    disposition = WindowOpenDisposition::SWITCH_TO_TAB;
  }
  Open(s.destination, s.transition, disposition);
}

void MerlinAddressEditor::OpenTyped(WindowOpenDisposition disposition) {
  const std::u16string text(card_->textfield()->GetText());
  if (base::TrimWhitespace(text, base::TRIM_ALL).empty()) {
    return;
  }
  if (const GURL internal = MerlinInternalUrl(text); internal.is_valid()) {
    Open(internal, ui::PAGE_TRANSITION_TYPED, disposition);
    return;
  }
  // The same reading Chromium's field gives: an address, or a search with
  // the default engine and keywords.
  AutocompleteMatch match;
  AutocompleteClassifierFactory::GetForProfile(browser_->GetProfile())
      ->Classify(text, /*in_keyword_mode=*/false,
                 /*allow_exact_keyword_match=*/true,
                 metrics::OmniboxEventProto::OTHER, &match,
                 /*alternate_nav_url=*/nullptr);
  Open(match.destination_url,
       MerlinSuggestions::FromAddressBar(match.transition), disposition);
}

void MerlinAddressEditor::Open(GURL url,
                               ui::PageTransition transition,
                               WindowOpenDisposition disposition) {
  if (!MerlinSuggestions::IsOpenable(url)) {
    return;
  }
  content::WebContents* contents =
      browser_->GetTabStripModel()->GetActiveWebContents();
  if (suggestions_) {
    suggestions_->Opened(url);
  }
  End();
  if (!contents) {
    return;
  }
  focus_page_.Run();
  content::OpenURLParams params(url, content::Referrer(), disposition,
                                transition, /*is_renderer_initiated=*/false);
  contents->OpenURL(params, /*navigation_handle_callback=*/{});
}

void MerlinAddressEditor::FetchIcon(const GURL& page_url) {
  favicon::FaviconService* service = FaviconServiceFactory::GetForProfile(
      browser_->GetProfile(), ServiceAccessType::EXPLICIT_ACCESS);
  if (!service) {
    return;
  }
  // Remembered as missing until it arrives, so it is asked for once.
  icons_[page_url] = gfx::ImageSkia();
  service->GetFaviconImageForPageURL(
      page_url,
      base::BindOnce(&MerlinAddressEditor::OnIcon, weak_factory_.GetWeakPtr(),
                     page_url),
      &icon_tracker_);
}

void MerlinAddressEditor::OnIcon(GURL page_url,
                                 const favicon_base::FaviconImageResult& result) {
  if (result.image.IsEmpty()) {
    return;
  }
  icons_[page_url] = *result.image.ToImageSkia();
  UpdateCard();
}

}  // namespace modal_browser
