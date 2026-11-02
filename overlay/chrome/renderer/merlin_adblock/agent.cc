#include "chrome/renderer/merlin_adblock/agent.h"

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/task/sequenced_task_runner.h"
#include "base/unguessable_token.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "chrome/renderer/merlin_adblock/cosmetics.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/renderer/render_frame.h"
#include "mojo/public/cpp/bindings/binder_map.h"
#include "mojo/public/cpp/bindings/self_owned_receiver.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/browser_resource_cache_policy.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_cache.h"
#include "third_party/blink/public/platform/web_security_origin.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/web/web_document.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_local_frame_client.h"
#include "third_party/blink/public/web/web_resource_cache_policy.h"
#include "third_party/blink/public/web/web_script_execution_policy.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "v8/include/v8.h"

namespace merlin_adblock {
namespace {
class ProcessHost : public mojom::AdblockProcess {
 public:
  void InvalidateResourceCache(InvalidateResourceCacheCallback done) override {
    blink::InvalidateBrowserResourceCachePolicy();
    blink::WebCache::Clear();
    std::move(done).Run();
  }
};
void BindProcess(mojo::PendingReceiver<mojom::AdblockProcess> receiver) {
  mojo::MakeSelfOwnedReceiver(std::make_unique<ProcessHost>(),
                              std::move(receiver));
}
}  // namespace
void RegisterProcessBinders(mojo::BinderMap* binders) {
  if (base::FeatureList::IsEnabled(kMerlinAdblock)) {
    blink::SetBrowserResourceCachePolicyEnabled(true);
    binders->Add<mojom::AdblockProcess>(
        base::BindRepeating(&BindProcess),
        base::SequencedTaskRunner::GetCurrentDefault());
  }
}
Agent::Agent(content::RenderFrame* frame)
    : RenderFrameObserver(frame),
      content::RenderFrameObserverTracker<Agent>(frame) {
  frame->GetAssociatedInterfaceRegistry()->AddInterface<mojom::AdblockAgent>(
      base::BindRepeating(&Agent::Bind, weak_factory_.GetWeakPtr()));
}
Agent::~Agent() = default;
void Agent::Bind(
    mojo::PendingAssociatedReceiver<mojom::AdblockAgent> receiver) {
  receivers_.Add(this, std::move(receiver));
}
void Agent::Prepare(mojom::DocumentConfigPtr config, PrepareCallback done) {
  // At most one not-yet-committed generation per frame. Subsequent commit
  // messages on the same associated channel determine which document receives
  // it.
  pending_ = std::move(config);
  std::move(done).Run();
}
void Agent::DidCreateNewDocument() {
  cosmetic_timer_.Stop();
  host_.reset();
  generic_pending_ = false;
  inserted_.clear();
  css_bytes_ = 0;
  current_ = std::move(pending_);
  initial_template_.reset();
  if (current_ && current_->enabled)
    initial_template_ =
        std::make_shared<const mojom::DocumentConfigPtr>(current_->Clone());
  injected_ = false;
  helper_installed_ = false;
  SetCachePartition();
}
void Agent::SetCachePartition() {
  if (!current_ || current_->cache_partition.empty())
    return;
  auto* frame = render_frame()->GetWebFrame();
  std::string partition = current_->cache_partition;
  if (frame->GetSecurityOrigin().IsOpaque())
    partition += ":" + current_->token;
  blink::SetBrowserResourceCachePartition(
      *frame, blink::WebString::FromUtf8(partition));
}
void Agent::DidCreateScriptContext(v8::Local<v8::Context> context, int world) {
  if (world != 0 || injected_)
    return;
  InheritInitialConfiguration();
  if (!current_ || !current_->enabled || !current_->scripts_allowed)
    return;
  if (!blink::IsScriptExecutionAllowed(*render_frame()->GetWebFrame()))
    return;
  const GURL url(render_frame()->GetWebFrame()->GetDocument().Url());
  if (url != current_->url) {
    current_.reset();
    return;
  }
  injected_ = true;
  // Run in the page's actual main context before its first script. No CSP or
  // sandbox policy is changed, and no script element/remote URL is introduced.
  if (!current_->main_script.empty()) {
    auto* isolate = v8::Isolate::GetCurrent();
    v8::HandleScope handles(isolate);
    v8::Context::Scope scope(context);
    v8::TryCatch errors(isolate);
    std::string script = "(()=>{const scriptletGlobals={};\n" +
                         std::move(current_->main_script) + "\n})()";
    v8::Local<v8::String> source;
    v8::Local<v8::Script> compiled;
    if (v8::String::NewFromUtf8(isolate, script.data(),
                                v8::NewStringType::kNormal, script.size())
            .ToLocal(&source) &&
        v8::Script::Compile(context, source).ToLocal(&compiled)) {
      auto ignored = compiled->Run(context);
      (void)ignored;
    }
  }
  if (!current_->isolated_script.empty()) {
    std::string isolated = "(()=>{const scriptletGlobals={};\n" +
                           std::move(current_->isolated_script) + "\n})()";
    render_frame()->GetWebFrame()->ExecuteScriptInIsolatedWorld(
        ISOLATED_WORLD_ID_MERLIN_ADBLOCK,
        blink::WebScriptSource(blink::WebString::FromUtf8(isolated)),
        blink::BackForwardCacheAware::kAllow);
  }
  current_->main_script.clear();
  current_->isolated_script.clear();
  cosmetic_timer_.Start(
      FROM_HERE, base::Milliseconds(250),
      base::BindRepeating(&Agent::PollCosmetics, weak_factory_.GetWeakPtr()));
}
void Agent::EnsureCosmeticHelper() {
  if (helper_installed_)
    return;
  helper_installed_ = true;
  // Helpers first run at the initial scan tick. Actual scriptlets still execute
  // before the page's first script; clean pages avoid creating an empty MAIN
  // wrapper or an isolated world on their initial rendering path.
  base::ListValue rules;
  size_t bytes = 0;
  for (const auto& rule : current_->procedural) {
    if (rules.size() >= 256 || (bytes += rule.size()) > 256 * 1024)
      break;
    auto value = base::JSONReader::Read(rule, base::JSON_PARSE_RFC);
    if (value && value->is_dict())
      rules.Append(std::move(*value));
  }
  std::string encoded;
  base::JSONWriter::Write(rules, &encoded);
  std::string helper(kCosmeticHelper);
  helper.replace(helper.find("MERLIN_PROCEDURAL_RULES"),
                 sizeof("MERLIN_PROCEDURAL_RULES") - 1, encoded);
  current_->procedural.clear();
  render_frame()->GetWebFrame()->ExecuteScriptInIsolatedWorld(
      ISOLATED_WORLD_ID_MERLIN_ADBLOCK,
      blink::WebScriptSource(blink::WebString::FromUtf8(helper)),
      blink::BackForwardCacheAware::kAllow);
}
void Agent::DidCreateDocumentElement() {
  InheritInitialConfiguration();
  if (!current_ || !current_->enabled)
    return;
  if (GURL(render_frame()->GetWebFrame()->GetDocument().Url()) != current_->url)
    return;
  InsertSelectors(current_->selectors);
}
void Agent::InheritInitialConfiguration() {
  if (current_)
    return;
  auto* frame = render_frame()->GetWebFrame();
  const GURL url(frame->GetDocument().Url());
  if (!url.IsAboutBlank() && !url.IsAboutSrcdoc())
    return;
  auto* parent = frame->Parent();
  if (!parent)
    parent = frame->Opener();
  if (!parent || !parent->IsWebLocalFrame() ||
      !frame->GetSecurityOrigin().CanAccess(parent->GetSecurityOrigin()))
    return;
  auto* parent_frame =
      content::RenderFrame::FromWebFrame(parent->ToWebLocalFrame());
  auto* parent_agent = parent_frame ? Agent::Get(parent_frame) : nullptr;
  if (!parent_agent || !parent_agent->initial_template_)
    return;
  // One immutable selected-resource template is shared by inherited frames;
  // they receive neither engine rule copies nor access to another origin.
  initial_template_ = parent_agent->initial_template_;
  current_ = (*initial_template_)->Clone();
  current_->url = url;
  current_->token = base::UnguessableToken::Create().ToString();
  current_->scripts_allowed &= blink::IsScriptExecutionAllowed(*frame);
  SetCachePartition();
  InsertSelectors(current_->selectors);
}
void Agent::InsertSelectors(const std::vector<std::string>& selectors) {
  std::string css;
  for (const auto& selector : selectors) {
    if (inserted_.size() >= 8192 || css_bytes_ + selector.size() > 1024 * 1024)
      break;
    if (!inserted_.insert(selector).second)
      continue;
    css_bytes_ += selector.size();
    css += selector + "{display:none!important;}\n";
  }
  if (!css.empty())
    render_frame()->GetWebFrame()->GetDocument().InsertStyleSheet(
        blink::WebString::FromUtf8(css));
}
void Agent::PollCosmetics() {
  if (!current_ || !current_->enabled || generic_pending_)
    return;
  auto* frame = render_frame()->GetWebFrame();
  if (GURL(frame->GetDocument().Url()) != current_->url)
    return;
  EnsureCosmeticHelper();
  auto* isolate = frame->GetAgentGroupScheduler()->Isolate();
  v8::HandleScope handles(isolate);
  auto result = frame->ExecuteScriptInIsolatedWorldAndReturnValue(
      ISOLATED_WORLD_ID_MERLIN_ADBLOCK,
      blink::WebScriptSource(
          blink::WebString::FromUtf8("globalThis.__merlinAdblockTick?.()")),
      blink::BackForwardCacheAware::kAllow);
  if (result.IsEmpty() || !result->IsString())
    return;
  v8::String::Utf8Value string(isolate, result);
  if (!*string || string.length() > 128 * 1024)
    return;
  auto identifiers = base::JSONReader::ReadDict(
      std::string_view(*string, string.length()), base::JSON_PARSE_RFC);
  if (!identifiers || current_->generichide)
    return;
  std::vector<std::string> classes, ids;
  auto collect = [](const base::ListValue* list,
                    std::vector<std::string>& output) {
    if (!list)
      return;
    for (const auto& item : *list)
      if (item.is_string() && item.GetString().size() <= 256 &&
          output.size() < 128)
        output.push_back(item.GetString());
  };
  collect(identifiers->FindList("classes"), classes);
  collect(identifiers->FindList("ids"), ids);
  if (classes.empty() && ids.empty())
    return;
  EnsureHost();
  generic_pending_ = true;
  host_->GenericSelectors(
      current_->token, classes, ids,
      base::BindOnce(&Agent::GenericReceived, weak_factory_.GetWeakPtr(),
                     current_->token));
}
void Agent::EnsureHost() {
  if (!host_) {
    render_frame()->GetBrowserInterfaceBroker().GetInterface(
        host_.BindNewPipeAndPassReceiver());
    host_.set_disconnect_handler(base::BindOnce(
        [](base::WeakPtr<Agent> self) {
          if (self) {
            self->host_.reset();
            self->generic_pending_ = false;
          }
        },
        weak_factory_.GetWeakPtr()));
  }
}
void Agent::CheckRequest(
    GURL url,
    std::string method,
    uint8_t type,
    base::OnceCallback<void(mojom::RequestDecisionPtr)> done) {
  // Request protection uses live browser preferences. A document initially
  // loaded with protection off still needs checks when the user enables it.
  EnsureHost();
  host_->CheckRequest(url, method, type, std::move(done));
}
void Agent::GenericReceived(std::string token,
                            const std::vector<std::string>& selectors) {
  if (!current_ || current_->token != token)
    return;
  generic_pending_ = false;
  InsertSelectors(selectors);
}
void Agent::DidFinishSameDocumentNavigation() {
  if (current_)
    current_->url = GURL(render_frame()->GetWebFrame()->GetDocument().Url());
}
void Agent::DidSetPageLifecycleState(blink::BFCacheStateChange state) {
  if (state == blink::BFCacheStateChange::kStoredToBFCache)
    cosmetic_timer_.Stop();
  if (state == blink::BFCacheStateChange::kRestoredFromBFCache && current_ &&
      current_->enabled && current_->scripts_allowed)
    cosmetic_timer_.Start(
        FROM_HERE, base::Milliseconds(250),
        base::BindRepeating(&Agent::PollCosmetics, weak_factory_.GetWeakPtr()));
}
void Agent::OnDestruct() {
  delete this;
}
}  // namespace merlin_adblock
