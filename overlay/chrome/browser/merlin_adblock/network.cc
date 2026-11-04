#include "chrome/browser/merlin_adblock/network.h"

#include <utility>

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/ref_counted.h"
#include "base/memory/self_deleting.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/task/bind_post_task.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/timer/timer.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "components/merlin_adblock/common/features.h"
#include "components/merlin_adblock/common/request_type.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/network_service_instance.h"
#include "content/public/browser/render_frame_host.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "mojo/public/cpp/bindings/self_owned_receiver.h"
#include "mojo/public/cpp/system/data_pipe_producer.h"
#include "mojo/public/cpp/system/string_data_source.h"
#include "net/base/isolation_info.h"
#include "net/base/net_errors.h"
#include "net/http/http_response_headers.h"
#include "net/url_request/redirect_info.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/self_deleting_url_loader_factory.h"
#include "services/network/public/cpp/url_loader_completion_status.h"
#include "services/network/public/cpp/url_loader_factory_builder.h"
#include "services/network/public/mojom/early_hints.mojom.h"
#include "services/network/public/mojom/network_service.mojom.h"
#include "services/network/public/mojom/parsed_headers.mojom.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "third_party/blink/public/mojom/fetch/fetch_api_request.mojom.h"

namespace merlin_adblock {
namespace {
// Proxies run on their own sequence, away from the busy UI thread. Engine
// checks hop straight to the matcher thread and back; only rare work (blocked
// counts, CSP header parsing, waiting for a starting engine) visits the UI.
// SelfDeletingURLLoaderFactory is thread-affine, so this is one dedicated
// thread rather than a sequence that may migrate between pool workers.
scoped_refptr<base::SingleThreadTaskRunner> ProxyRunner() {
  static base::NoDestructor<scoped_refptr<base::SingleThreadTaskRunner>> runner(
      base::ThreadPool::CreateSingleThreadTaskRunner(
          {base::TaskPriority::USER_BLOCKING},
          base::SingleThreadTaskRunnerThreadMode::DEDICATED));
  return *runner;
}
struct Context {
  // Only dereferenced on the UI thread.
  base::WeakPtr<Service> service;
  scoped_refptr<RequestGate> gate;
  content::GlobalRenderFrameHostId frame;
  GURL source;
  GURL worker_site;
  GURL top_site;
  std::optional<int64_t> navigation_id;
  bool has_frame = false;
  bool security_wrapped = false;
  GURL Top() const {
    if (!has_frame)
      return worker_site;
    return top_site;
  }
};
void CheckRequest(const Context& context,
                  const GURL& url,
                  std::string method,
                  uint8_t kind,
                  base::OnceCallback<void(Decision)> done) {
  bool initializing = false;
  if (auto matcher = context.gate->MatcherFor(context.Top(), &initializing)) {
    matcher->Check(url, context.source, std::move(method), kind,
                   std::move(done));
    return;
  }
  if (!initializing) {
    std::move(done).Run(Decision());
    return;
  }
  // The engine is still starting: queue behind it on the UI thread.
  content::GetUIThreadTaskRunner({})->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](base::WeakPtr<Service> service, GURL url, GURL source, GURL top,
             std::string method, uint8_t kind,
             base::OnceCallback<void(Decision)> done) {
            if (!service) {
              std::move(done).Run(Decision());
              return;
            }
            service->Check(url, source, top, std::move(method), kind,
                           std::move(done));
          },
          context.service, url, context.source, context.Top(),
          std::move(method), kind,
          base::BindPostTaskToCurrentDefault(std::move(done))));
}
void CountBlocked(const Context& context) {
  if (!context.navigation_id && !context.has_frame)
    return;
  content::GetUIThreadTaskRunner({})->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<Service> service,
                        std::optional<int64_t> navigation,
                        content::GlobalRenderFrameHostId frame) {
                       if (!service)
                         return;
                       if (navigation)
                         service->CountNavigationBlocked(*navigation);
                       else
                         service->CountBlocked(frame);
                     },
                     context.service, context.navigation_id, context.frame));
}

