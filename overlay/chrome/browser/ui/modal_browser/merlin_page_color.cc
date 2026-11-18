// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_page_color.h"

#include <array>
#include <cstdint>

#include "base/functional/bind.h"
#include "base/time/time.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/visibility.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/geometry/size.h"

namespace modal_browser {
namespace {
// The band read across the top of the page, in view points. Tall enough that
// a thin coloured rule above a white header doesn't decide the colour, short
// enough to stay inside a site's header bar.
constexpr int kBand = 20;
// The band is scaled to this many pixels before it is counted.
constexpr int kColumns = 64;
constexpr int kRows = 8;
// The main colour must cover this share of the band; an image or a busy
// header has no colour of its own to continue.
constexpr int kMajorityPercent = 45;
}  // namespace

PageEdgeColor::PageEdgeColor(content::WebContents* contents)
    : content::WebContentsUserData<PageEdgeColor>(*contents) {}
PageEdgeColor::~PageEdgeColor() = default;

// static
std::optional<SkColor> PageEdgeColor::Get(content::WebContents* contents) {
  auto* data = contents ? FromWebContents(contents) : nullptr;
  return data ? data->color_ : std::nullopt;
}

// static
void PageEdgeColor::PageChanged(content::WebContents* contents) {
  if (auto* data = contents ? FromWebContents(contents) : nullptr) data->stale_ = true;
}

// static
void PageEdgeColor::Sample(content::WebContents* contents, base::RepeatingClosure changed) {
  if (!contents || contents->GetVisibility() != content::Visibility::VISIBLE) return;
  auto* view = contents->GetRenderWidgetHostView();
  if (!view || !view->IsSurfaceAvailableForCopy()) return;
  const gfx::Size size = view->GetViewBounds().size();
  if (size.width() < kColumns || size.height() < kBand) return;
  auto* data = GetOrCreateForWebContents(contents);
  if (data->reading_) return;
  data->reading_ = true;
  // The read describes this document: one that arrives after the page has
  // navigated is dropped, so the next page never takes the last one's colour.
  content::WeakDocumentPtr document = contents->GetPrimaryMainFrame()->GetWeakDocumentPtr();
  // Counted where the copy arrives; only the result goes back to the UI thread.
  view->CopyFromSurface(
      gfx::Rect(0, 0, size.width(), kBand), gfx::Size(kColumns, kRows), base::Seconds(1),
      base::BindOnce(
          [](base::WeakPtr<PageEdgeColor> self, base::RepeatingClosure changed,
             content::WeakDocumentPtr document, const content::CopyFromSurfaceResult& result) {
            const bool read = result.has_value() && !result->bitmap.drawsNothing();
            const std::optional<SkColor> color = read ? MainColor(result->bitmap) : std::nullopt;
            content::GetUIThreadTaskRunner({})->PostTask(
                FROM_HERE, base::BindOnce(
                               [](base::WeakPtr<PageEdgeColor> self, base::RepeatingClosure changed,
                                  content::WeakDocumentPtr document, bool read, std::optional<SkColor> color) {
                                 if (!self) return;
                                 self->reading_ = false;
                                 content::RenderFrameHost* frame = document.AsRenderFrameHostIfValid();
                                 if (!frame || frame != self->GetWebContents().GetPrimaryMainFrame()) return;
                                 if (read) self->OnSampled(std::move(changed), color);
                               },
                               self, std::move(changed), std::move(document), read, color));
          },
          data->weak_factory_.GetWeakPtr(), std::move(changed), std::move(document)));
}

void PageEdgeColor::OnSampled(base::RepeatingClosure changed, std::optional<SkColor> color) {
  // A page whose edge has no main colour keeps the last one, unless that
  // belonged to the page before.
  const std::optional<SkColor> next = color ? color : (stale_ ? std::nullopt : color_);
  stale_ = false;
  if (next == color_) return;
  color_ = next;
  changed.Run();
}

// static
std::optional<SkColor> PageEdgeColor::MainColor(const SkBitmap& bitmap) {
  // Colours are counted in buckets of 16 levels a channel, so anti-aliasing
  // and dithering don't split one colour; the answer is the bucket's mean.
  struct Bucket {
    uint32_t count = 0, r = 0, g = 0, b = 0;
  };
  std::array<Bucket, 4096> buckets;
  uint32_t total = 0;
  for (int y = 0; y < bitmap.height(); ++y) {
    for (int x = 0; x < bitmap.width(); ++x) {
      const SkColor pixel = bitmap.getColor(x, y);
      if (SkColorGetA(pixel) < 250) continue;
      const uint32_t r = SkColorGetR(pixel), g = SkColorGetG(pixel), b = SkColorGetB(pixel);
      Bucket& bucket = buckets[(r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)];
      ++bucket.count;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      ++total;
    }
  }
  const Bucket* best = nullptr;
  for (const Bucket& bucket : buckets) {
    if (bucket.count && (!best || bucket.count > best->count)) best = &bucket;
  }
  if (!best || best->count * 100 < total * kMajorityPercent) return std::nullopt;
  return SkColorSetRGB(best->r / best->count, best->g / best->count, best->b / best->count);
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(PageEdgeColor);

}  // namespace modal_browser
