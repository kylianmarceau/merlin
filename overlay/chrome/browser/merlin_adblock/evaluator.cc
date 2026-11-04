#include "chrome/browser/merlin_adblock/evaluator.h"
#include "chrome/browser/merlin_adblock/cache.h"

#include <map>
#include <memory>
#include <optional>
#include <utility>

#include "base/functional/bind.h"
#include "base/task/bind_post_task.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/threading/thread_checker.h"
#include "base/trace_event/trace_event.h"
#include "components/merlin_adblock/ffi/src/lib.rs.h"

namespace merlin_adblock {
namespace {
// The async span includes the matcher queue and the return hop to the caller.
// spans measure engine work separately, without recording request URLs.
class PendingTrace {
 public:
  explicit PendingTrace(perfetto::StaticString name) {
    TRACE_EVENT_BEGIN("loading", name,
                      perfetto::NamedTrack::FromPointer("MerlinAdblock", this));
  }
  ~PendingTrace() {
    TRACE_EVENT_END("loading",
                    perfetto::NamedTrack::FromPointer("MerlinAdblock", this));
  }
};
template <typename T>
base::OnceCallback<void(T)> Traced(perfetto::StaticString name,
                                   base::OnceCallback<void(T)> done) {
  return base::BindOnce(
      [](std::unique_ptr<PendingTrace> trace, base::OnceCallback<void(T)> done,
         T value) {
        trace.reset();
        std::move(done).Run(std::move(value));
      },
      std::make_unique<PendingTrace>(name), std::move(done));
}
rust::Vec<ffi::ListSource> Sources(const std::vector<Source>& sources) {
  rust::Vec<ffi::ListSource> result;
  for (const auto& source : sources) {
    result.push_back({rust::String(source.id), rust::String(source.text),
                      source.permissions});
  }
  return result;
}
rust::Vec<rust::String> Strings(const std::vector<std::string>& strings) {
  rust::Vec<rust::String> result;
  for (const auto& value : strings)
    result.push_back(rust::String(value));
  return result;
}
std::vector<std::string> Strings(const rust::Vec<rust::String>& strings) {
  std::vector<std::string> result;
  for (const auto& value : strings)
    result.emplace_back(value);
  return result;
}
std::vector<uint8_t> Identity(const std::string& key) {
  std::vector<uint8_t> identity;
  if (!base::HexStringToBytes(key, &identity))
    identity.clear();
  return identity;
}
rust::Slice<const uint8_t> Bytes(const std::vector<uint8_t>& bytes) {
  return rust::Slice<const uint8_t>(bytes.data(), bytes.size());
}
Bundle Build(Bundle bundle) {
  TRACE_EVENT("loading", "MerlinAdblock.Build");
  // Only reached for a fresh build, or after the owner sequence rejected a
  // cached engine. A rejected cache falls back to the application catalog.
  if (bundle.from_cache) {
    if (!bundle.bundled_sources.empty())
      bundle.sources = bundle.bundled_sources;
    bundle.from_cache = false;
  }
  bundle.cache.clear();
  if (!LoadSourceTexts(bundle.sources, bundle.lists_path))
    return bundle;
  bundle = IdentifyBundle(std::move(bundle));
  auto engine = ffi::build_generation(Sources(bundle.sources), bundle.resources,
                                      Bytes(Identity(bundle.key)));
  if (engine->valid()) {
    auto bytes = engine->serialize();
    bundle.cache.assign(reinterpret_cast<const char*>(bytes.data()),
                        bytes.size());
    SaveBundleCache(bundle);
  }
  // List text is only needed to build. Release it here, along with the live
  // engine; only the serialized bytes move to the owner sequence.
  for (auto* sources : {&bundle.sources, &bundle.bundled_sources}) {
    for (auto& source : *sources) {
      source.text = std::string();
      source.text_loaded = false;
    }
  }
  return bundle;
}
}  // namespace

class EngineState {
 public:
  explicit EngineState(scoped_refptr<Matcher> matcher)
      : matcher_(std::move(matcher)) {
    matcher_->state_ = this;
  }
  ~EngineState() {
    DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
    matcher_->state_ = nullptr;
  }
  bool Install(const Bundle& bundle) {
    DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
    DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
    if (bundle.cache.empty())
      return false;
    const auto identity = Identity(bundle.key);
    auto candidate = ffi::load_generation(
        Bytes(identity), bundle.resources,
        rust::Slice<const uint8_t>(
            reinterpret_cast<const uint8_t*>(bundle.cache.data()),
            bundle.cache.size()));
    if (!candidate->valid())
      return false;
    engine_ = std::move(candidate);
    return true;
  }
  bool InstallCached(std::shared_ptr<Bundle> bundle) {
    if (!Install(*bundle))
      return false;
    // Release list text, fallback sources, resources and serialized bytes on
    // this sequence. Only the live generation remains after cache loading.
    *bundle = Bundle{};
    return true;
  }
  Decision Check(GURL url, GURL source, std::string method, uint8_t kind) {
    DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
    DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
    TRACE_EVENT("loading", "MerlinAdblock.Match");
    Decision result;
    if (!engine_)
      return result;
    auto value = (*engine_)->check(url.spec(), source.spec(), method, kind);
    switch (value.kind) {
      case ffi::DecisionKind::Block:
        result.kind = DecisionKind::kBlock;
        break;
      case ffi::DecisionKind::Replace:
        result.kind = DecisionKind::kReplace;
        result.mime = std::string(value.mime);
        result.body.assign(reinterpret_cast<const char*>(value.body.data()),
                           value.body.size());
        break;
      case ffi::DecisionKind::Rewrite:
        result.kind = DecisionKind::kRewrite;
        result.rewritten_url = GURL(std::string(value.rewritten_url));
        break;
      default:
        break;  // Invalid input / engine failure permits browsing.
    }
    return result;
  }
  mojom::DocumentConfigPtr Cosmetics(GURL url) {
    DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
    DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
    auto result = mojom::DocumentConfig::New();
    result->url = url;
    if (!engine_)
      return result;
    auto value = (*engine_)->cosmetics(url.spec());
    result->enabled = true;
    result->generichide = value.generichide;
    result->selectors = Strings(value.selectors);
    result->procedural = Strings(value.procedural);
    result->exceptions = Strings(value.exceptions);
    result->main_script = std::string(value.script);
    result->isolated_script = std::string(value.isolated_script);
    return result;
  }
  std::string Csp(GURL url, GURL source, bool main_document) {
    DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
    DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
    return engine_ ? std::string((*engine_)->csp(url.spec(), source.spec(),
                                                 main_document))
                   : std::string();
  }
  std::vector<std::string> Generic(std::vector<std::string> classes,
                                   std::vector<std::string> ids,
                                   std::vector<std::string> exceptions) {
    DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
    DCHECK_CALLED_ON_VALID_THREAD(thread_checker_);
    if (!engine_)
      return {};
    return Strings((*engine_)->generic_selectors(Strings(classes), Strings(ids),
                                                 Strings(exceptions)));
  }

