#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/merlin_adblock/cache.h"
#include "chrome/browser/merlin_adblock/handshake.h"
#include "chrome/browser/merlin_adblock/updater.h"

#include <algorithm>
#include <set>
#include <utility>

#include "base/barrier_closure.h"
#include "base/containers/span.h"
#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/profiles/profile.h"
#include "components/merlin_adblock/common/features.h"
#include "components/merlin_adblock/resources/bundled_data.h"
#include "components/pref_registry/pref_registry_syncable.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "content/public/browser/popup_creation_policy.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "crypto/hash.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "url/origin.h"

namespace merlin_adblock {
namespace {
class CacheInvalidation {
 public:
  static void Start(content::RenderProcessHost* process,
                    base::OnceClosure done) {
    auto* pending = new CacheInvalidation(std::move(done));
    process->BindReceiver(pending->remote_.BindNewPipeAndPassReceiver());
    pending->remote_.set_disconnect_handler(
        base::BindOnce(&CacheInvalidation::Finish, base::Unretained(pending)));
    pending->timer_.Start(
        FROM_HERE, base::Seconds(2),
        base::BindOnce(&CacheInvalidation::Finish, base::Unretained(pending)));
    pending->remote_->InvalidateResourceCache(
        base::BindOnce(&CacheInvalidation::Finish, base::Unretained(pending)));
  }

