// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_page_color.h"

#include <map>
#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/supports_user_data.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace modal_browser {

namespace {

// Short enough to follow a page; long enough not to be noticed.
constexpr base::TimeDelta kSoonDelay = base::Milliseconds(80);
constexpr base::TimeDelta kRefreshInterval = base::Seconds(2);
constexpr int kSampleWidth = 96;

// The last color read for a tab, kept on its WebContents.
class LastColor : public base::SupportsUserData::Data {
 public:
  static constexpr char kKey[] = "merlin_page_color";
  explicit LastColor(SkColor color) : color(color) {}
  SkColor color;
};

std::optional<SkColor> LastColorOf(content::WebContents* contents) {
  if (auto* data = static_cast<LastColor*>(
          contents->GetUserData(LastColor::kKey))) {
    return data->color;
  }
  return std::nullopt;
}

}  // namespace

PageColorSampler::PageColorSampler(Callback on_color)
    : on_color_(std::move(on_color)) {}

PageColorSampler::~PageColorSampler() = default;

void PageColorSampler::Watch(content::WebContents* contents) {
  if (contents == web_contents()) {
    return;
  }
  Observe(contents);
  refresh_.Stop();
  soon_.Stop();
  if (!contents) {
    SetColor(std::nullopt);
    return;
  }
  // What it was last time, else what the page says its background is.
  std::optional<SkColor> color = LastColorOf(contents);
  if (!color) {
    color = contents->GetBackgroundColor();
    if (color && SkColorGetA(*color) != SK_AlphaOPAQUE) {
      color.reset();
    }
  }
  SetColor(color);
  SampleSoon();
  refresh_.Start(FROM_HERE, kRefreshInterval,
                 base::BindRepeating(&PageColorSampler::Sample,
                                     base::Unretained(this)));
}

void PageColorSampler::SampleSoon() {
  soon_.Start(FROM_HERE, kSoonDelay,
              base::BindOnce(&PageColorSampler::Sample,
                             base::Unretained(this)));
}

void PageColorSampler::Sample() {
  content::WebContents* contents = web_contents();
  if (!contents || sampling_) {
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
  view->CopyFromSurface(
      gfx::Rect(0, 0, size.width(), 2), gfx::Size(kSampleWidth, 1),
      base::TimeDelta(),
      base::BindOnce(&PageColorSampler::OnSampled, weak_factory_.GetWeakPtr(),
                     contents->GetWeakPtr()));
}

void PageColorSampler::OnSampled(base::WeakPtr<content::WebContents> contents,
                                 const content::CopyFromSurfaceResult& result) {
  sampling_ = false;
  if (!contents || !result.has_value()) {
    return;
  }
  const std::optional<SkColor> color = DominantColor(result->bitmap);
  if (!color) {
    return;
  }
  contents->SetUserData(LastColor::kKey, std::make_unique<LastColor>(*color));
  if (contents.get() == web_contents()) {
    SetColor(color);
  }
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
  // A strip with no clear background (a photo, a gradient) keeps the bar
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
  SampleSoon();
}

void PageColorSampler::DidChangeThemeColor() {
  SampleSoon();
}

void PageColorSampler::OnBackgroundColorChanged() {
  SampleSoon();
}

void PageColorSampler::WebContentsDestroyed() {
  Watch(nullptr);
}

}  // namespace modal_browser