 private:
  const scoped_refptr<Matcher> matcher_;
  std::optional<rust::Box<ffi::Generation>> engine_;
  THREAD_CHECKER(thread_checker_);
  SEQUENCE_CHECKER(sequence_checker_);
};

Matcher::Matcher(scoped_refptr<base::SingleThreadTaskRunner> runner)
    : runner_(std::move(runner)) {}
Matcher::~Matcher() = default;
void Matcher::Check(const GURL& url,
                    const GURL& source,
                    std::string method,
                    uint8_t kind,
                    base::OnceCallback<void(Decision)> done) {
  runner_->PostTask(
      FROM_HERE,
      base::BindOnce(&Matcher::CheckOnEngine, base::WrapRefCounted(this), url,
                     source, std::move(method), kind,
                     base::BindPostTaskToCurrentDefault(Traced(
                         "MerlinAdblock.CheckRoundTrip", std::move(done)))));
}
void Matcher::Csp(const GURL& url,
                  const GURL& source,
                  bool main_document,
                  base::OnceCallback<void(std::string)> done) {
  runner_->PostTask(
      FROM_HERE,
      base::BindOnce(&Matcher::CspOnEngine, base::WrapRefCounted(this), url,
                     source, main_document,
                     base::BindPostTaskToCurrentDefault(Traced(
                         "MerlinAdblock.CspRoundTrip", std::move(done)))));
}
void Matcher::CheckOnEngine(GURL url,
                            GURL source,
                            std::string method,
                            uint8_t kind,
                            base::OnceCallback<void(Decision)> done) {
  std::move(done).Run(state_ ? state_->Check(std::move(url), std::move(source),
                                             std::move(method), kind)
                             : Decision());
}
void Matcher::CspOnEngine(GURL url,
                          GURL source,
                          bool main_document,
                          base::OnceCallback<void(std::string)> done) {
  std::move(done).Run(state_ ? state_->Csp(std::move(url), std::move(source),
                                           main_document)
                             : std::string());
}

Evaluator::Evaluator()
    // Rust's single-thread Engine must remain on one OS thread, including
    // destruction; a sequenced ThreadPool runner alone may migrate threads.
    : Evaluator(base::ThreadPool::CreateSingleThreadTaskRunner(
          {base::TaskPriority::USER_BLOCKING},
          base::SingleThreadTaskRunnerThreadMode::DEDICATED)) {}
Evaluator::Evaluator(scoped_refptr<base::SingleThreadTaskRunner> runner)
    : matcher_(base::MakeRefCounted<Matcher>(runner)),
      state_(runner, matcher_) {}
Evaluator::~Evaluator() = default;
scoped_refptr<Evaluator> Evaluator::Acquire(const std::string& key) {
  static base::NoDestructor<std::map<std::string, base::WeakPtr<Evaluator>>>
      registry;
  std::erase_if(*registry, [](const auto& entry) { return !entry.second; });
  if (auto found = registry->find(key); found != registry->end())
    return base::WrapRefCounted(found->second.get());
  auto result = base::MakeRefCounted<Evaluator>();
  // The weak registry retains neither engines nor profile data after use.
  if (registry->size() < 64)
    (*registry)[key] = result->weak_factory_.GetWeakPtr();
  return result;
}
void Evaluator::Install(Bundle bundle, base::OnceCallback<void(bool)> done) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  if (ready_) {
    std::move(done).Run(true);
    return;
  }
  install_waiters_.push_back(std::move(done));
  if (installing_)
    return;
  installing_ = true;
  if (bundle.from_cache && !bundle.cache.empty()) {
    auto cached = std::make_shared<Bundle>(std::move(bundle));
    state_.AsyncCall(&EngineState::InstallCached)
        .WithArgs(cached)
        .Then(base::BindOnce(
            [](scoped_refptr<Evaluator> self, std::shared_ptr<Bundle> cached,
               bool ok) {
              if (ok)
                self->Installed(true);
              else
                self->BuildAndInstall(std::move(*cached));
            },
            base::WrapRefCounted(this), cached));
    return;
  }
  BuildAndInstall(std::move(bundle));
}
void Evaluator::BuildAndInstall(Bundle bundle) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  // Serialize on a different, bounded sequence while the old matcher stays
  // live.
  static const base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>>
      builder(base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_VISIBLE}));
  (*builder)->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce(&Build, std::move(bundle)),
      base::BindOnce(
          [](scoped_refptr<Evaluator> self, Bundle built) {
            self->state_.AsyncCall(&EngineState::Install)
                .WithArgs(std::move(built))
                .Then(base::BindOnce(&Evaluator::Installed, self));
          },
          base::WrapRefCounted(this)));
}
void Evaluator::Installed(bool ok) {
  ready_ = ok;
  installing_ = false;
  auto waiters = std::move(install_waiters_);
  install_waiters_.clear();
  for (auto& callback : waiters)
    std::move(callback).Run(ok);
}
void Evaluator::Check(const GURL& url,
                      const GURL& source,
                      std::string method,
                      uint8_t kind,
                      base::OnceCallback<void(Decision)> done) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  matcher_->Check(url, source, std::move(method), kind, std::move(done));
}
void Evaluator::Cosmetics(
    const GURL& url,
    base::OnceCallback<void(mojom::DocumentConfigPtr)> done) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  state_.AsyncCall(&EngineState::Cosmetics)
      .WithArgs(url)
      .Then(Traced("MerlinAdblock.CosmeticsRoundTrip", std::move(done)));
}
void Evaluator::Csp(const GURL& url,
                    const GURL& source,
                    bool main_document,
                    base::OnceCallback<void(std::string)> done) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  matcher_->Csp(url, source, main_document, std::move(done));
}
void Evaluator::Generic(
    std::vector<std::string> classes,
    std::vector<std::string> ids,
    std::vector<std::string> exceptions,
    base::OnceCallback<void(std::vector<std::string>)> done) {
  DCHECK_CALLED_ON_VALID_SEQUENCE(sequence_checker_);
  state_.AsyncCall(&EngineState::Generic)
      .WithArgs(std::move(classes), std::move(ids), std::move(exceptions))
      .Then(Traced("MerlinAdblock.GenericRoundTrip", std::move(done)));
}
}  // namespace merlin_adblock
