#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_WORKER_HOST_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_WORKER_HOST_H_
namespace content {
class BrowserContext;
class RenderFrameHost;
}  // namespace content
namespace mojo {
class BinderMap;
}
namespace url {
class Origin;
}
namespace merlin_adblock {
void RegisterWorkerBinders(content::BrowserContext* context,
                           const url::Origin& origin,
                           content::RenderFrameHost* ancestor,
                           mojo::BinderMap* map);
}
#endif
