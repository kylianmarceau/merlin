#ifndef CHROME_RENDERER_MERLIN_ADBLOCK_AGENT_H_
#define CHROME_RENDERER_MERLIN_ADBLOCK_AGENT_H_
#include <deque>
#include <memory>
#include <set>
#include <string_view>
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "components/merlin_adblock/common/adblock.mojom.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_frame_observer_tracker.h"
#include "mojo/public/cpp/bindings/associated_receiver_set.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/public/common/tokens/tokens.h"

namespace mojo {
class BinderMap;
}
namespace merlin_adblock {
void RegisterProcessBinders(mojo::BinderMap* binders);
class Agent : public content::RenderFrameObserver,
              public content::RenderFrameObserverTracker<Agent>,
              public mojom::AdblockAgent {
 public:
  explicit Agent(content::RenderFrame* frame);
  ~Agent() override;
  void CheckRequest(GURL url,
                    std::string method,
                    uint8_t type,
                    base::OnceCallback<void(mojom::RequestDecisionPtr)> done);
  // Publishes this document's request policy for off-main-thread throttles.
  void UpdateRequestPolicy(bool service_worker_controlled);
  // Newly seen DOM class/id names from the isolated cosmetic helper.
  void ReceiveIdentifiers(std::string_view json);
  void Prepare(mojom::DocumentConfigPtr configuration,
               PrepareCallback done) override;
  void DidCreateNewDocument() override;
  void DidCreateScriptContext(v8::Local<v8::Context> context,
                              int world) override;
  void DidCreateDocumentElement() override;
  void DidFinishSameDocumentNavigation() override;
  void OnDestruct() override;

 private:
  void Bind(mojo::PendingAssociatedReceiver<mojom::AdblockAgent> receiver);
  void FlushGeneric();
  void EnsureCosmeticHelper();
  void EnsureHost();
  void InheritInitialConfiguration();
  void SetCachePartition();
  void InsertSelectors(const std::vector<std::string>& selectors);
  void GenericReceived(std::string token,
                       const std::vector<std::string>& selectors);
  mojom::DocumentConfigPtr pending_;
  mojom::DocumentConfigPtr current_;
  std::shared_ptr<const mojom::DocumentConfigPtr> initial_template_;
  mojo::AssociatedReceiverSet<mojom::AdblockAgent> receivers_;
  bool injected_ = false;
  bool helper_installed_ = false;
  bool generic_pending_ = false;
  std::set<std::string> inserted_;
  size_t css_bytes_ = 0;
  const blink::LocalFrameToken token_;
  std::deque<std::string> queued_classes_;
  std::deque<std::string> queued_ids_;
  base::OneShotTimer helper_timer_;
  mojo::Remote<mojom::AdblockHost> host_;
  base::WeakPtrFactory<Agent> weak_factory_{this};
};
}  // namespace merlin_adblock
#endif
