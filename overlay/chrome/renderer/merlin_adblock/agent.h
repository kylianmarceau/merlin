#ifndef CHROME_RENDERER_MERLIN_ADBLOCK_AGENT_H_
#define CHROME_RENDERER_MERLIN_ADBLOCK_AGENT_H_
#include <memory>
#include <set>
#include "base/memory/weak_ptr.h"
#include "base/timer/timer.h"
#include "components/merlin_adblock/common/adblock.mojom.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_frame_observer_tracker.h"
#include "mojo/public/cpp/bindings/associated_receiver_set.h"
#include "mojo/public/cpp/bindings/remote.h"

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
  void Prepare(mojom::DocumentConfigPtr configuration,
               PrepareCallback done) override;
  void DidCreateNewDocument() override;
  void DidCreateScriptContext(v8::Local<v8::Context> context,
                              int world) override;
  void DidCreateDocumentElement() override;
  void DidFinishSameDocumentNavigation() override;
  void DidSetPageLifecycleState(blink::BFCacheStateChange state) override;
  void OnDestruct() override;

 private:
  void Bind(mojo::PendingAssociatedReceiver<mojom::AdblockAgent> receiver);
  void PollCosmetics();
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
  base::RepeatingTimer cosmetic_timer_;
  mojo::Remote<mojom::AdblockHost> host_;
  base::WeakPtrFactory<Agent> weak_factory_{this};
};
}  // namespace merlin_adblock
#endif
