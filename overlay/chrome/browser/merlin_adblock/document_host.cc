#include "chrome/browser/merlin_adblock/document_host.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/self_deleting.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/merlin_adblock/context.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/browser/document_service.h"
#include "content/public/browser/render_frame_host.h"

namespace merlin_adblock {
namespace {
class DocumentHost : public content::DocumentService<mojom::AdblockHost> {
 public:
  DocumentHost(content::RenderFrameHost& frame,
               mojo::PendingReceiver<mojom::AdblockHost> receiver,
               base::SelfDeletingPassKey key)
      : DocumentService(frame, std::move(receiver), key),
        service_(Service::Get(frame.GetBrowserContext())->GetWeakPtr()) {}
  void CheckRequest(const GURL& url,
                    const std::string& method,
                    uint8_t type,
                    CheckRequestCallback done) override {
    if (!service_ || !url.SchemeIsHTTPOrHTTPS() || url.spec().size() > 16384 ||
        method.size() > 32 || type > 12 || requests_ >= 256) {
      std::move(done).Run(mojom::RequestDecision::New());
      return;
    }
    ++requests_;
    service_->Check(
        url, render_frame_host().GetLastCommittedOrigin().GetURL(), Top(),
        method, type,
        base::BindOnce(&DocumentHost::Checked, weak_factory_.GetWeakPtr(),
                       std::move(done)));
  }
  void GenericSelectors(const std::string& token,
                        const std::vector<std::string>& classes,
                        const std::vector<std::string>& ids,
                        GenericSelectorsCallback done) override {
    if (!service_ || token.size() > 128 || classes.size() + ids.size() > 256 ||
        pending_) {
      std::move(done).Run({});
      return;
    }
    for (const auto& list : {classes, ids})
      for (const auto& value : list) {
        if (value.size() > 256) {
          std::move(done).Run({});
          return;
        }
      }
    pending_ = true;
    // Source, top-level policy, generichide and exceptions come from the bound
    // document. The renderer supplies only bounded DOM identifiers.
    auto* service = service_.get();
    if (configured_ && generation_ == service->generation()) {
      RunGeneric(std::move(classes), std::move(ids), std::move(done));
      return;
    }
    service->Configure(
        EffectiveDocumentUrl(&render_frame_host()), Top(),
        base::BindOnce(&DocumentHost::Configured, weak_factory_.GetWeakPtr(),
                       classes, ids, std::move(done)));
  }

 private:
  // DocumentService deletes itself with the document or its connection.
  ~DocumentHost() override = default;

  void Checked(CheckRequestCallback done, Decision decision) {
    --requests_;
    auto result = mojom::RequestDecision::New();
    switch (decision.kind) {
      case DecisionKind::kBlock:
        result->action = mojom::RequestAction::Block;
        if (service_)
          service_->CountBlocked(render_frame_host().GetGlobalId());
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
  GURL Top() { return TopDocumentUrl(&render_frame_host()); }
  void Configured(std::vector<std::string> classes,
                  std::vector<std::string> ids,
                  GenericSelectorsCallback done,
                  mojom::DocumentConfigPtr config) {
    configured_ = true;
    generation_ = config->generation;
    generic_enabled_ = config->enabled && !config->generichide;
    exceptions_ = std::move(config->exceptions);
    RunGeneric(std::move(classes), std::move(ids), std::move(done));
  }
  void RunGeneric(std::vector<std::string> classes,
                  std::vector<std::string> ids,
                  GenericSelectorsCallback done) {
    if (!service_ || !generic_enabled_) {
      pending_ = false;
      std::move(done).Run({});
      return;
    }
    service_->Generic(
        Top(), std::move(classes), std::move(ids), exceptions_,
        base::BindOnce(&DocumentHost::Finished, weak_factory_.GetWeakPtr(),
                       std::move(done)));
  }
  void Finished(GenericSelectorsCallback done,
                std::vector<std::string> selectors) {
    pending_ = false;
    std::move(done).Run(std::move(selectors));
  }
  base::WeakPtr<Service> service_;
  bool pending_ = false;
  unsigned requests_ = 0;
  bool configured_ = false;
  bool generic_enabled_ = false;
  uint64_t generation_ = 0;
  std::vector<std::string> exceptions_;
  base::WeakPtrFactory<DocumentHost> weak_factory_{this};
};
}  // namespace
void BindDocumentHost(content::RenderFrameHost* frame,
                      mojo::PendingReceiver<mojom::AdblockHost> receiver) {
  if (base::FeatureList::IsEnabled(kMerlinAdblock))
    if (Service::Get(frame->GetBrowserContext()))
      base::MakeSelfDeleting<DocumentHost>(*frame, std::move(receiver));
}
}  // namespace merlin_adblock
