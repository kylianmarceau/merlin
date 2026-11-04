#include "chrome/renderer/merlin_adblock/agent.h"

#include <string_view>

#include "base/feature_list.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/strings/string_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/trace_event/trace_event.h"
#include "base/unguessable_token.h"
#include "chrome/common/chrome_isolated_world_ids.h"
#include "chrome/renderer/merlin_adblock/cosmetics.h"
#include "chrome/renderer/merlin_adblock/request_throttle.h"
#include "components/merlin_adblock/common/features.h"
#include "content/public/renderer/render_frame.h"
#include "content/public/renderer/service_worker_controller_observer.h"
#include "mojo/public/cpp/bindings/binder_map.h"
#include "mojo/public/cpp/bindings/self_owned_receiver.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/browser_interface_broker_proxy.h"
#include "third_party/blink/public/platform/browser_resource_cache_policy.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/task_type.h"
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
// Colons/commas in quoted attribute values (for example an https: URL) are
// not pseudo-selectors or selector lists. Keep those selectors in the batch
// too, while preserving independent rules for actual pseudos and lists.
bool CanBatchSelector(std::string_view selector) {
  unsigned brackets = 0;
  char quote = 0;
  bool escaped = false;
  for (char c : selector) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c == '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (c == quote)
        quote = 0;
      continue;
    }
    if (c == '\'' || c == '"') {
      quote = c;
    } else if (c == '[') {
      ++brackets;
    } else if (c == ']') {
      if (!brackets)
        return false;
      --brackets;
    } else if (!brackets && (c == ':' || c == ',')) {
      return false;
    }
  }
  return !quote && !brackets && !escaped;
}

