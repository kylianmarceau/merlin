#import "AppDelegate.h"
#import <React/RCTBridge.h>
#import <React/RCTRootView.h>
#import <React/RCTBundleURLProvider.h>
#import <MerlinEngine/MerlinShellAPI.h>

@implementation MerlinShellRuntime {
  RCTBridge* _bridge;
}
- (NSView*)rootForWindow:(NSString*)windowID {
  NSAssert(NSThread.isMainThread, @"Create React roots on the browser UI thread");
  if (!_bridge) _bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:nil];
  RCTRootView* root = [[RCTRootView alloc] initWithBridge:_bridge
      moduleName:@"MerlinShell" initialProperties:@{@"windowId": windowID}];
  root.backgroundColor = NSColor.clearColor;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  return root;
}
- (NSURL*)sourceURLForBridge:(RCTBridge*)bridge {
#if DEBUG
  // A packaged bundle also works offline in Debug. Metro is an explicit opt-in.
  if ([NSProcessInfo.processInfo.environment[@"MERLIN_USE_METRO"] isEqualToString:@"1"])
    return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#endif
  return [NSBundle.mainBundle URLForResource:@"main" withExtension:@"jsbundle"];
}
- (void)invalidate {
  [_bridge invalidate];
  _bridge = nil;
}
@end

namespace {
MerlinShellRuntime* runtime;
void* CreateRoot(const char* window) {
  if (!NSThread.isMainThread || !window || !window[0]) return nullptr;
  if (!runtime) runtime = [MerlinShellRuntime new];
  NSView* root = [runtime rootForWindow:[NSString stringWithUTF8String:window]];
  return (__bridge_retained void*)root;
}
void ReleaseRoot(void* pointer) {
  NSCAssert(NSThread.isMainThread, @"Release React roots on the browser UI thread");
  if (!pointer) return;
  NSView* view = (__bridge_transfer NSView*)pointer;
  [view removeFromSuperview];
}
void Shutdown() {
  NSCAssert(NSThread.isMainThread, @"Shut down React on the browser UI thread");
  [runtime invalidate];
  runtime = nil;
}
const MerlinShellAPI api = {1, sizeof(MerlinShellAPI), CreateRoot, ReleaseRoot, Shutdown};
}
extern "C" __attribute__((visibility("default"), used))
const MerlinShellAPI* MerlinShellGetAPI(uint32_t version) {
  return version == 1 ? &api : nullptr;
}
