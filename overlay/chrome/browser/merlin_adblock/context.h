#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_CONTEXT_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_CONTEXT_H_
#include "url/gurl.h"
namespace content {
class RenderFrameHost;
}
namespace merlin_adblock {
GURL EffectiveDocumentUrl(content::RenderFrameHost* frame);
GURL TopDocumentUrl(content::RenderFrameHost* frame);
}  // namespace merlin_adblock
#endif