// The downstream factory, shared by the proxy factory and its pending loads so
// a request never needs its own cloned factory pipe. Loads may outlive the
// proxy factory (Chromium lets URLLoaders outlive their factory receiver).
struct Target : base::RefCounted<Target> {
  explicit Target(mojo::PendingRemote<network::mojom::URLLoaderFactory> remote)
      : remote(std::move(remote)) {}
  mojo::Remote<network::mojom::URLLoaderFactory> remote;

 private:
  friend class base::RefCounted<Target>;
  ~Target() = default;
};

class Load : public network::mojom::URLLoader,
             public network::mojom::URLLoaderClient {
 public:
  Load(Context context,
       scoped_refptr<Target> target,
       int32_t id,
       uint32_t options,
       network::ResourceRequest request,
       mojo::PendingRemote<network::mojom::URLLoaderClient> client,
       net::MutableNetworkTrafficAnnotationTag annotation)
      : context_(std::move(context)),
        target_(std::move(target)),
        request_(std::move(request)),
        client_(std::move(client)),
        id_(id),
        options_(options),
        annotation_(annotation) {}
  static void Create(
      Context context,
      scoped_refptr<Target> target,
      mojo::PendingReceiver<network::mojom::URLLoader> receiver,
      int32_t id,
      uint32_t options,
      const network::ResourceRequest& request,
      mojo::PendingRemote<network::mojom::URLLoaderClient> client,
      const net::MutableNetworkTrafficAnnotationTag& annotation) {
    auto load =
        std::make_unique<Load>(std::move(context), std::move(target), id,
                               options, request, std::move(client), annotation);
    auto* pointer = load.get();
    pointer->binding_ =
        mojo::MakeSelfOwnedReceiver(std::move(load), std::move(receiver));
    pointer->client_.set_disconnect_handler(
        base::BindOnce(&Load::Close, pointer->weak_factory_.GetWeakPtr()));
    pointer->Check();
  }

  void FollowRedirect(network::HttpRequestHeadersUpdateParams headers,
                      const std::optional<GURL>& new_url) override {
    if (!redirect_) {
      Fail(net::ERR_UNEXPECTED);
      return;
    }
    GURL target = new_url.value_or(redirect_->new_url);
    // Retain Chromium's same-origin restriction for URLLoader::FollowRedirect.
    if (new_url &&
        !url::Origin::Create(*new_url).IsSameOriginWith(redirect_->new_url)) {
      Fail(net::ERR_UNSAFE_REDIRECT);
      return;
    }
    request_.url = target;
    request_.method = redirect_->new_method;
    redirect_.reset();
    follow_headers_ = std::move(headers);
    follow_headers_.Apply(request_.headers, request_.cors_exempt_headers);
    follow_url_ =
        target != redirect_original_url_ ? std::make_optional(target) : new_url;
    Check();
  }
  void SetPriority(net::RequestPriority priority, int32_t intra) override {
    if (loader_)
      loader_->SetPriority(priority, intra);
  }
  void OnReceiveEarlyHints(network::mojom::EarlyHintsPtr hints) override {
    client_->OnReceiveEarlyHints(std::move(hints));
  }
  void OnReceiveResponse(
      network::mojom::URLResponseHeadPtr head,
      mojo::ScopedDataPipeConsumerHandle body,
      std::optional<mojo_base::BigBuffer> metadata) override {
    const uint8_t kind = ResourceKind(request_);
    if ((kind != 1 && kind != 2) ||
        !context_.gate->EnabledFor(context_.Top()) || !head->headers) {
      client_->OnReceiveResponse(std::move(head), std::move(body),
                                 std::move(metadata));
      return;
    }
    response_head_ = std::move(head);
    response_body_ = std::move(body);
    response_metadata_ = std::move(metadata);
    // Hold later client messages (for example OnComplete) behind the response.
    receiver_.Pause();
    paused_for_csp_ = true;
    // The policy was requested when the request (or redirect) started, so it
    // is normally ready and the response is not delayed by an engine hop.
    if (csp_) {
      CspReady(std::move(*csp_));
      return;
    }
    timer_.Start(
        FROM_HERE, base::Seconds(2),
        base::BindOnce(&Load::ForwardResponse, weak_factory_.GetWeakPtr()));
    if (!csp_requested_)
      RequestCsp(request_.url);
    if (!csp_requested_)
      ForwardResponse();
  }
  void OnReceiveRedirect(const net::RedirectInfo& info,
                         network::mojom::URLResponseHeadPtr head) override {
    if (++redirects_ > 20) {
      Fail(net::ERR_TOO_MANY_REDIRECTS);
      return;
    }
    // Do not release the redirect target until it has also been evaluated.
    redirect_ = info;
    redirect_original_url_ = info.new_url;
    redirect_head_ = std::move(head);
    Check(info.new_url, info.new_method);
  }
  void OnUploadProgress(int64_t position,
                        int64_t total,
                        OnUploadProgressCallback callback) override {
    client_->OnUploadProgress(position, total, std::move(callback));
  }
  void OnTransferSizeUpdated(int32_t diff) override {
    client_->OnTransferSizeUpdated(diff);
  }
  void OnComplete(const network::URLLoaderCompletionStatus& status) override {
    client_->OnComplete(status);
    Close();
  }

 private:
  void RequestCsp(const GURL& url) {
    const uint8_t kind = ResourceKind(request_);
    csp_.reset();
    csp_requested_ = false;
    if (kind != 1 && kind != 2)
      return;
    bool initializing = false;
    auto matcher = context_.gate->MatcherFor(context_.Top(), &initializing);
    if (!matcher)
      return;
    csp_requested_ = true;
    matcher->Csp(url, context_.source, kind == 1,
                 base::BindOnce(&Load::CspFetched, weak_factory_.GetWeakPtr(),
                                ++csp_ticket_));
  }
  void CspFetched(uint64_t ticket, std::string policy) {
    if (ticket != csp_ticket_)
      return;
    if (response_head_)
      CspReady(std::move(policy));
    else
      csp_ = std::move(policy);
  }
  void CspReady(std::string policy) {
    if (!response_head_)
      return;
    if (policy.empty() || policy.size() > 64 * 1024 ||
        policy.find_first_of("\r\n") != std::string::npos) {
      ForwardResponse();
      return;
    }
    csp_headers_ = base::MakeRefCounted<net::HttpResponseHeaders>(
        response_head_->headers->raw_headers());
    csp_headers_->AddHeader("Content-Security-Policy", policy);
    // Header parsing stays in the sandboxed Network Service. Existing CSP is
    // retained as a separate policy; an added policy can only restrict it.
    content::GetUIThreadTaskRunner({})->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](GURL url, scoped_refptr<net::HttpResponseHeaders> headers,
               base::OnceCallback<void(network::mojom::ParsedHeadersPtr)>
                   done) {
              content::GetNetworkService()->ParseHeaders(url, headers,
                                                         std::move(done));
            },
            request_.url, csp_headers_,
            base::BindPostTaskToCurrentDefault(base::BindOnce(
                &Load::CspParsed, weak_factory_.GetWeakPtr()))));
  }
  void CspParsed(network::mojom::ParsedHeadersPtr parsed) {
    if (!response_head_)
      return;
    if (parsed) {
      response_head_->headers = std::move(csp_headers_);
      response_head_->parsed_headers = std::move(parsed);
    }
    ForwardResponse();
  }
  void ForwardResponse() {
    if (!response_head_)
      return;
    timer_.Stop();
    ++csp_ticket_;
    client_->OnReceiveResponse(std::move(response_head_),
                               std::move(response_body_),
                               std::move(response_metadata_));
    csp_headers_.reset();
    if (std::exchange(paused_for_csp_, false))
      receiver_.Resume();
  }
  void Check() { Check(request_.url, request_.method); }
  void Check(GURL url, std::string method) {
    if (!context_.gate->alive()) {
      Fail(net::ERR_ABORTED);
      return;
    }
    // Look up any added CSP alongside the request, off its critical path.
    RequestCsp(url);
    const uint64_t check = ++check_;
    // The engine never blocks top-level documents (there is no recovery
    // interstitial), so navigations skip the matcher round trip entirely.
    if (ResourceKind(request_) == 1) {
      Checked(check, Decision());
      return;
    }
    timer_.Start(FROM_HERE, base::Seconds(2),
                 base::BindOnce(&Load::Checked, weak_factory_.GetWeakPtr(),
                                check, Decision()));
    CheckRequest(
        context_, url, std::move(method), ResourceKind(request_),
        base::BindOnce(&Load::Checked, weak_factory_.GetWeakPtr(), check));
  }
  void Checked(uint64_t check, Decision decision) {
    if (check != check_)
      return;
    ++check_;
    timer_.Stop();
    if (!context_.gate->alive()) {
      Fail(net::ERR_ABORTED);
      return;
    }
    if (decision.kind == DecisionKind::kBlock ||
        decision.kind == DecisionKind::kReplace) {
      if (!counted_) {
        CountBlocked(context_);
        counted_ = true;
      }
      if (decision.kind == DecisionKind::kReplace && context_.security_wrapped)
        Replace(std::move(decision));
      else
        Fail(net::ERR_BLOCKED_BY_CLIENT);
      return;
    }
    const GURL checked_url = redirect_ ? redirect_->new_url : request_.url;
    if (decision.kind == DecisionKind::kRewrite && redirect_ &&
        redirect_head_ && decision.rewritten_url.is_valid() &&
        url::Origin::Create(checked_url)
            .IsSameOriginWith(decision.rewritten_url)) {
      redirect_->new_url = decision.rewritten_url;
      redirect_head_->headers->SetHeader("Location",
                                         decision.rewritten_url.spec());
    }
    if (decision.kind == DecisionKind::kRewrite &&
        decision.rewritten_url.is_valid() &&
        url::Origin::Create(checked_url)
            .IsSameOriginWith(decision.rewritten_url) &&
        decision.rewritten_url != request_.url && !redirect_) {
      if (++redirects_ > 20) {
        Fail(net::ERR_TOO_MANY_REDIRECTS);
        return;
      }
      redirect_ = net::RedirectInfo::ComputeRedirectInfo(
          request_.method, request_.url, request_.site_for_cookies,
          net::RedirectInfo::FirstPartyURLPolicy::NEVER_CHANGE_URL,
          request_.referrer_policy, request_.referrer.spec(),
          request_.request_initiator, 307, decision.rewritten_url, std::nullopt,
          false);
      redirect_original_url_ = decision.rewritten_url;
      auto head = network::mojom::URLResponseHead::New();
      head->headers = net::HttpResponseHeaders::Builder(
                          net::HttpVersion(1, 1), "307 Temporary Redirect")
                          .AddHeader("Location", decision.rewritten_url.spec())
                          .Build();
      client_->OnReceiveRedirect(*redirect_, std::move(head));
      return;
    }
    if (redirect_ && redirect_head_) {
      client_->OnReceiveRedirect(*redirect_, std::move(redirect_head_));
      return;
    }
    if (loader_) {
      loader_->FollowRedirect(std::move(follow_headers_), follow_url_);
      return;
    }
    if (!target_->remote.is_connected()) {
      Fail(net::ERR_ABORTED);
      return;
    }
    target_->remote->CreateLoaderAndStart(
        loader_.BindNewPipeAndPassReceiver(), id_, options_, request_,
        receiver_.BindNewPipeAndPassRemote(), annotation_);
    receiver_.set_disconnect_handler(base::BindOnce(
        &Load::Fail, weak_factory_.GetWeakPtr(), net::ERR_ABORTED));
  }
  void Replace(Decision result) {
    loader_.reset();
    receiver_.reset();
    mojo::ScopedDataPipeProducerHandle producer;
    mojo::ScopedDataPipeConsumerHandle consumer;
    if (mojo::CreateDataPipe(nullptr, producer, consumer) != MOJO_RESULT_OK) {
      Fail(net::ERR_INSUFFICIENT_RESOURCES);
      return;
    }
    auto head = network::mojom::URLResponseHead::New();
    head->mime_type = result.mime;
    head->content_length = result.body.size();
    // No wildcard ACAO is added: CORS/ORB still wrap the inner factory.
    head->headers =
        net::HttpResponseHeaders::Builder(net::HttpVersion(1, 1), "200 OK")
            .AddHeader("Content-Type", result.mime)
            .AddHeader("Cache-Control", "no-store")
            .Build();
    client_->OnReceiveResponse(std::move(head), std::move(consumer),
                               std::nullopt);
    writer_ = std::make_unique<mojo::DataPipeProducer>(std::move(producer));
    writer_->Write(
        std::make_unique<mojo::StringDataSource>(
            result.body, mojo::StringDataSource::AsyncWritingMode::
                             STRING_MAY_BE_INVALIDATED_BEFORE_COMPLETION),
        base::BindOnce(
            [](base::WeakPtr<Load> self, size_t size, MojoResult result) {
              if (!self)
                return;
              self->writer_.reset();
              network::URLLoaderCompletionStatus status(
                  result == MOJO_RESULT_OK ? net::OK : net::ERR_FAILED);
              status.decoded_body_length = base::ByteSize(size);
              self->OnComplete(status);
            },
            weak_factory_.GetWeakPtr(), result.body.size()));
  }
  void Fail(int error) {
    OnComplete(network::URLLoaderCompletionStatus(error));
  }
  void Close() {
    if (binding_)
      binding_->Close();
  }
  Context context_;
  scoped_refptr<Target> target_;
  network::ResourceRequest request_;
  mojo::Remote<network::mojom::URLLoaderClient> client_;
  mojo::Remote<network::mojom::URLLoader> loader_;
  mojo::Receiver<network::mojom::URLLoaderClient> receiver_{this};
  mojo::SelfOwnedReceiverRef<network::mojom::URLLoader> binding_;
  int32_t id_;
  uint32_t options_;
  net::MutableNetworkTrafficAnnotationTag annotation_;
  std::optional<net::RedirectInfo> redirect_;
  GURL redirect_original_url_;
  network::mojom::URLResponseHeadPtr redirect_head_;
  network::mojom::URLResponseHeadPtr response_head_;
  mojo::ScopedDataPipeConsumerHandle response_body_;
  std::optional<mojo_base::BigBuffer> response_metadata_;
  scoped_refptr<net::HttpResponseHeaders> csp_headers_;
  network::HttpRequestHeadersUpdateParams follow_headers_;
  std::optional<GURL> follow_url_;
  std::unique_ptr<mojo::DataPipeProducer> writer_;
  base::OneShotTimer timer_;
  unsigned redirects_ = 0;
  uint64_t check_ = 0;
  // Matches the latest CSP lookup; earlier URLs' answers are ignored.
  uint64_t csp_ticket_ = 0;
  std::optional<std::string> csp_;
  bool csp_requested_ = false;
  bool paused_for_csp_ = false;
  bool counted_ = false;
  base::WeakPtrFactory<Load> weak_factory_{this};
};

