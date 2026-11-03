#include "chrome/renderer/merlin_adblock/request_throttle.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/task/bind_post_task.h"
#include "base/task/sequenced_task_runner.h"
#include "base/timer/timer.h"
#include "base/trace_event/trace_event.h"
#include "chrome/renderer/merlin_adblock/agent.h"
#include "components/merlin_adblock/common/features.h"
#include "components/merlin_adblock/common/request_type.h"
#include "content/public/renderer/render_frame.h"
#include "net/base/net_errors.h"
#include "net/url_request/redirect_info.h"
#include "third_party/blink/public/common/loader/url_loader_throttle.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/modules/service_worker/web_service_worker_network_provider.h"
#include "third_party/blink/public/web/web_document_loader.h"
#include "third_party/blink/public/web/web_local_frame.h"

namespace merlin_adblock {
namespace {
bool Controlled(blink::WebLocalFrame* frame) {
  auto* loader = frame ? frame->GetDocumentLoader() : nullptr;
  auto* provider = loader ? loader->GetServiceWorkerNetworkProvider() : nullptr;
  return provider && provider->GetControllerServiceWorkerMode() ==
                         blink::mojom::ControllerServiceWorkerMode::kControlled;
}
void CheckFrame(blink::LocalFrameToken token,
                GURL url,
                std::string method,
                uint8_t type,
                base::OnceCallback<void(mojom::RequestDecisionPtr)> done) {
  auto* frame = blink::WebLocalFrame::FromFrameToken(token);
  auto* render_frame =
      frame ? content::RenderFrame::FromWebFrame(frame) : nullptr;
  auto* agent = render_frame ? Agent::Get(render_frame) : nullptr;
  if (!agent || !Controlled(frame)) {
    std::move(done).Run(mojom::RequestDecision::New());
    return;
  }
  agent->CheckRequest(std::move(url), std::move(method), type, std::move(done));
}
class RequestThrottle : public blink::URLLoaderThrottle {
 public:
  RequestThrottle(blink::LocalFrameToken token,
                  scoped_refptr<base::SequencedTaskRunner> main_thread)
      : token_(token), main_thread_(std::move(main_thread)) {}
  explicit RequestThrottle(mojo::SharedRemote<mojom::AdblockWorkerHost> worker)
      : worker_(std::move(worker)) {}
  ~RequestThrottle() override { EndTrace(); }
  void WillStartRequest(network::ResourceRequest* request,
                        bool* defer) override {
    if (!request->url.SchemeIsHTTPOrHTTPS() || request->skip_service_worker ||
        ResourceKind(*request) == 1)
      return;
    url_ = request->url;
    method_ = request->method;
    type_ = ResourceKind(*request);
    *defer = true;
    Check();
  }
  void WillRedirectRequest(net::RedirectInfo* info,
                           const network::mojom::URLResponseHead&,
                           bool* defer,
                           network::HttpRequestHeadersUpdateParams*) override {
    if (!info->new_url.SchemeIsHTTPOrHTTPS())
      return;
    url_ = info->new_url;
    method_ = info->new_method;
    *defer = true;
    Check();
  }
  const char* NameForLoggingWillStartRequest() override {
    return "MerlinAdblockServiceWorker";
  }

