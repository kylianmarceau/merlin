#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_SERVICE_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_SERVICE_H_

#include <deque>
#include <map>
#include <string>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "chrome/browser/merlin_adblock/evaluator.h"
#include "chrome/browser/profiles/profile_keyed_service_factory.h"
#include "components/keyed_service/core/keyed_service.h"
#include "components/prefs/pref_change_registrar.h"
#include "content/public/browser/global_routing_id.h"
#include "content/public/browser/weak_document_ptr.h"

class Profile;
namespace user_prefs {
class PrefRegistrySyncable;
}
namespace base {
template <typename T>
class NoDestructor;
}
namespace content {
class RenderFrameHost;
}

namespace merlin_adblock {
inline constexpr char kEnabledPref[] = "merlin.adblock.enabled";
inline constexpr char kExceptionsPref[] = "merlin.adblock.exceptions";
inline constexpr char kUpdatesPref[] = "merlin.adblock.updates";
inline constexpr char kListsPref[] = "merlin.adblock.lists";
enum class Readiness { kDisabled, kInitializing, kReady, kDegraded };
class Updater;

class Service : public KeyedService {
 public:
  explicit Service(Profile* profile);
  ~Service() override;
  static Service* Get(content::BrowserContext* context);
  base::WeakPtr<Service> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
  bool EnabledFor(const GURL& top_level) const;
  void SetEnabled(bool enabled);
  std::vector<std::string> Groups() const;
  void SetGroups(std::vector<std::string> groups);
  void Refresh();
  std::string UpdateStatus() const;
  Updater* updater_for_testing() { return updater_.get(); }
  Evaluator* evaluator_for_testing() { return evaluator_.get(); }
  bool ToggleSite(const GURL& top_level);
  std::vector<std::string> Exceptions() const;
  bool SetException(std::string host, bool excepted);
  Readiness readiness() const;
  void Check(const GURL& url,
             const GURL& source,
             const GURL& top_level,
             std::string method,
             uint8_t kind,
             base::OnceCallback<void(Decision)> done);
  void Configure(const GURL& url,
                 const GURL& top_level,
                 base::OnceCallback<void(mojom::DocumentConfigPtr)> done);
  void Csp(const GURL& url,
           const GURL& source,
           const GURL& top_level,
           bool main_document,
           base::OnceCallback<void(std::string)> done);
  void Generic(const GURL& top_level,
               std::vector<std::string> classes,
               std::vector<std::string> ids,
               std::vector<std::string> exceptions,
               base::OnceCallback<void(std::vector<std::string>)> done);
  void SetRulesForTesting(std::string rules,
                          std::string resources,
                          base::OnceCallback<void(bool)> done);
  uint64_t generation() const { return generation_; }
  void CountBlocked(content::GlobalRenderFrameHostId frame, unsigned delta = 1);
  void RegisterNavigation(int64_t navigation);
  void CountNavigationBlocked(int64_t navigation);
  void NavigationFinished(int64_t navigation, content::RenderFrameHost* frame);
  unsigned Blocked(content::RenderFrameHost* frame) const;
  std::string Status() const;
  void Shutdown() override;

 private:
  void Initialize();
  void InvalidateResourceCaches(base::OnceClosure done = {});
  void Install(Bundle bundle, base::OnceCallback<void(bool)> done);
  void InstallIdentified(Bundle bundle,
                         base::OnceCallback<void(bool)> done,
                         uint64_t request);
  void Installed(scoped_refptr<Evaluator> candidate,
                 base::RepeatingCallback<bool()> still_requested,
                 uint64_t configuration,
                 uint64_t request,
                 base::OnceCallback<void(bool)> done,
                 bool ok);
  void WhenReady(base::OnceClosure callback);
  void ReleaseWaiters();
  raw_ptr<Profile> profile_;
  scoped_refptr<Evaluator> evaluator_;
  Readiness state_ = Readiness::kInitializing;
  uint64_t generation_ = 0;
  uint64_t configuration_ = 0;
  uint64_t install_request_ = 0;
  std::unique_ptr<Updater> updater_;
  std::deque<base::OnceClosure> waiters_;
  base::OneShotTimer startup_timer_;
  // Only current documents: document identity is checked before counting.
  struct Count {
    content::WeakDocumentPtr document;
    unsigned blocked = 0;
  };
  std::map<content::GlobalRenderFrameHostId, Count> counts_;
  struct NavigationCount {
    content::WeakDocumentPtr document;
    unsigned pending = 0;
    bool finished = false;
  };
  std::map<int64_t, NavigationCount> navigation_counts_;
  bool testing_rules_ = false;
  PrefChangeRegistrar pref_changes_;
  base::WeakPtrFactory<Service> weak_factory_{this};
};

class ServiceFactory : public ProfileKeyedServiceFactory {
 public:
  static ServiceFactory* GetInstance();
  static Service* GetForContext(content::BrowserContext* context);

 private:
  friend class base::NoDestructor<ServiceFactory>;
  ServiceFactory();
  ~ServiceFactory() override;
  bool ServiceIsCreatedWithBrowserContext() const override;
  std::unique_ptr<KeyedService> BuildServiceInstanceForBrowserContext(
      content::BrowserContext* context) const override;
  void RegisterProfilePrefs(
      user_prefs::PrefRegistrySyncable* registry) override;
};
}  // namespace merlin_adblock
#endif
