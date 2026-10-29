// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_PAGE_SCRIPTS_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_PAGE_SCRIPTS_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/values.h"
#include "components/modal_browser/ffi/src/lib.rs.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect_f.h"

// Scripts the modal layer runs in pages, and parsers for their results.
//
// Every script runs in Chrome's internal isolated world
// (ISOLATED_WORLD_ID_CHROME_INTERNAL): it sees the DOM but not page script
// globals, and page scripts cannot see or alter it. The scripts are constant
// text; only numbers computed in C++ are interpolated. Results are treated as
// untrusted data: sizes are bounded and every field is type-checked.
namespace modal_browser::page_scripts {

// Hint targets are capped here and again in Rust.
inline constexpr size_t kMaxHintTargets = 2000;
// Largest text accepted from a page script (a code block, a field value).
inline constexpr size_t kMaxTextBytes = 1024 * 1024;
// Most blocks accepted from one document extraction.
inline constexpr size_t kMaxBlocks = 5000;
// No element to jump back to.
inline constexpr uint32_t kNoElement = 0xFFFFFFFF;

// The page's viewport geometry, for converting CSS pixels in the layout
// viewport to DIPs in the web contents view:
//   dip = (css - offset) * scale / device_scale_factor
struct ViewportTransform {
  double scale = 1;  // visualViewport.scale * devicePixelRatio
  double offset_x = 0;
  double offset_y = 0;
  gfx::PointF ToDip(double css_x, double css_y, float device_scale) const;
};

// Where a frame's viewport sits inside the frames above it, in CSS pixels,
// as far up as the script could see (`levels` frames up).
struct FrameOffset {
  double x = 0;
  double y = 0;
  int levels = 0;
};

struct HintTarget {
  ffi::HintKind kind = ffi::HintKind::Other;
  gfx::RectF css_rect;  // visible part, layout-viewport CSS pixels
};

struct HintTargets {
  std::vector<HintTarget> targets;
  ViewportTransform transform;
  FrameOffset offset;
};

// Collects visible targets in document order: clickable elements, code
// blocks or text blocks. Remembers them in the isolated world for
// ActivationInfoScript.
std::u16string CollectHintsScript(ffi::HintTargets targets);
std::optional<HintTargets> ParseHintTargets(const base::Value& result);

// What ActivationInfoScript does to the element besides measuring it.
enum class ElementOp {
  kNone = 0,
  kFocus = 1,
  // Select its contents (Visual mode).
  kSelect = 2,
  // Return its text (copying a code block).
  kReadText = 3,
};

// Re-reads one collected element: its current visible center, href and
// whether it is editable, after performing `op`.
std::u16string ActivationInfoScript(uint32_t index, ElementOp op);

struct ActivationInfo {
  gfx::PointF css_center;
  ViewportTransform transform;
  std::string href;
  bool editable = false;
  // With ElementOp::kReadText.
  std::string text;
  FrameOffset offset;
};
std::optional<ActivationInfo> ParseActivationInfo(const base::Value& result);

// Scrolls the most sensible element: the focused element's scrollable
// ancestor, the document, the element under the viewport center, or the
// largest visible scroller, in that order.
std::u16string ScrollScript(ffi::ScrollKind scroll,
                            int count,
                            int step_px,
                            bool smooth);

// -- Page structure (Phase 4) ------------------------------------------------

struct PageSpan {
  uint32_t start = 0;  // UTF-16 units
  uint32_t end = 0;
  ffi::SpanKind kind = ffi::SpanKind::Code;
  std::string href;
};

struct PageBlock {
  ffi::BlockKind kind = ffi::BlockKind::Paragraph;
  uint32_t level = 1;
  bool ordered = false;
  bool header = false;
  std::string lang;
  std::string text;
  uint32_t element = kNoElement;
  std::vector<PageSpan> spans;
};

struct PageDocument {
  std::string title;
  std::string url;
  std::vector<PageBlock> blocks;
};

// Extracts the page's readable structure; remembers headings, code blocks
// and tables for RevealScript.
std::u16string DocumentScript();
std::optional<PageDocument> ParseDocument(const base::Value& result);

// Scrolls a remembered block into view and flashes it.
std::u16string RevealScript(uint32_t element);
// Scrolls to the next or previous heading, code block, table, ...
std::u16string JumpScript(ffi::BlockJump kind, bool forward, int count);

// Visual mode: move the selection's focus; clear it; read it.
std::u16string ExtendSelectionScript(bool forward,
                                     ffi::SelectUnit unit,
                                     int count);
std::u16string ClearSelectionScript();

// Marks: the page's URL and scroll position; scrolling back to one.
struct MarkPosition {
  std::string url;
  int64_t x = 0;
  int64_t y = 0;
};
std::u16string MarkPositionScript();
std::optional<MarkPosition> ParseMarkPosition(const base::Value& result);
std::u16string ScrollToScript(int64_t x, int64_t y);
std::u16string SelectionTextScript();

// -- External editor -----------------------------------------------------------

struct FieldDescription {
  ffi::FieldKind kind = ffi::FieldKind::None;
  std::string input_type;
  std::string autocomplete;
  std::string label;
  uint32_t length = 0;
  bool read_only = false;
};

// Describes the focused field (never its value) and tags it with `token`.
std::u16string FieldInfoScript(uint64_t token);
std::optional<FieldDescription> ParseFieldInfo(const base::Value& result);
// The tagged field's text, or null if it is gone.
std::u16string FieldValueScript(uint64_t token);
// Replaces the tagged field's text; returns false if it is gone.
std::u16string FieldWriteScript(uint64_t token, std::string_view text);

}  // namespace modal_browser::page_scripts

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_PAGE_SCRIPTS_H_
