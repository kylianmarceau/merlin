#include "chrome/browser/merlin_adblock/context.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "url/origin.h"
namespace merlin_adblock {
GURL EffectiveDocumentUrl(content::RenderFrameHost* frame) {
  for (unsigned depth = 0; frame && depth < 32; ++depth) {
    const auto& url = frame->GetLastCommittedURL();
    if (url.SchemeIsHTTPOrHTTPS())
      return url;
    if (!url.IsAboutBlank() && !url.IsAboutSrcdoc() && !url.is_empty())
      return {};
    auto* parent = frame->GetParentOrOuterDocument();
    if (!parent) {
      auto* contents = content::WebContents::FromRenderFrameHost(frame);
      parent = contents ? contents->GetOpener() : nullptr;
    }
    if (!parent) {
      auto origin = frame->GetLastCommittedOrigin().GetURL();
      return origin.SchemeIsHTTPOrHTTPS() ? origin : GURL();
    }
    frame = parent;
  }
  return {};
}
GURL TopDocumentUrl(content::RenderFrameHost* frame) {
  return frame ? EffectiveDocumentUrl(frame->GetOutermostMainFrame()) : GURL();
}
}  // namespace merlin_adblock
