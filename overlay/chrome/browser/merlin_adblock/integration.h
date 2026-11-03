#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_INTEGRATION_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_INTEGRATION_H_
#include <memory>
#include "content/public/browser/commit_deferring_condition.h"
namespace content {
class NavigationThrottleRegistry;
}
namespace merlin_adblock {
std::unique_ptr<content::CommitDeferringCondition> PrepareDocument(
    content::NavigationHandle& navigation,
    content::CommitDeferringCondition::NavigationType type);
void AddInheritedDocumentThrottle(
    content::NavigationThrottleRegistry& registry);
}  // namespace merlin_adblock
#endif
