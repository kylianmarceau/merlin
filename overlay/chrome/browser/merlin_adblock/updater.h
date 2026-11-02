#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_UPDATER_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_UPDATER_H_

#include <memory>
#include <optional>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/merlin_adblock/evaluator.h"
#include "components/prefs/pref_change_registrar.h"

class Profile;
namespace network {
class SimpleURLLoader;
}
namespace merlin_adblock {
inline constexpr char kLastUpdatePref[] = "merlin.adblock.last_update";

class Updater {
 public:
  using InstallCallback =
      base::RepeatingCallback<void(Bundle, base::OnceCallback<void(bool)>)>;
  Updater(Profile* profile, InstallCallback install);
  ~Updater();
  void Refresh();
  void Stop();
  bool running() const { return running_; }
  const std::string& status() const { return status_; }
  void SetBundleForTesting(Bundle bundle);

 private:
  void PreferencesChanged();
  void Schedule(base::TimeDelta delay);
  void Begin(bool manual);
  void Loaded(Bundle bundle);
  void Next();
  void Downloaded(std::optional<std::string> body);
  void Validated(std::optional<Source> source);
  void Installed(bool ok);
  void Finish(bool ok, std::string status);
  raw_ptr<Profile> profile_;
  InstallCallback install_;
  std::optional<Bundle> candidate_;
  std::optional<Bundle> test_bundle_;
  std::unique_ptr<network::SimpleURLLoader> loader_;
  size_t index_ = 0;
  unsigned redirects_ = 0;
  unsigned failures_ = 0;
  bool running_ = false;
  bool manual_ = false;
  bool changed_ = false;
  bool downloaded_ = false;
  base::Time last_attempt_;
  std::string status_ = "Bundled lists available offline";
  base::OneShotTimer schedule_;
  base::OneShotTimer deadline_;
  PrefChangeRegistrar pref_changes_;
  base::WeakPtrFactory<Updater> weak_factory_{this};
};
}  // namespace merlin_adblock
#endif