 private:
  void Check() {
    tracing_ = true;
    TRACE_EVENT_BEGIN("loading", "MerlinAdblock.ServiceWorkerPolicy",
                      perfetto::NamedTrack::FromPointer("MerlinAdblock", this));
    const uint64_t ticket = ++ticket_;
    timer_.Start(
        FROM_HERE, base::Seconds(2),
        base::BindOnce(&RequestThrottle::Checked, weak_factory_.GetWeakPtr(),
                       ticket, mojom::RequestDecision::New()));
    if (worker_.is_bound()) {
      worker_->CheckRequest(url_, method_, type_,
                            base::BindOnce(&RequestThrottle::Checked,
                                           weak_factory_.GetWeakPtr(), ticket));
      return;
    }
    main_thread_->PostTask(
        FROM_HERE,
        base::BindOnce(
            &CheckFrame, token_, url_, method_, type_,
            base::BindPostTask(
                base::SequencedTaskRunner::GetCurrentDefault(),
                base::BindOnce(&RequestThrottle::Checked,
                               weak_factory_.GetWeakPtr(), ticket))));
  }
  void Checked(uint64_t ticket, mojom::RequestDecisionPtr decision) {
    if (ticket != ticket_)
      return;
    ++ticket_;
    timer_.Stop();
    EndTrace();
    if (decision->action == mojom::RequestAction::Block) {
      delegate_->CancelWithError(net::ERR_BLOCKED_BY_CLIENT,
                                 "Merlin native request policy");
      return;
    }
    if (decision->action == mojom::RequestAction::Replace ||
        decision->action == mojom::RequestAction::Rewrite) {
      const GURL target = decision->action == mojom::RequestAction::Rewrite
                              ? decision->rewritten_url
                              : url_;
      // Approved replacements go through the browser's ordinary network/CORS
      // factory; the worker cannot substitute cached ad content for the asset.
      if (!delegate_->UpdateDeferredRequest(
              target, decision->action == mojom::RequestAction::Replace)) {
        delegate_->CancelWithError(
            net::ERR_FAILED, "Native request modifier could not be applied");
        return;
      }
    }
    delegate_->Resume();
  }
  void EndTrace() {
    if (!tracing_)
      return;
    tracing_ = false;
    TRACE_EVENT_END("loading",
                    perfetto::NamedTrack::FromPointer("MerlinAdblock", this));
  }
  bool tracing_ = false;
  blink::LocalFrameToken token_;
  mojo::SharedRemote<mojom::AdblockWorkerHost> worker_;
  scoped_refptr<base::SequencedTaskRunner> main_thread_;
  GURL url_;
  std::string method_;
  uint8_t type_ = 0;
  uint64_t ticket_ = 0;
  base::OneShotTimer timer_;
  base::WeakPtrFactory<RequestThrottle> weak_factory_{this};
};
}  // namespace
WorkerRequestPolicy::WorkerRequestPolicy(
    const blink::BrowserInterfaceBrokerProxy& broker) {
  mojo::PendingRemote<mojom::AdblockWorkerHost> remote;
  broker.GetInterface(remote.InitWithNewPipeAndPassReceiver());
  host_.Bind(std::move(remote), base::SequencedTaskRunner::GetCurrentDefault());
}
WorkerRequestPolicy::~WorkerRequestPolicy() = default;
std::unique_ptr<blink::URLLoaderThrottle> WorkerRequestPolicy::CreateThrottle(
    const network::ResourceRequest& request) {
  if (!host_.is_bound() || !request.url.SchemeIsHTTPOrHTTPS() ||
      request.skip_service_worker)
    return nullptr;
  return std::make_unique<RequestThrottle>(host_);
}
scoped_refptr<WorkerRequestPolicy> CreateWorkerRequestPolicy(
    const blink::BrowserInterfaceBrokerProxy& broker) {
  if (!base::FeatureList::IsEnabled(kMerlinAdblock))
    return nullptr;
  return base::MakeRefCounted<WorkerRequestPolicy>(broker);
}
std::unique_ptr<blink::URLLoaderThrottle> MaybeCreateRequestThrottle(
    base::optional_ref<const blink::LocalFrameToken> frame,
    const network::ResourceRequest& request,
    scoped_refptr<base::SequencedTaskRunner> main_thread) {
  if (!base::FeatureList::IsEnabled(kMerlinAdblock) || !frame || !main_thread ||
      !request.url.SchemeIsHTTPOrHTTPS() || request.skip_service_worker)
    return nullptr;
  if (main_thread->RunsTasksInCurrentSequence() &&
      !Controlled(blink::WebLocalFrame::FromFrameToken(*frame)))
    return nullptr;
  return std::make_unique<RequestThrottle>(*frame, std::move(main_thread));
}
}  // namespace merlin_adblock
