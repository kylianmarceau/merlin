#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_DOCUMENT_HOST_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_DOCUMENT_HOST_H_
#include "components/merlin_adblock/common/adblock.mojom.h"
#include "mojo/public/cpp/bindings/pending_receiver.h"
namespace content {
class RenderFrameHost;
}
namespace merlin_adblock {
void BindDocumentHost(content::RenderFrameHost* frame,
                      mojo::PendingReceiver<mojom::AdblockHost> receiver);
}
#endif
