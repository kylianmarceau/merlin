#include "chrome/browser/merlin_adblock/worker_host.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/merlin_adblock/context.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/weak_document_ptr.h"
#include "mojo/public/cpp/bindings/binder_map.h"
#include "mojo/public/cpp/bindings/self_owned_receiver.h"
#include "url/origin.h"

namespace merlin_adblock {
namespace {
class WorkerHost : public mojom::AdblockWorkerHost {
 public:
  WorkerHost(base::WeakPtr<Service> service,
             GURL source,
             GURL top,
             content::WeakDocumentPtr document)
      : service_(std::move(service)),
        source_(std::move(source)),
        top_(std::move(top)),
        document_(std::move(document)) {}
  void CheckRequest(const GURL& url,
                    const std::string& method,
                    uint8_t type,
                    CheckRequestCallback done) override {
    if (!service_ || !url.SchemeIsHTTPOrHTTPS() || url.spec().size() > 16384 ||
        method.size() > 32 || type > 11 || pending_ >= 256) {
      std::move(done).Run(mojom::RequestDecision::New());
      return;
    }
    ++pending_;
    service_->Check(
        url, source_, top_, method, type,
        base::BindOnce(&WorkerHost::Checked, weak_factory_.GetWeakPtr(),
                       std::move(done)));
  }

 private:
  void Checked(CheckRequestCallback done, Decision decision) {
    --pending_;
    auto result = mojom::RequestDecision::New();
    switch (decision.kind) {
      case DecisionKind::kBlock:
        result->action = mojom::RequestAction::Block;
        if (service_ && document_.AsRenderFrameHostIfValid())
          service_->CountBlocked(
              document_.AsRenderFrameHostIfValid()->GetGlobalId());
        break;
      case DecisionKind::kReplace:
        result->action = mojom::RequestAction::Replace;
        break;
      case DecisionKind::kRewrite:
        result->action = mojom::RequestAction::Rewrite;
        result->rewritten_url = decision.rewritten_url;
        break;
      default:
        break;
    }
    std::move(done).Run(std::move(result));
  }
  base::WeakPtr<Service> service_;
  const GURL source_;
  const GURL top_;
  content::WeakDocumentPtr document_;
  unsigned pending_ = 0;
  base::WeakPtrFactory<WorkerHost> weak_factory_{this};
};
}  // namespace

void RegisterWorkerBinders(content::BrowserContext* context,
                           const url::Origin& origin,
                           content::RenderFrameHost* ancestor,
                           mojo::BinderMap* map) {
  auto* service = base::FeatureList::IsEnabled(kMerlinAdblock)
                      ? Service::Get(context)
                      : nullptr;
  // A dedicated worker retains its creating document's exception context.
  // Shared workers use their owning origin, independent of any active client.
  map->Add<mojom::AdblockWorkerHost>(base::BindRepeating(
      [](base::WeakPtr<Service> service, GURL source, GURL top,
         content::WeakDocumentPtr document,
         mojo::PendingReceiver<mojom::AdblockWorkerHost> receiver) {
        mojo::MakeSelfOwnedReceiver(
            std::make_unique<WorkerHost>(service, source, top, document),
            std::move(receiver));
      },
      service ? service->GetWeakPtr() : base::WeakPtr<Service>(),
      origin.GetURL(), ancestor ? TopDocumentUrl(ancestor) : origin.GetURL(),
      ancestor ? ancestor->GetWeakDocumentPtr() : content::WeakDocumentPtr()));
}
}  // namespace merlin_adblock