 private:
  explicit CacheInvalidation(base::OnceClosure done) : done_(std::move(done)) {}
  void Finish() {
    auto done = std::move(done_);
    delete this;
    if (done)
      std::move(done).Run();
  }
  base::OnceClosure done_;
  mojo::Remote<mojom::AdblockProcess> remote_;
  base::OneShotTimer timer_;
};
}  // namespace
void Service::InvalidateResourceCaches(base::OnceClosure done) {
  if (!base::FeatureList::IsEnabled(kMerlinAdblock)) {
    if (done)
      std::move(done).Run();
    return;
  }
  std::vector<content::RenderProcessHost*> processes;
  for (auto it = content::RenderProcessHost::AllHostsIterator(); !it.IsAtEnd();
       it.Advance()) {
    auto* process = it.GetCurrentValue();
    if (process->GetBrowserContext() == profile_ &&
        process->IsInitializedAndNotDead())
      processes.push_back(process);
  }
  if (processes.empty()) {
    if (done)
      std::move(done).Run();
    return;
  }
  if (!done)
    done = base::DoNothing();
  auto barrier = base::BarrierClosure(processes.size(), std::move(done));
  for (auto* process : processes)
    CacheInvalidation::Start(process, barrier);
}
Service::Service(Profile* profile) : profile_(profile) {
  pref_changes_.Init(profile_->GetPrefs());
  for (const char* pref : {kEnabledPref, kExceptionsPref})
    pref_changes_.Add(pref, base::BindRepeating(
                                [](base::WeakPtr<Service> self) {
                                  if (self)
                                    self->InvalidateResourceCaches();
                                },
                                weak_factory_.GetWeakPtr()));
  pref_changes_.Add(
      kListsPref,
      base::BindRepeating(&Service::Initialize, weak_factory_.GetWeakPtr()));
  if (base::FeatureList::IsEnabled(kMerlinAdblock)) {
    content::SetWebSocketConnectionPolicy(
        profile_, base::BindRepeating(&CheckHandshake,
                                      weak_factory_.GetWeakPtr(), uint8_t{11}));
    content::SetPopupCreationPolicy(
        profile_, base::BindRepeating(&CheckHandshake,
                                      weak_factory_.GetWeakPtr(), uint8_t{12}));
    Initialize();
    if (!profile_->IsOffTheRecord())
      updater_ = std::make_unique<Updater>(
          profile_,
          base::BindRepeating(&Service::Install, weak_factory_.GetWeakPtr()));
  } else
    state_ = Readiness::kDisabled;
}
Service::~Service() = default;
Service* Service::Get(content::BrowserContext* context) {
  return ServiceFactory::GetForContext(context);
}
void Service::Initialize() {
  const uint64_t configuration = ++configuration_;
  InvalidateResourceCaches();
  if (!base::FeatureList::IsEnabled(kMerlinAdblock))
    return;
  if (Groups().empty()) {
    state_ = Readiness::kDisabled;
    evaluator_.reset();
    startup_timer_.Stop();
    ReleaseWaiters();
    return;
  }
  if (!evaluator_) {
    state_ = Readiness::kInitializing;
    startup_timer_.Start(FROM_HERE, base::Seconds(2),
                         base::BindOnce(
                             [](base::WeakPtr<Service> self) {
                               if (!self)
                                 return;
                               self->state_ = Readiness::kDegraded;
                               self->ReleaseWaiters();
                             },
                             weak_factory_.GetWeakPtr()));
  }
  auto read_cache = profile_->GetOriginalProfile()
                        ->GetPath()
                        .AppendASCII("MerlinAdblock")
                        .AppendASCII("current");
  auto write_cache = profile_->IsOffTheRecord() ? base::FilePath() : read_cache;
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::USER_BLOCKING},
      base::BindOnce(&LoadBundle, read_cache, write_cache, Groups()),
      base::BindOnce(
          [](base::WeakPtr<Service> self, uint64_t configuration,
             Bundle bundle) {
            if (self && self->configuration_ == configuration &&
                !self->testing_rules_)
              self->Install(std::move(bundle), {});
          },
          weak_factory_.GetWeakPtr(), configuration));
}
void Service::Install(Bundle bundle, base::OnceCallback<void(bool)> done) {
  const uint64_t request = ++install_request_;
  if (!bundle.key.empty()) {
    InstallIdentified(std::move(bundle), std::move(done), request);
    return;
  }
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::TaskPriority::USER_VISIBLE},
      base::BindOnce(&IdentifyBundle, std::move(bundle)),
      base::BindOnce(
          [](base::WeakPtr<Service> self, base::OnceCallback<void(bool)> done,
             uint64_t request, Bundle bundle) {
            if (self)
              self->InstallIdentified(std::move(bundle), std::move(done),
                                      request);
          },
          weak_factory_.GetWeakPtr(), std::move(done), request));
}
void Service::InstallIdentified(Bundle bundle,
                                base::OnceCallback<void(bool)> done,
                                uint64_t request) {
  if (request != install_request_) {
    if (done)
      std::move(done).Run(false);
    return;
  }
  if (!testing_rules_) {
    std::set<std::string> supplied;
    for (const auto& source : bundle.sources)
      supplied.insert(source.group);
    const auto groups = Groups();
    if (supplied != std::set<std::string>(groups.begin(), groups.end())) {
      if (done)
        std::move(done).Run(false);
      return;
    }
  }
  auto candidate = Evaluator::Acquire(bundle.key);
  auto still_requested = bundle.still_requested;
  candidate->Install(
      std::move(bundle),
      base::BindOnce(&Service::Installed, weak_factory_.GetWeakPtr(), candidate,
                     std::move(still_requested), configuration_, request,
                     std::move(done)));
}
void Service::Installed(scoped_refptr<Evaluator> candidate,
                        base::RepeatingCallback<bool()> still_requested,
                        uint64_t configuration,
                        uint64_t request,
                        base::OnceCallback<void(bool)> done,
                        bool ok) {
  if (configuration != configuration_ || request != install_request_ ||
      (still_requested && !still_requested.Run())) {
    if (done)
      std::move(done).Run(false);
    return;
  }
  startup_timer_.Stop();
  if (ok) {
    evaluator_ = std::move(candidate);
    ++generation_;
    state_ = Readiness::kReady;
  } else if (generation_ == 0)
    state_ = Readiness::kDegraded;
  ReleaseWaiters();
  if (ok) {
    InvalidateResourceCaches(done ? base::BindOnce(std::move(done), true)
                                  : base::OnceClosure());
  } else if (done) {
    std::move(done).Run(false);
  }
}
void Service::WhenReady(base::OnceClosure callback) {
  if (state_ == Readiness::kInitializing && waiters_.size() < 2048)
    waiters_.push_back(std::move(callback));
  else
    std::move(callback).Run();
}
void Service::ReleaseWaiters() {
  auto waiters = std::move(waiters_);
  waiters_.clear();
  for (auto& callback : waiters)
    std::move(callback).Run();
}
bool Service::EnabledFor(const GURL& top_level) const {
  return base::FeatureList::IsEnabled(kMerlinAdblock) &&
         profile_->GetPrefs()->GetBoolean(kEnabledPref) &&
         !profile_->GetPrefs()->GetList(kListsPref).empty() &&
         top_level.SchemeIsHTTPOrHTTPS() &&
         !profile_->GetPrefs()
              ->GetDict(kExceptionsPref)
              .contains(top_level.host());
}
void Service::SetEnabled(bool enabled) {
  profile_->GetPrefs()->SetBoolean(kEnabledPref, enabled);
}
std::vector<std::string> Service::Groups() const {
  std::vector<std::string> groups;
  for (const auto& item : profile_->GetPrefs()->GetList(kListsPref))
    if (item.is_string()) {
      const auto& value = item.GetString();
      if (value == "easylist" || value == "easyprivacy" || value == "ublock" ||
          value == "brave")
        groups.push_back(value);
    }
  return groups;
}
void Service::SetGroups(std::vector<std::string> groups) {
  base::ListValue values;
  for (const auto& group : groups)
    if (group == "easylist" || group == "easyprivacy" || group == "ublock" ||
        group == "brave")
      values.Append(group);
  profile_->GetPrefs()->SetList(kListsPref, std::move(values));
}
void Service::Refresh() {
  if (updater_)
    updater_->Refresh();
}
std::string Service::UpdateStatus() const {
  return updater_                     ? updater_->status()
         : profile_->IsOffTheRecord() ? "Private windows use existing lists; "
                                        "updates run only in a normal profile"
                                      : "Native ad blocking is disabled";
}
bool Service::ToggleSite(const GURL& url) {
  if (!url.SchemeIsHTTPOrHTTPS())
    return false;
  ScopedDictPrefUpdate update(profile_->GetPrefs(), kExceptionsPref);
  if (update->contains(url.host()))
    update->Remove(url.host());
  else
    update->Set(url.host(), true);
  return EnabledFor(url);
}
std::vector<std::string> Service::Exceptions() const {
  std::vector<std::string> result;
  for (const auto [host, ignored] :
       profile_->GetPrefs()->GetDict(kExceptionsPref))
    result.push_back(host);
  return result;
}
bool Service::SetException(std::string host, bool excepted) {
  const GURL url("https://" + host + "/");
  if (!url.is_valid() || !url.has_host() || url.has_username() ||
      url.has_password() || url.has_port() || url.has_query() ||
      url.has_ref() || url.path() != "/")
    return false;
  ScopedDictPrefUpdate update(profile_->GetPrefs(), kExceptionsPref);
  if (excepted)
    update->Set(url.host(), true);
  else
    update->Remove(url.host());
  return true;
}
Readiness Service::readiness() const {
  return !base::FeatureList::IsEnabled(kMerlinAdblock) ||
                 !profile_->GetPrefs()->GetBoolean(kEnabledPref) ||
                 Groups().empty()
             ? Readiness::kDisabled
             : state_;
}
void Service::Check(const GURL& url,
                    const GURL& source,
                    const GURL& top_level,
                    std::string method,
                    uint8_t kind,
                    base::OnceCallback<void(Decision)> done) {
  if (!EnabledFor(top_level)) {
    std::move(done).Run({});
    return;
  }
  WhenReady(base::BindOnce(
      [](base::WeakPtr<Service> self, GURL url, GURL source, GURL top,
         std::string method, uint8_t kind,
         base::OnceCallback<void(Decision)> done) {
        if (!self || !self->EnabledFor(top) ||
            self->state_ != Readiness::kReady) {
          std::move(done).Run({});
          return;
        }
        self->evaluator_->Check(url, source, std::move(method), kind,
                                std::move(done));
      },
      weak_factory_.GetWeakPtr(), url, source, top_level, std::move(method),
      kind, std::move(done)));
}
void Service::Configure(
    const GURL& url,
    const GURL& top,
    base::OnceCallback<void(mojom::DocumentConfigPtr)> done) {
  if (!EnabledFor(top)) {
    auto config = mojom::DocumentConfig::New();
    config->url = url;
    std::move(done).Run(std::move(config));
    return;
  }
  WhenReady(base::BindOnce(
      [](base::WeakPtr<Service> self, GURL url, GURL top,
         base::OnceCallback<void(mojom::DocumentConfigPtr)> done) {
        if (!self || !self->EnabledFor(top) ||
            self->state_ != Readiness::kReady) {
          auto config = mojom::DocumentConfig::New();
          config->url = url;
          std::move(done).Run(std::move(config));
          return;
        }
        self->evaluator_->Cosmetics(
            url, base::BindOnce(
                     [](base::WeakPtr<Service> service, uint64_t generation,
                        GURL top,
                        base::OnceCallback<void(mojom::DocumentConfigPtr)> done,
                        mojom::DocumentConfigPtr config) {
                       const std::string partition =
                           base::NumberToString(generation) + ":" +
                           url::Origin::Create(config->url).Serialize() + ":" +
                           url::Origin::Create(top).Serialize();
                       config->cache_partition = base::HexEncode(
                           crypto::hash::Sha256(base::as_byte_span(partition)));
                       config->generation = generation;
                       if (!service || service->generation() != generation ||
                           !service->EnabledFor(top))
                         config->enabled = false;
                       std::move(done).Run(std::move(config));
                     },
                     self, self->generation(), top, std::move(done)));
      },
      weak_factory_.GetWeakPtr(), url, top, std::move(done)));
}
void Service::Csp(const GURL& url,
                  const GURL& source,
                  const GURL& top,
                  bool main_document,
                  base::OnceCallback<void(std::string)> done) {
  if (!EnabledFor(top) || state_ != Readiness::kReady) {
    std::move(done).Run({});
    return;
  }
  evaluator_->Csp(url, source, main_document, std::move(done));
}
void Service::Generic(const GURL& top,
                      std::vector<std::string> classes,
                      std::vector<std::string> ids,
                      std::vector<std::string> exceptions,
                      base::OnceCallback<void(std::vector<std::string>)> done) {
  if (!EnabledFor(top) || state_ != Readiness::kReady) {
    std::move(done).Run({});
    return;
  }
  evaluator_->Generic(std::move(classes), std::move(ids), std::move(exceptions),
                      std::move(done));
}
void Service::SetRulesForTesting(std::string rules,
                                 std::string resources,
                                 base::OnceCallback<void(bool)> done) {
  testing_rules_ = true;
  // A late initial disk read must not replace a deliberately installed fixture.
  ++configuration_;
  if (updater_)
    updater_->Stop();
  Bundle bundle;
  bundle.sources.push_back({"fixture", std::move(rules), 0});
  bundle.resources = std::move(resources);
  Install(std::move(bundle), std::move(done));
}
void Service::CountBlocked(content::GlobalRenderFrameHostId id,
                           unsigned delta) {
  auto* frame = content::RenderFrameHost::FromID(id);
  if (!frame)
    return;
  auto* top = frame->GetOutermostMainFrame();
  // Bounded even with discarded/background tabs; no URL logs or persisted
  // counts.
  std::erase_if(counts_, [](const auto& entry) {
    return !entry.second.document.AsRenderFrameHostIfValid();
  });
  if (counts_.size() >= 1024 && !counts_.contains(top->GetGlobalId()))
    counts_.erase(counts_.begin());
  auto& count = counts_[top->GetGlobalId()];
  if (!count.document.AsRenderFrameHostIfValid())
    count = {top->GetWeakDocumentPtr(), 0};
  count.blocked += std::min(delta, 1000000u - count.blocked);
}
void Service::RegisterNavigation(int64_t navigation) {
  std::erase_if(navigation_counts_, [](const auto& entry) {
    return entry.second.finished &&
           !entry.second.document.AsRenderFrameHostIfValid();
  });
  if (navigation_counts_.size() >= 1024 &&
      !navigation_counts_.contains(navigation))
    navigation_counts_.erase(navigation_counts_.begin());
  navigation_counts_.try_emplace(navigation);
}
void Service::CountNavigationBlocked(int64_t navigation) {
  auto it = navigation_counts_.find(navigation);
  if (it == navigation_counts_.end())
    return;
  if (auto* frame = it->second.document.AsRenderFrameHostIfValid()) {
    CountBlocked(frame->GetGlobalId());
  } else if (!it->second.finished && it->second.pending < 1000000) {
    ++it->second.pending;
  }
}
void Service::NavigationFinished(int64_t navigation,
                                 content::RenderFrameHost* frame) {
  auto it = navigation_counts_.find(navigation);
  if (it == navigation_counts_.end())
    return;
  if (!frame) {
    navigation_counts_.erase(it);
    return;
  }
  it->second.document = frame->GetWeakDocumentPtr();
  it->second.finished = true;
  CountBlocked(frame->GetGlobalId(), std::exchange(it->second.pending, 0));
}
unsigned Service::Blocked(content::RenderFrameHost* frame) const {
  if (!frame)
    return 0;
  frame = frame->GetOutermostMainFrame();
  auto it = counts_.find(frame->GetGlobalId());
  return it != counts_.end() && it->second.document.AsRenderFrameHostIfValid()
             ? it->second.blocked
             : 0;
}
std::string Service::Status() const {
  switch (readiness()) {
    case Readiness::kDisabled:
      return "Ad blocking disabled";
    case Readiness::kInitializing:
      return "Ad blocking initializing";
    case Readiness::kDegraded:
      return "Ad blocking degraded: no usable rules; browsing allowed";
    case Readiness::kReady:
      return "Ad blocking ready, generation " +
             base::NumberToString(generation_);
  }
}
void Service::Shutdown() {
  content::SetPopupCreationPolicy(profile_, {});
  content::SetWebSocketConnectionPolicy(profile_, {});
  if (updater_)
    updater_->Stop();
  weak_factory_.InvalidateWeakPtrs();
  startup_timer_.Stop();
  state_ = Readiness::kDisabled;
  ReleaseWaiters();
  counts_.clear();
  navigation_counts_.clear();
}
ServiceFactory* ServiceFactory::GetInstance() {
  static base::NoDestructor<ServiceFactory> factory;
  return factory.get();
}
Service* ServiceFactory::GetForContext(content::BrowserContext* context) {
  return static_cast<Service*>(
      GetInstance()->GetServiceForBrowserContext(context, true));
}
ServiceFactory::ServiceFactory()
    : ProfileKeyedServiceFactory(
          "MerlinAdblock",
          ProfileSelections::Builder()
              .WithRegular(ProfileSelection::kOwnInstance)
              .WithGuest(ProfileSelection::kOwnInstance)
              .Build()) {}
ServiceFactory::~ServiceFactory() = default;
bool ServiceFactory::ServiceIsCreatedWithBrowserContext() const {
  return base::FeatureList::IsEnabled(kMerlinAdblock);
}
std::unique_ptr<KeyedService>
ServiceFactory::BuildServiceInstanceForBrowserContext(
    content::BrowserContext* context) const {
  return std::make_unique<Service>(Profile::FromBrowserContext(context));
}
void ServiceFactory::RegisterProfilePrefs(
    user_prefs::PrefRegistrySyncable* registry) {
  registry->RegisterBooleanPref(kEnabledPref, true);
  registry->RegisterBooleanPref(kUpdatesPref, true);
  registry->RegisterDoublePref(kLastUpdatePref, 0);
  registry->RegisterDictionaryPref(kExceptionsPref);
  base::ListValue groups;
  for (const char* group : {"easylist", "easyprivacy", "ublock", "brave"})
    groups.Append(group);
  registry->RegisterListPref(kListsPref, std::move(groups));
}
}  // namespace merlin_adblock
