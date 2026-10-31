// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_page_color.h"

#include <algorithm>
#include <map>
#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/supports_user_data.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/page.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace modal_browser {

namespace {

// Short enough to follow a page; long enough not to be noticed.
constexpr base::TimeDelta kSoonDelay = base::Milliseconds(80);
// The viewport is scaled down to at most this many points on a
// side — enough to know its colors, small enough to be cheap.
constexpr int kSampleWidth = 96;
constexpr int kSampleHeight = 96;

// The last result for a document, including a neutral fallback.
class LastColor : public base::SupportsUserData::Data {
 public:
  static constexpr char kKey[] = "merlin_page_color";
  explicit LastColor(std::optional<SkColor> color) : color(color) {}
  std::optional<SkColor> color;
};

LastColor* LastColorOf(content::WebContents* contents) {
  return static_cast<LastColor*>(
      contents->GetPrimaryPage().GetUserData(LastColor::kKey));
}

}  // namespace

PageColorSampler::PageColorSampler(Callback on_color)
    : on_color_(std::move(on_color)) {}

PageColorSampler::~PageColorSampler() = default;

void PageColorSampler::Watch(content::WebContents* contents) {
  if (contents == web_contents()) {
    return;
  }
  weak_factory_.InvalidateWeakPtrs();
  sampling_ = false;
  Observe(contents);
  soon_.Stop();
  if (!contents) {
    SetColor(std::nullopt);
    return;
  }
  // A cached neutral result is also final for this document. Switching
  // back must not sample a different scrolled viewport.
  if (LastColor* cached = LastColorOf(contents)) {
    SetColor(cached->color);
    return;
  }
  SetColor(std::nullopt);
  SampleSoon();
}

void PageColorSampler::SampleSoon() {
  soon_.Start(FROM_HERE, kSoonDelay,
              base::BindOnce(&PageColorSampler::Sample,
                             base::Unretained(this)));
}

void PageColorSampler::Sample() {
  content::WebContents* contents = web_contents();
  if (!contents) {
    return;
  }
  if (sampling_) {
    SampleSoon();
    return;
  }
  content::RenderWidgetHostView* view = contents->GetRenderWidgetHostView();
  if (!view || !view->IsSurfaceAvailableForCopy()) {
    return;
  }
  const gfx::Size size = view->GetViewBounds().size();
  if (size.IsEmpty()) {
    return;
  }
  sampling_ = true;
  // The visible viewport, scaled down, so the color is the majority of what the
  // site looks like — not just its top edge, which changes as it scrolls.
  const int height =
      std::clamp(size.height() * kSampleWidth / size.width(), 1, kSampleHeight);
  view->CopyFromSurface(
      gfx::Rect(size), gfx::Size(kSampleWidth, height), base::TimeDelta(),
      base::BindOnce(&PageColorSampler::OnSampled, weak_factory_.GetWeakPtr(),
                     contents->GetPrimaryMainFrame()->GetWeakDocumentPtr()));
}

void PageColorSampler::OnSampled(content::WeakDocumentPtr document,
                                 const content::CopyFromSurfaceResult& result) {
  sampling_ = false;
  auto* frame = document.AsRenderFrameHostIfValid();
  if (!frame || !web_contents() ||
      frame != web_contents()->GetPrimaryMainFrame() || !result.has_value()) {
    return;
  }
  const auto color = DominantColor(result->bitmap);
  frame->GetPage().SetUserData(LastColor::kKey,
                             std::make_unique<LastColor>(color));
  SetColor(color);  // No dominant colour explicitly restores neutral chrome.
}

// static
std::optional<SkColor> PageColorSampler::DominantColor(const SkBitmap& bitmap) {
  if (bitmap.drawsNothing()) {
    return std::nullopt;
  }
  // Count colors in buckets of 16 levels per channel, then average the
  // pixels in the biggest bucket, so a few pixels of text or a logo do not
  // tint the bar.
  struct Bucket {
    int count = 0;
    int r = 0, g = 0, b = 0;
  };
  std::map<uint32_t, Bucket> buckets;
  for (int y = 0; y < bitmap.height(); ++y) {
    for (int x = 0; x < bitmap.width(); ++x) {
      const SkColor c = bitmap.getColor(x, y);
      if (SkColorGetA(c) < 0xF0) {
        continue;
      }
      const uint32_t key = ((SkColorGetR(c) >> 4) << 8) |
                           ((SkColorGetG(c) >> 4) << 4) | (SkColorGetB(c) >> 4);
      Bucket& bucket = buckets[key];
      ++bucket.count;
      bucket.r += SkColorGetR(c);
      bucket.g += SkColorGetG(c);
      bucket.b += SkColorGetB(c);
    }
  }
  const Bucket* best = nullptr;
  int total = 0;
  for (const auto& [key, bucket] : buckets) {
    total += bucket.count;
    if (!best || bucket.count > best->count) {
      best = &bucket;
    }
  }
  // A page with no clear background (a photo, a gradient) keeps the bar
  // neutral rather than picking a stripe of it.
  if (!best || best->count * 3 < total) {
    return std::nullopt;
  }
  return SkColorSetRGB(best->r / best->count, best->g / best->count,
                       best->b / best->count);
}

void PageColorSampler::SetColor(std::optional<SkColor> color) {
  if (color == color_) {
    return;
  }
  color_ = color;
  on_color_.Run(color_);
}

void PageColorSampler::DidFirstVisuallyNonEmptyPaint() {
  SampleSoon();
}

void PageColorSampler::DidStopLoading() {
  SampleSoon();
}

void PageColorSampler::PrimaryPageChanged(content::Page& page) {
  weak_factory_.InvalidateWeakPtrs();
  sampling_ = false;
  soon_.Stop();
  if (LastColor* cached = LastColorOf(web_contents())) {
    SetColor(cached->color);
  } else {
    SetColor(std::nullopt);
    SampleSoon();
  }
}

void PageColorSampler::WebContentsDestroyed() {
  Watch(nullptr);
}

}  // namespace modal_browser
