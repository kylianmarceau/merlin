#include "chrome/browser/merlin_adblock/popups.h"

#include <optional>
#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/task/single_thread_task_runner.h"
#include "base/timer/timer.h"
#include "chrome/browser/merlin_adblock/context.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"

namespace merlin_adblock {
namespace {
struct Opening {
  content::WeakDocumentPtr opener;
  content::WeakDocumentPtr top_document;
  GURL source;
  GURL top;
  base::TimeTicks created;
};
struct Opened {
  content::WeakDocumentPtr document;
  base::WeakPtr<content::WebContents> child;
  GURL initial_target;
  base::TimeTicks created;
};
class WindowState : public content::WebContentsObserver,
                    public content::WebContentsUserData<WindowState> {
 public:
  void DidOpenRequestedURL(content::WebContents* child,
                           content::RenderFrameHost* source,
                           const GURL& url,
                           const content::Referrer&,
                           WindowOpenDisposition,
                           ui::PageTransition,
                           bool,
                           bool renderer_initiated) override {
    if (!renderer_initiated || !source || !child || child == web_contents())
      return;
    auto* top = source->GetOutermostMainFrame();
    if (!Service::Get(source->GetBrowserContext())
             ->EnabledFor(TopDocumentUrl(source)))
      return;
    const auto now = base::TimeTicks::Now();
    WindowState::CreateForWebContents(child);
    WindowState::FromWebContents(child)->opening = Opening{
        source->GetWeakDocumentPtr(), top->GetWeakDocumentPtr(),
        source->GetLastCommittedOrigin().GetURL(), TopDocumentUrl(source), now};
    opened = Opened{top->GetWeakDocumentPtr(), child->GetWeakPtr(), url, now};
  }
  void DidFinishNavigation(content::NavigationHandle* nav) override {
    if (!nav->IsSameDocument()) {
      if (auto* service = Service::Get(web_contents()->GetBrowserContext()))
        service->NavigationFinished(
            nav->GetNavigationId(),
            nav->HasCommitted() ? nav->GetRenderFrameHost() : nullptr);
    }
    if (!nav->IsInPrimaryMainFrame() || !nav->HasCommitted() ||
        nav->IsSameDocument())
      return;
    if (nav->GetURL().SchemeIsHTTPOrHTTPS())
      opening.reset();
    if (opened && !opened->document.AsRenderFrameHostIfValid())
      opened.reset();
  }
  std::optional<Opening> opening;
  std::optional<Opened> opened;

 private:
  explicit WindowState(content::WebContents* contents)
      : WebContentsObserver(contents), WebContentsUserData(*contents) {}
  friend class content::WebContentsUserData<WindowState>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};
WEB_CONTENTS_USER_DATA_KEY_IMPL(WindowState);

class WindowNavigation : public content::NavigationThrottle {
 public:
  explicit WindowNavigation(content::NavigationThrottleRegistry& registry)
      : NavigationThrottle(registry) {}
  ThrottleCheckResult WillStartRequest() override { return Check(); }
  ThrottleCheckResult WillRedirectRequest() override { return Check(); }
  const char* GetNameForLogging() override {
    return "MerlinAdblockWindowNavigation";
  }

