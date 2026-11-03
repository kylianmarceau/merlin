#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_HANDSHAKE_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_HANDSHAKE_H_
#include "base/memory/weak_ptr.h"
#include "content/public/browser/websocket_connection_policy.h"
namespace merlin_adblock {
class Service;
void CheckHandshake(base::WeakPtr<Service> service,
                    uint8_t resource_type,
                    content::GlobalRenderFrameHostId frame,
                    const url::Origin& source,
                    const GURL& url,
                    content::WebSocketPolicyResult done);
void CheckWebTransport(int process_id,
                       int frame_id,
                       const url::Origin& source,
                       const GURL& url,
                       content::WebSocketPolicyResult done);
}  // namespace merlin_adblock
#endif
