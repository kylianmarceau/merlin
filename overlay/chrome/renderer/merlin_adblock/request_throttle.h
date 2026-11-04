#ifndef CHROME_RENDERER_MERLIN_ADBLOCK_REQUEST_THROTTLE_H_
#define CHROME_RENDERER_MERLIN_ADBLOCK_REQUEST_THROTTLE_H_
#include <memory>
#include "base/memory/ref_counted.h"
#include "base/memory/scoped_refptr.h"
#include "base/types/optional_ref.h"
#include "components/merlin_adblock/common/adblock.mojom.h"
#include "mojo/public/cpp/bindings/pending_remote.h"
#include "mojo/public/cpp/bindings/shared_remote.h"
#include "third_party/blink/public/common/tokens/tokens.h"
namespace base {
class SequencedTaskRunner;
}
namespace network {
struct ResourceRequest;
}
namespace blink {
class BrowserInterfaceBrokerProxy;
class URLLoaderThrottle;
class WebLocalFrame;
}  // namespace blink
namespace merlin_adblock {
class WorkerRequestPolicy : public base::RefCounted<WorkerRequestPolicy> {
 public:
  explicit WorkerRequestPolicy(
      const blink::BrowserInterfaceBrokerProxy& broker);
  std::unique_ptr<blink::URLLoaderThrottle> CreateThrottle(
      const network::ResourceRequest& request);

 private:
  friend class base::RefCounted<WorkerRequestPolicy>;
  ~WorkerRequestPolicy();
  mojo::SharedRemote<mojom::AdblockWorkerHost> host_;
};
scoped_refptr<WorkerRequestPolicy> CreateWorkerRequestPolicy(
    const blink::BrowserInterfaceBrokerProxy& broker);
bool IsServiceWorkerControlled(blink::WebLocalFrame* frame);
// Main-thread bookkeeping read by throttles on any thread. Background resource
// fetches consult this instead of waiting on the busy main thread. `host` is
// bound only for controlled documents, whose requests may be answered by a
// service worker without reaching the browser's network proxy.
void SetFrameRequestPolicy(const blink::LocalFrameToken& frame,
                           bool controlled,
                           mojo::PendingRemote<mojom::AdblockHost> host);
void RemoveFrameRequestPolicy(const blink::LocalFrameToken& frame);
std::unique_ptr<blink::URLLoaderThrottle> MaybeCreateRequestThrottle(
    base::optional_ref<const blink::LocalFrameToken> frame,
    const network::ResourceRequest& request,
    scoped_refptr<base::SequencedTaskRunner> main_thread);
}  // namespace merlin_adblock
#endif
