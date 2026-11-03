#include "chrome/browser/merlin_adblock/response_throttle.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "components/merlin_adblock/common/features.h"
#include "components/merlin_adblock/common/request_type.h"
#include "content/public/browser/network_service_instance.h"
#include "content/public/browser/web_contents.h"
#include "net/http/http_response_headers.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/mojom/network_service.mojom.h"
#include "services/network/public/mojom/parsed_headers.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "third_party/blink/public/common/loader/url_loader_throttle.h"

namespace merlin_adblock {
namespace {
// Network responses receive additive CSP inside the browser factory. A service
// worker may synthesize a navigation without reaching that factory, so inspect
// that response before NavigationRequest computes its commit policies.
class ResponseThrottle : public blink::URLLoaderThrottle {
 public:
  ResponseThrottle(base::WeakPtr<Service> service,
                   GURL source,
                   GURL top,
                   bool main_document)
      : service_(std::move(service)),
        source_(std::move(source)),
        top_(std::move(top)),
        main_document_(main_document) {}
  void WillProcessResponse(const GURL& url,
                           network::mojom::URLResponseHead* head,
                           bool* defer) override {
    if (!service_ || !url.SchemeIsHTTPOrHTTPS() || !head->headers ||
        !head->was_fetched_via_service_worker)
      return;
    if (main_document_)
      top_ = url;
    if (!service_->EnabledFor(top_))
      return;
    url_ = url;
    head_ = head->Clone();
    *defer = true;
    timer_.Start(FROM_HERE, base::Seconds(2),
                 base::BindOnce(&ResponseThrottle::Finish,
                                weak_factory_.GetWeakPtr(), false));
    service_->Csp(
        url, source_, top_, main_document_,
        base::BindOnce(&ResponseThrottle::Policy, weak_factory_.GetWeakPtr()));
  }
  const char* NameForLoggingWillProcessResponse() override {
    return "MerlinAdblockServiceWorkerCsp";
  }

 private:
  void Policy(std::string policy) {
    if (!head_)
      return;
    if (policy.empty() || policy.size() > 64 * 1024 ||
        policy.find_first_of("\r\n") != std::string::npos) {
      Finish(false);
      return;
    }
    headers_ = base::MakeRefCounted<net::HttpResponseHeaders>(
        head_->headers->raw_headers());
    headers_->AddHeader("Content-Security-Policy", policy);
    content::GetNetworkService()->ParseHeaders(
        url_, headers_,
        base::BindOnce(&ResponseThrottle::Parsed, weak_factory_.GetWeakPtr()));
  }
  void Parsed(network::mojom::ParsedHeadersPtr parsed) {
    if (!head_)
      return;
    if (!parsed) {
      Finish(false);
      return;
    }
    head_->headers = std::move(headers_);
    head_->parsed_headers = std::move(parsed);
    Finish(true);
  }
  void Finish(bool changed) {
    if (!head_)
      return;
    timer_.Stop();
    if (changed)
      delegate_->UpdateDeferredResponseHead(std::move(head_), {});
    else
      head_.reset();
    headers_.reset();
    delegate_->Resume();
  }
  base::WeakPtr<Service> service_;
  const GURL source_;
  GURL top_;
  const bool main_document_;
  GURL url_;
  network::mojom::URLResponseHeadPtr head_;
  scoped_refptr<net::HttpResponseHeaders> headers_;
  base::OneShotTimer timer_;
  base::WeakPtrFactory<ResponseThrottle> weak_factory_{this};
};
}  // namespace
std::unique_ptr<blink::URLLoaderThrottle> MaybeCreateResponseThrottle(
    const network::ResourceRequest& request,
    content::BrowserContext* context,
    const base::RepeatingCallback<content::WebContents*()>& contents) {
  if (!base::FeatureList::IsEnabled(kMerlinAdblock))
    return nullptr;
  const uint8_t kind = ResourceKind(request);
  if (kind != 1 && kind != 2)
    return nullptr;
  auto* service = Service::Get(context);
  if (!service)
    return nullptr;
  GURL top;
  if (request.trusted_params &&
      request.trusted_params->isolation_info.top_frame_origin())
    top = request.trusted_params->isolation_info.top_frame_origin()->GetURL();
  else if (auto* page = contents.Run())
    top = page->GetLastCommittedURL();
  return std::make_unique<ResponseThrottle>(
      service->GetWeakPtr(),
      request.request_initiator ? request.request_initiator->GetURL() : GURL(),
      top, kind == 1);
}
}  // namespace merlin_adblock
