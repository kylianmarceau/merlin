#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_EVALUATOR_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_EVALUATOR_H_

#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/memory/ref_counted.h"
#include "base/memory/weak_ptr.h"
#include "base/sequence_checker.h"
#include "base/threading/sequence_bound.h"
#include "components/merlin_adblock/common/adblock.mojom.h"
#include "url/gurl.h"

namespace merlin_adblock {
enum class DecisionKind { kAllow, kBlock, kReplace, kRewrite };
struct Decision {
  DecisionKind kind = DecisionKind::kAllow;
  std::string mime;
  std::string body;
  GURL rewritten_url;
};
struct Source {
  std::string id;
  std::string text;
  uint8_t permissions = 0;
  std::string group;
  GURL update_url;
  unsigned expires_hours = 6;
  unsigned minimum_rules = 1;
  std::string revision;
  std::string digest;
  double retrieved_at = 0;
};
struct Bundle {
  std::vector<Source> sources;
  std::vector<Source> bundled_sources;
  std::string resources;
  std::string cache;
  base::FilePath cache_path;
  std::string key;
  bool from_cache = false;
  base::RepeatingCallback<bool()> still_requested;
};

class EngineState;
// UI-side shared handle. Every live Rust engine is confined to EngineState's
// dedicated sequence, including construction, swap and destruction.
class Evaluator : public base::RefCounted<Evaluator> {
 public:
  Evaluator();
  static scoped_refptr<Evaluator> Acquire(const std::string& key);
  void Install(Bundle bundle, base::OnceCallback<void(bool)> done);
  void Check(const GURL& url,
             const GURL& source,
             std::string method,
             uint8_t kind,
             base::OnceCallback<void(Decision)> done);
  void Cosmetics(const GURL& url,
                 base::OnceCallback<void(mojom::DocumentConfigPtr)> done);
  void Csp(const GURL& url,
           const GURL& source,
           bool main_document,
           base::OnceCallback<void(std::string)> done);
  void Generic(std::vector<std::string> classes,
               std::vector<std::string> ids,
               std::vector<std::string> exceptions,
               base::OnceCallback<void(std::vector<std::string>)> done);

 private:
  friend class base::RefCounted<Evaluator>;
  ~Evaluator();
  base::SequenceBound<EngineState> state_;
  bool ready_ = false;
  bool installing_ = false;
  std::vector<base::OnceCallback<void(bool)>> install_waiters_;
  void Installed(bool ok);
  void BuildAndInstall(Bundle bundle);
  SEQUENCE_CHECKER(sequence_checker_);
  base::WeakPtrFactory<Evaluator> weak_factory_{this};
};
}  // namespace merlin_adblock
#endif