 private:
  ThrottleCheckResult Check() {
    auto* nav = navigation_handle();
    if (!nav->IsInPrimaryMainFrame() || nav->IsSameDocument() ||
        !nav->GetURL().SchemeIsHTTPOrHTTPS())
      return PROCEED;
    auto* contents = nav->GetWebContents();
    auto* state = WindowState::FromWebContents(contents);
    if (!state)
      return PROCEED;
    auto* service = Service::Get(contents->GetBrowserContext());
    if (!service)
      return PROCEED;
    const auto now = base::TimeTicks::Now();
    GURL source, top;
    uint8_t type = 0;
    if (state->opening && now - state->opening->created < base::Seconds(30) &&
        state->opening->opener.AsRenderFrameHostIfValid() &&
        state->opening->top_document.AsRenderFrameHostIfValid()) {
      source = state->opening->source;
      top = state->opening->top;
      type = 12;
      count_document_ = state->opening->top_document;
      close_empty_child_ =
          contents->GetPrimaryMainFrame()->GetWeakDocumentPtr();
    } else if (state->opened &&
               now - state->opened->created < base::Seconds(10) &&
               state->opened->document.AsRenderFrameHostIfValid() &&
               state->opened->child && nav->IsRendererInitiated() &&
               !nav->HasUserGesture()) {
      source = state->opened->child->GetLastCommittedURL();
      if (!source.SchemeIsHTTPOrHTTPS())
        source = state->opened->initial_target;
      if (!source.SchemeIsHTTPOrHTTPS())
        return PROCEED;
      top = TopDocumentUrl(contents->GetPrimaryMainFrame());
      type = 13;
      count_document_ = state->opened->document;
    }
    if (!type || !service->EnabledFor(top))
      return PROCEED;
    service_ = service->GetWeakPtr();
    const uint64_t ticket = ++ticket_;
    timer_.Start(
        FROM_HERE, base::Seconds(2),
        base::BindOnce(&WindowNavigation::Checked, weak_factory_.GetWeakPtr(),
                       ticket, Decision{}));
    // Always post: a disabled policy or startup fallback may answer in-band,
    // before NavigationThrottle has entered the deferred state.
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<WindowNavigation> self, GURL url, GURL source,
               GURL top, std::string method, uint8_t type, uint64_t ticket) {
              if (!self)
                return;
              if (!self->service_) {
                self->Checked(ticket, {});
                return;
              }
              self->service_->Check(
                  url, source, top, std::move(method), type,
                  base::BindOnce(&WindowNavigation::Checked, self, ticket));
            },
            weak_factory_.GetWeakPtr(), nav->GetURL(), source, top,
            nav->GetRequestMethod(), type, ticket));
    return DEFER;
  }
  void Checked(uint64_t ticket, Decision decision) {
    if (ticket != ticket_)
      return;
    ++ticket_;
    timer_.Stop();
    if (decision.kind != DecisionKind::kBlock) {
      Resume();
      return;
    }
    if (service_)
      if (auto* frame = count_document_.AsRenderFrameHostIfValid())
        service_->CountBlocked(frame->GetGlobalId());
    auto contents = navigation_handle()->GetWebContents()->GetWeakPtr();
    const auto document = close_empty_child_;
    CancelDeferredNavigation(CANCEL_AND_IGNORE);
    // A late about:blank popup is closed only while its original empty
    // document remains current and no replacement navigation has begun.
    if (document.AsRenderFrameHostIfValid()) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE,
          base::BindOnce(
              [](base::WeakPtr<content::WebContents> contents,
                 content::WeakDocumentPtr document) {
                if (contents && document.AsRenderFrameHostIfValid() &&
                    !contents->IsLoading() &&
                    !contents->GetLastCommittedURL().SchemeIsHTTPOrHTTPS())
                  contents->ClosePage();
              },
              contents, document));
    }
  }
  base::WeakPtr<Service> service_;
  content::WeakDocumentPtr count_document_;
  content::WeakDocumentPtr close_empty_child_;
  uint64_t ticket_ = 0;
  base::OneShotTimer timer_;
  base::WeakPtrFactory<WindowNavigation> weak_factory_{this};
};
}  // namespace
void ObserveWindows(content::WebContents* contents) {
  if (base::FeatureList::IsEnabled(kMerlinAdblock) &&
      Service::Get(contents->GetBrowserContext()))
    WindowState::CreateForWebContents(contents);
}
void AddWindowNavigationThrottle(
    content::NavigationThrottleRegistry& registry) {
  if (base::FeatureList::IsEnabled(kMerlinAdblock))
    registry.AddThrottle(std::make_unique<WindowNavigation>(registry));
}
}  // namespace merlin_adblock