// Recognize only a small, unambiguous CSS subset: an ASCII type selector
// followed by zero or more attribute selectors. These dominate the default
// generic rules. They can share a normal selector list without the recursive
// :is() match on every element. Everything else keeps forgiving isolation.
bool IsSimpleAttributeSelector(std::string_view text) {
  size_t at = 0;
  const auto identifier = [&] {
    const size_t start = at;
    if (at == text.size() || (!base::IsAsciiAlpha(text[at]) && text[at] != '_'))
      return false;
    while (at < text.size() &&
           (base::IsAsciiAlpha(text[at]) || base::IsAsciiDigit(text[at]) ||
            text[at] == '_' || text[at] == '-'))
      ++at;
    return at > start;
  };
  const auto space = [&] {
    while (at < text.size() && std::string_view(" \t\n\r\f").find(text[at]) !=
                                   std::string_view::npos)
      ++at;
  };
  bool any = identifier();
  while (at < text.size()) {
    if (text[at++] != '[')
      return false;
    space();
    if (!identifier())
      return false;
    space();
    if (at == text.size())
      return false;
    if (text[at] != ']') {
      if (text[at] != '=') {
        if (std::string_view("~|^$*").find(text[at]) == std::string_view::npos)
          return false;
        ++at;
      }
      if (at == text.size() || text[at++] != '=')
        return false;
      space();
      if (at == text.size())
        return false;
      if (text[at] == '\'' || text[at] == '"') {
        const char quote = text[at++];
        while (at < text.size() && text[at] != quote) {
          if (text[at] == '\\' || static_cast<unsigned char>(text[at]) < 0x20 ||
              text[at] == 0x7f)
            return false;
          ++at;
        }
        if (at == text.size())
          return false;
        ++at;
      } else if (!identifier()) {
        return false;
      }
      space();
    }
    if (at == text.size() || text[at++] != ']')
      return false;
    any = true;
  }
  return any;
}

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
Agent* AgentFor(blink::WebLocalFrame* frame) {
  auto* render_frame = frame ? content::RenderFrame::FromWebFrame(frame) : nullptr;
  return render_frame ? Agent::Get(render_frame) : nullptr;
}
// clients.claim() or loss of control after commit.
void ControllerChanged(const blink::LocalFrameToken& token, bool controlled) {
  if (auto* agent = AgentFor(blink::WebLocalFrame::FromFrameToken(token)))
    agent->UpdateRequestPolicy(controlled);
  else
    SetFrameRequestPolicy(token, controlled, {});
}
// Installed only in Merlin's isolated world: the cosmetic helper pushes newly
// seen class/id names here instead of native code polling it on a timer.
void ReportIdentifiers(const v8::FunctionCallbackInfo<v8::Value>& info) {
  auto* isolate = info.GetIsolate();
  if (info.Length() != 1 || !info[0]->IsString())
    return;
  auto* agent = AgentFor(
      blink::WebLocalFrame::FrameForContext(isolate->GetCurrentContext()));
  if (!agent)
    return;
  v8::String::Utf8Value value(isolate, info[0]);
  if (*value && value.length() <= 512 * 1024)
    agent->ReceiveIdentifiers(std::string_view(*value, value.length()));
}
}  // namespace
void RegisterProcessBinders(mojo::BinderMap* binders) {
  if (base::FeatureList::IsEnabled(kMerlinAdblock)) {
    content::SetServiceWorkerControllerObserver(&ControllerChanged);
    blink::SetBrowserResourceCachePolicyEnabled(true);
    binders->Add<mojom::AdblockProcess>(
        base::BindRepeating(&BindProcess),
        base::SequencedTaskRunner::GetCurrentDefault());
  }
}
Agent::Agent(content::RenderFrame* frame)
    : RenderFrameObserver(frame),
      content::RenderFrameObserverTracker<Agent>(frame),
      token_(frame->GetWebFrame()->GetLocalFrameToken()) {
  // Frame-scheduled, so background and frozen pages throttle or pause it.
  helper_timer_.SetTaskRunner(
      frame->GetTaskRunner(blink::TaskType::kInternalDefault));
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
void Agent::UpdateRequestPolicy(bool controlled) {
  mojo::PendingRemote<mojom::AdblockHost> host;
  if (controlled)
    render_frame()->GetBrowserInterfaceBroker().GetInterface(
        host.InitWithNewPipeAndPassReceiver());
  SetFrameRequestPolicy(token_, controlled, std::move(host));
}
void Agent::DidCreateNewDocument() {
  TRACE_EVENT("loading", "MerlinAdblock.NewDocument");
  UpdateRequestPolicy(IsServiceWorkerControlled(render_frame()->GetWebFrame()));
  helper_timer_.Stop();
  host_.reset();
  generic_pending_ = false;
  queued_classes_.clear();
  queued_ids_.clear();
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
  if (world == ISOLATED_WORLD_ID_MERLIN_ADBLOCK) {
    auto* isolate = v8::Isolate::GetCurrent();
    v8::HandleScope handles(isolate);
    v8::Local<v8::Function> report;
    if (v8::Function::New(context, &ReportIdentifiers).ToLocal(&report)) {
      auto ignored = context->Global()->Set(
          context,
          v8::String::NewFromUtf8Literal(isolate, "__merlinAdblockReport"),
          report);
      (void)ignored;
    }
    return;
  }
  if (world != 0 || injected_)
    return;
  InheritInitialConfiguration();
  if (!current_ || !current_->enabled || !current_->scripts_allowed)
    return;
  TRACE_EVENT("loading", "MerlinAdblock.DocumentScripts");
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
  // With generic hiding off and no procedural rules there is nothing to scan.
  if (current_->generichide && current_->procedural.empty())
    return;
  helper_timer_.Start(
      FROM_HERE, base::Milliseconds(250),
      base::BindOnce(&Agent::EnsureCosmeticHelper, weak_factory_.GetWeakPtr()));
}
void Agent::EnsureCosmeticHelper() {
  if (helper_installed_ || !current_ || !current_->enabled)
    return;
  if (GURL(render_frame()->GetWebFrame()->GetDocument().Url()) != current_->url)
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
  helper.replace(helper.find("MERLIN_COLLECT_IDENTIFIERS"),
                 sizeof("MERLIN_COLLECT_IDENTIFIERS") - 1,
                 current_->generichide ? "false" : "true");
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
  TRACE_EVENT("loading", "MerlinAdblock.InsertSelectors");
  std::string css, grouped;
  for (const auto& selector : selectors) {
    if (inserted_.size() >= 8192 || css_bytes_ + selector.size() > 1024 * 1024)
      break;
    if (!inserted_.insert(selector).second)
      continue;
    css_bytes_ += selector.size();
    if (CanBatchSelector(selector)) {
      if (!grouped.empty())
        grouped += ",\n";
      // Known-valid simple selectors preserve their own specificity in the
      // normal list. A single-argument :is() preserves specificity and
      // forgiving isolation for everything outside the recognized subset.
      // Keep pseudo-elements and existing selector lists outside :is().
      grouped += IsSimpleAttributeSelector(selector) ? selector
                                                     : ":is(" + selector + ")";
    } else {
      css += selector + "{display:none!important;}\n";
    }
  }
  if (!grouped.empty())
    css += grouped + "{display:none!important;}\n";
  if (!css.empty())
    render_frame()->GetWebFrame()->GetDocument().InsertStyleSheet(
        blink::WebString::FromUtf8(css));
}
void Agent::ReceiveIdentifiers(std::string_view json) {
  if (!current_ || !current_->enabled || current_->generichide)
    return;
  if (GURL(render_frame()->GetWebFrame()->GetDocument().Url()) != current_->url)
    return;
  auto identifiers = base::JSONReader::ReadDict(json, base::JSON_PARSE_RFC);
  if (!identifiers)
    return;
  auto collect = [](const base::ListValue* list, std::deque<std::string>& queue) {
    if (!list)
      return;
    for (const auto& item : *list)
      if (item.is_string() && item.GetString().size() <= 256 &&
          queue.size() < 4096)
        queue.push_back(item.GetString());
  };
  collect(identifiers->FindList("classes"), queued_classes_);
  collect(identifiers->FindList("ids"), queued_ids_);
  FlushGeneric();
}
void Agent::FlushGeneric() {
  if (generic_pending_ || !current_ ||
      (queued_classes_.empty() && queued_ids_.empty()))
    return;
  std::vector<std::string> classes, ids;
  auto take = [](std::deque<std::string>& queue,
                 std::vector<std::string>& output) {
    while (!queue.empty() && output.size() < 128) {
      output.push_back(std::move(queue.front()));
      queue.pop_front();
    }
  };
  take(queued_classes_, classes);
  take(queued_ids_, ids);
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
  FlushGeneric();
}
void Agent::DidFinishSameDocumentNavigation() {
  if (!current_)
    return;
  current_->url = GURL(render_frame()->GetWebFrame()->GetDocument().Url());
  // Single-page navigations replace content; rescan (path rules included).
  if (helper_installed_)
    render_frame()->GetWebFrame()->ExecuteScriptInIsolatedWorld(
        ISOLATED_WORLD_ID_MERLIN_ADBLOCK,
        blink::WebScriptSource(
            blink::WebString::FromUtf8("globalThis.__merlinAdblockRescan?.()")),
        blink::BackForwardCacheAware::kAllow);
}
void Agent::OnDestruct() {
  RemoveFrameRequestPolicy(token_);
  delete this;
}
}  // namespace merlin_adblock
