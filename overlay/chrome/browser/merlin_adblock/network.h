#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_NETWORK_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_NETWORK_H_
#include "content/public/browser/content_browser_client.h"
namespace merlin_adblock {
void InstallInterceptor(
    content::BrowserContext* context,
    content::RenderFrameHost* frame,
    content::ContentBrowserClient::URLLoaderFactoryType type,
    const url::Origin& initiator,
    const net::IsolationInfo& isolation,
    std::optional<int64_t> navigation_id,
    network::URLLoaderFactoryBuilder& builder,
    network::mojom::URLLoaderFactoryOverridePtr* factory_override);
uint8_t ResourceKind(const network::ResourceRequest& request);
}  // namespace merlin_adblock
#endif