class Factory : public network::SelfDeletingURLLoaderFactory {
 public:
  Factory(mojo::PendingReceiver<network::mojom::URLLoaderFactory> receiver,
          mojo::PendingRemote<network::mojom::URLLoaderFactory> target,
          Context context,
          base::SelfDeletingPassKey key)
      : network::SelfDeletingURLLoaderFactory(std::move(receiver), key),
        target_(base::MakeRefCounted<Target>(std::move(target))),
        context_(std::move(context)) {
    target_->remote.set_disconnect_handler(base::BindOnce(
        &Factory::TargetDisconnected, weak_factory_.GetWeakPtr()));
  }
  void CreateLoaderAndStart(
      mojo::PendingReceiver<network::mojom::URLLoader> receiver,
      int32_t id,
      uint32_t options,
      const network::ResourceRequest& request,
      mojo::PendingRemote<network::mojom::URLLoaderClient> client,
      const net::MutableNetworkTrafficAnnotationTag& annotation) override {
    if (!context_.gate->alive() || !request.url.SchemeIsHTTPOrHTTPS()) {
      target_->remote->CreateLoaderAndStart(std::move(receiver), id, options,
                                            request, std::move(client),
                                            annotation);
      return;
    }
    Context per_request = context_;
    if (ResourceKind(request) == 1) {
      per_request.top_site = request.url;
      per_request.worker_site = request.url;
      if (per_request.source.is_empty())
        per_request.source = request.url;
    }
    // Protection off for this site (or globally): no proxy hop at all.
    if (!context_.gate->EnabledFor(per_request.Top())) {
      target_->remote->CreateLoaderAndStart(std::move(receiver), id, options,
                                            request, std::move(client),
                                            annotation);
      return;
    }
    Load::Create(std::move(per_request), target_, std::move(receiver), id,
                 options, request, std::move(client), annotation);
  }

