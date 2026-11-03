#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_POPUPS_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_POPUPS_H_
namespace content {
class NavigationThrottleRegistry;
class WebContents;
}  // namespace content
namespace merlin_adblock {
void ObserveWindows(content::WebContents* contents);
void AddWindowNavigationThrottle(content::NavigationThrottleRegistry& registry);
}  // namespace merlin_adblock
#endif
