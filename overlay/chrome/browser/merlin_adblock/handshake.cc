#include "chrome/browser/merlin_adblock/handshake.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/ref_counted.h"
#include "base/timer/timer.h"
#include "chrome/browser/merlin_adblock/context.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "net/base/net_errors.h"
#include "url/origin.h"

namespace merlin_adblock {
namespace {
class PendingHandshake : public base::RefCounted<PendingHandshake> {
 public:
  PendingHandshake(base::WeakPtr<Service> service,
                   GURL url,
                   content::WeakDocumentPtr document,
                   content::WebSocketPolicyResult done)
      : service_(service),
        url_(std::move(url)),
        document_(std::move(document)),
        done_(std::move(done)) {}
  void Start(GURL source, GURL top, uint8_t type) {
    timer_.Start(FROM_HERE, base::Seconds(2),
                 base::BindOnce(&PendingHandshake::Finish,
                                base::WrapRefCounted(this), Decision{}));
    service_->Check(
        url_, source, top, type == 0 ? "CONNECT" : "GET", type,
        base::BindOnce(&PendingHandshake::Finish, base::WrapRefCounted(this)));
  }

 private:
  friend class base::RefCounted<PendingHandshake>;
  ~PendingHandshake() = default;
  void Finish(Decision decision) {
    if (!done_)
      return;
    timer_.Stop();
    if (!service_) {
      std::move(done_).Run(net::ERR_ABORTED, url_);
      return;
    }
    if (decision.kind == DecisionKind::kBlock ||
        decision.kind == DecisionKind::kReplace) {
      if (auto* frame = document_.AsRenderFrameHostIfValid())
        service_->CountBlocked(frame->GetGlobalId());
      std::move(done_).Run(net::ERR_BLOCKED_BY_CLIENT, url_);
    } else {
      // A handshake has no safe synthetic HTTP response. Replacements are
      // blocked; URL modifiers must retain the original endpoint's origin.
      const auto& result =
          decision.kind == DecisionKind::kRewrite &&
                  url::Origin::Create(url_).IsSameOriginWith(
                      url::Origin::Create(decision.rewritten_url))
              ? decision.rewritten_url
              : url_;
      std::move(done_).Run(net::OK, result);
    }
  }
  base::WeakPtr<Service> service_;
  GURL url_;
  content::WeakDocumentPtr document_;
  content::WebSocketPolicyResult done_;
  base::OneShotTimer timer_;
};
}  // namespace
void CheckHandshake(base::WeakPtr<Service> service,
                    uint8_t type,
                    content::GlobalRenderFrameHostId id,
                    const url::Origin& source,
                    const GURL& url,
                    content::WebSocketPolicyResult done) {
  if (!service) {
    std::move(done).Run(net::ERR_ABORTED, url);
    return;
  }
  auto* frame = content::RenderFrameHost::FromID(id);
  // Shared/service workers use their browser-owned origin: they have no single
  // top-level tab. Dedicated workers retain the connector's creator document.
  const GURL top = frame ? TopDocumentUrl(frame) : source.GetURL();
  if (!service->EnabledFor(top)) {
    std::move(done).Run(net::OK, url);
    return;
  }
  auto pending = base::MakeRefCounted<PendingHandshake>(
      service, url,
      frame ? frame->GetWeakDocumentPtr() : content::WeakDocumentPtr(),
      std::move(done));
  pending->Start(source.GetURL(), top, type);
}
void CheckWebTransport(int process_id,
                       int frame_id,
                       const url::Origin& source,
                       const GURL& url,
                       content::WebSocketPolicyResult done) {
  if (!base::FeatureList::IsEnabled(kMerlinAdblock)) {
    std::move(done).Run(net::OK, url);
    return;
  }
  auto* process = content::RenderProcessHost::FromID(process_id);
  if (!process) {
    std::move(done).Run(net::ERR_ABORTED, url);
    return;
  }
  // The pinned engine has no WebTransport type. Map its CONNECT handshake to
  // Other. Chromium's hook cannot rewrite the URL, so only allow/block applies.
  auto* service = Service::Get(process->GetBrowserContext());
  if (!service) {
    std::move(done).Run(net::OK, url);
    return;
  }
  CheckHandshake(service->GetWeakPtr(), 0,
                 content::GlobalRenderFrameHostId(process_id, frame_id), source,
                 url, std::move(done));
}
}  // namespace merlin_adblock