 private:
  ~Factory() override = default;
  void TargetDisconnected() { DisconnectReceiversAndDestroy(); }
  scoped_refptr<Target> target_;
  Context context_;
  base::WeakPtrFactory<Factory> weak_factory_{this};
};
}  // namespace

void InstallInterceptor(
    content::BrowserContext* context,
    content::RenderFrameHost* frame,
    content::ContentBrowserClient::URLLoaderFactoryType type,
    const url::Origin& initiator,
    const net::IsolationInfo& isolation,
    std::optional<int64_t> navigation_id,
    network::URLLoaderFactoryBuilder& builder,
    network::mojom::URLLoaderFactoryOverridePtr* override) {
  using T = content::ContentBrowserClient::URLLoaderFactoryType;
  if (!base::FeatureList::IsEnabled(kMerlinAdblock) || type == T::kDownload ||
      type == T::kDevTools)
    return;
  Context data;
  auto* service = Service::Get(context);
  if (!service)
    return;
  data.service = service->GetWeakPtr();
  data.gate = service->gate();
  if (type == T::kEarlyHints && navigation_id) {
    data.navigation_id = navigation_id;
    service->RegisterNavigation(*navigation_id);
  }
  data.source = initiator.opaque() ? GURL() : initiator.GetURL();
  data.worker_site =
      data.source;  // Shared/service worker policy: owning origin.
  data.has_frame = frame != nullptr;
  if (data.has_frame) {
    data.frame = frame->GetGlobalId();
    data.top_site =
        isolation.top_frame_origin().has_value() &&
                !isolation.top_frame_origin()->opaque()
            ? isolation.top_frame_origin()->GetURL()
            : frame->GetOutermostMainFrame()->GetLastCommittedOrigin().GetURL();
    // Browser-owned committed origin, including inherited origins.
    if (data.source.is_empty())
      data.source = frame->GetLastCommittedOrigin().GetURL();
  }
  mojo::PendingReceiver<network::mojom::URLLoaderFactory> receiver;
  mojo::PendingRemote<network::mojom::URLLoaderFactory> target;
  if (override) {
    if (!*override) {
      *override = network::mojom::URLLoaderFactoryOverride::New();
      (*override)->overridden_factory_receiver =
          target.InitWithNewPipeAndPassReceiver();
    } else {
      target = std::move((*override)->overriding_factory);
    }
    receiver = (*override)->overriding_factory.InitWithNewPipeAndPassReceiver();
    data.security_wrapped = true;
  } else {
    std::tie(receiver, target) = builder.Append();
  }
  ProxyRunner()->PostTask(
      FROM_HERE,
      base::BindOnce(
          [](mojo::PendingReceiver<network::mojom::URLLoaderFactory> receiver,
             mojo::PendingRemote<network::mojom::URLLoaderFactory> target,
             Context data) {
            base::MakeSelfDeleting<Factory>(std::move(receiver),
                                            std::move(target), std::move(data));
          },
          std::move(receiver), std::move(target), std::move(data)));
}
}  // namespace merlin_adblock
