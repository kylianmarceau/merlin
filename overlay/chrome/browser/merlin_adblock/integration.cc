#include "chrome/browser/merlin_adblock/integration.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ref.h"
#include "base/timer/timer.h"
#include "base/unguessable_token.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/merlin_adblock/context.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/profiles/profile.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "services/network/public/cpp/web_sandbox_flags.h"
#include "services/network/public/mojom/web_sandbox_flags.mojom.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"

namespace merlin_adblock {
namespace {
class Preparation {
 public:
  explicit Preparation(content::NavigationHandle& handle)
      : navigation_(handle) {}
  bool Start(base::OnceClosure resume) {
    auto& nav = Nav();
    if (nav.IsSameDocument() || nav.IsServedFromBackForwardCache())
      return false;
    effective_url_ = nav.GetURL();
    if (!effective_url_.SchemeIsHTTPOrHTTPS()) {
      if (!effective_url_.IsAboutBlank() && !effective_url_.IsAboutSrcdoc())
        return false;
      auto* source = nav.GetParentFrameOrOuterDocument();
      if (!source)
        source = nav.GetWebContents()->GetOpener();
      if (!source)
        return false;
      effective_url_ = EffectiveDocumentUrl(source);
      if (!effective_url_.SchemeIsHTTPOrHTTPS())
        effective_url_ = source->GetLastCommittedOrigin().GetURL();
      if (!effective_url_.SchemeIsHTTPOrHTTPS())
        return false;
    }
    auto* service = Service::Get(nav.GetRenderFrameHost()->GetBrowserContext());
    if (!service)
      return false;
    resume_ = std::move(resume);
    timer_.Start(
        FROM_HERE, base::Seconds(3),
        base::BindOnce(&Preparation::Finish, weak_factory_.GetWeakPtr()));
    auto* frame = nav.GetRenderFrameHost();
    const GURL top =
        nav.IsInOutermostMainFrame() ? effective_url_ : TopDocumentUrl(frame);
    service->Configure(
        effective_url_, top,
        base::BindOnce(&Preparation::Configured, weak_factory_.GetWeakPtr()));
    return true;
  }

 private:
  content::NavigationHandle& Nav() { return *navigation_; }
  void Configured(mojom::DocumentConfigPtr config) {
    if (!resume_)
      return;
    auto* frame = Nav().GetRenderFrameHost();
    config->url = Nav().GetURL();
    config->token = base::UnguessableToken::Create().ToString();
    const bool site_scripts_blocked =
        HostContentSettingsMapFactory::GetForProfile(
            Profile::FromBrowserContext(frame->GetBrowserContext()))
            ->GetContentSetting(effective_url_, effective_url_,
                                ContentSettingsType::JAVASCRIPT) ==
        CONTENT_SETTING_BLOCK;
    if (site_scripts_blocked || (Nav().SandboxFlagsToCommit() &
                                 network::mojom::WebSandboxFlags::kScripts) !=
                                    network::mojom::WebSandboxFlags::kNone) {
      config->main_script.clear();
      config->isolated_script.clear();
      config->scripts_allowed = false;
    }
    frame->GetRemoteAssociatedInterfaces()->GetInterface(&agent_);
    agent_.set_disconnect_handler(
        base::BindOnce(&Preparation::Finish, weak_factory_.GetWeakPtr()));
    agent_->Prepare(
        std::move(config),
        base::BindOnce(&Preparation::Finish, weak_factory_.GetWeakPtr()));
  }
  void Finish() {
    timer_.Stop();
    if (resume_)
      std::move(resume_).Run();
  }
  raw_ref<content::NavigationHandle> navigation_;
  mojo::AssociatedRemote<mojom::AdblockAgent> agent_;
  GURL effective_url_;
  base::OnceClosure resume_;
  base::OneShotTimer timer_;
  base::WeakPtrFactory<Preparation> weak_factory_{this};
};
class DocumentCondition : public content::CommitDeferringCondition {
 public:
  explicit DocumentCondition(content::NavigationHandle& nav)
      : CommitDeferringCondition(nav), preparation_(nav) {}
  Result WillCommitNavigation(base::OnceClosure resume) override {
    return preparation_.Start(std::move(resume)) ? Result::kDefer
                                                 : Result::kProceed;
  }
  const char* TraceEventName() const override {
    return "MerlinAdblockDocument";
  }

 private:
  Preparation preparation_;
};
class InheritedDocumentThrottle : public content::NavigationThrottle {
 public:
  explicit InheritedDocumentThrottle(
      content::NavigationThrottleRegistry& registry)
      : NavigationThrottle(registry),
        preparation_(registry.GetNavigationHandle()) {}
  ThrottleCheckResult WillCommitWithoutUrlLoader() override {
    return preparation_.Start(
               base::BindOnce(&InheritedDocumentThrottle::Finished,
                              weak_factory_.GetWeakPtr()))
               ? DEFER
               : PROCEED;
  }
  const char* GetNameForLogging() override {
    return "MerlinAdblockInheritedDocument";
  }

 private:
  void Finished() { Resume(); }
  Preparation preparation_;
  base::WeakPtrFactory<InheritedDocumentThrottle> weak_factory_{this};
};
}  // namespace
std::unique_ptr<content::CommitDeferringCondition> PrepareDocument(
    content::NavigationHandle& nav,
    content::CommitDeferringCondition::NavigationType type) {
  if (type == content::CommitDeferringCondition::NavigationType::
                  kPrerenderedPageActivation)
    return nullptr;
  if (!base::FeatureList::IsEnabled(kMerlinAdblock))
    return nullptr;
  return std::make_unique<DocumentCondition>(nav);
}
void AddInheritedDocumentThrottle(
    content::NavigationThrottleRegistry& registry) {
  const auto& url = registry.GetNavigationHandle().GetURL();
  if (base::FeatureList::IsEnabled(kMerlinAdblock) &&
      (url.IsAboutBlank() || url.IsAboutSrcdoc()))
    registry.AddThrottle(std::make_unique<InheritedDocumentThrottle>(registry));
}
}  // namespace merlin_adblock
