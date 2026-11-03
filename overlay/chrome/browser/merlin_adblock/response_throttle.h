#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_RESPONSE_THROTTLE_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_RESPONSE_THROTTLE_H_
#include <memory>
#include "base/functional/callback.h"
namespace blink {
class URLLoaderThrottle;
}
namespace content {
class BrowserContext;
class WebContents;
}  // namespace content
namespace network {
struct ResourceRequest;
}
namespace merlin_adblock {
std::unique_ptr<blink::URLLoaderThrottle> MaybeCreateResponseThrottle(
    const network::ResourceRequest& request,
    content::BrowserContext* context,
    const base::RepeatingCallback<content::WebContents*()>& contents);
}
#endif
