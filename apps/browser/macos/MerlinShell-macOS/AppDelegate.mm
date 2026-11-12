#import "AppDelegate.h"
#import <React/RCTBridge.h>
#import <React/RCTRootView.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTPerformanceLogger.h>
#import <MerlinEngine/MerlinShellAPI.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <unistd.h>

// MERLIN_STARTUP_TRACE=<file> appends "<event> <ms since process start>"
// lines, so a benchmark can see where launch time goes.
static FILE* TraceFile() {
  static FILE* file = [] {
    const char* path = getenv("MERLIN_STARTUP_TRACE");
    return path && path[0] ? fopen(path, "a") : nullptr;
  }();
  return file;
}
static double MillisecondsSinceProcessStart() {
  static double start = [] {
    struct kinfo_proc info;
    size_t size = sizeof(info);
    int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()};
    if (sysctl(mib, 4, &info, &size, nullptr, 0) != 0) return 0.0;
    return info.kp_proc.p_starttime.tv_sec * 1000.0 + info.kp_proc.p_starttime.tv_usec / 1000.0;
  }();
  struct timeval now;
  gettimeofday(&now, nullptr);
  return now.tv_sec * 1000.0 + now.tv_usec / 1000.0 - start;
}
void MerlinStartupTrace(const char* event) {
  FILE* file = TraceFile();
  if (!file) return;
  fprintf(file, "%s %.1f\n", event, MillisecondsSinceProcessStart());
  fflush(file);
}

@implementation MerlinShellRuntime {
  RCTBridge* _bridge;
}
- (instancetype)init {
  if ((self = [super init]) && TraceFile()) {
    NSNotificationCenter* center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:RCTJavaScriptDidLoadNotification object:nil queue:nil
                    usingBlock:^(NSNotification*) { MerlinStartupTrace("js-loaded"); }];
    __weak MerlinShellRuntime* weakSelf = self;
    [center addObserverForName:RCTContentDidAppearNotification object:nil queue:nil
                    usingBlock:^(NSNotification*) {
      MerlinStartupTrace("content-appeared");
      MerlinShellRuntime* strongSelf = weakSelf;
      RCTPerformanceLogger* logger = strongSelf ? strongSelf->_bridge.performanceLogger : nil;
      if (!logger) return;
      // React Native's own startup durations, in ms.
      fprintf(TraceFile(), "rn script-execution=%lld native-module-init=%lld main-thread-modules=%lld "
              "main-thread-module-count=%lld bridge-startup=%lld tti=%lld\n",
              [logger durationForTag:RCTPLScriptExecution], [logger durationForTag:RCTPLNativeModuleInit],
              [logger durationForTag:RCTPLNativeModuleMainThread], [logger valueForTag:RCTPLNativeModuleMainThreadUsesCount],
              [logger durationForTag:RCTPLBridgeStartup], [logger durationForTag:RCTPLTTI]);
      fflush(TraceFile());
    }];
  }
  return self;
}
// Starts the bridge: native modules are set up and the Hermes bundle loads
// on the JavaScript thread while Chromium carries on starting.
- (void)prewarm {
  NSAssert(NSThread.isMainThread, @"Start React on the browser UI thread");
  if (_bridge) return;
  MerlinStartupTrace("bridge-start");
  _bridge = [[RCTBridge alloc] initWithDelegate:self launchOptions:nil];
  MerlinStartupTrace("bridge-created");
}
- (NSView*)rootForWindow:(NSString*)windowID {
  NSAssert(NSThread.isMainThread, @"Create React roots on the browser UI thread");
  [self prewarm];
  MerlinStartupTrace("root-start");
  RCTRootView* root = [[RCTRootView alloc] initWithBridge:_bridge
      moduleName:@"MerlinShell" initialProperties:@{@"windowId": windowID}];
  root.backgroundColor = NSColor.clearColor;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  MerlinStartupTrace("root-created");
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
MerlinShellRuntime* Runtime() {
  if (!runtime) runtime = [MerlinShellRuntime new];
  return runtime;
}
void* CreateRoot(const char* window) {
  if (!NSThread.isMainThread || !window || !window[0]) return nullptr;
  NSView* root = [Runtime() rootForWindow:[NSString stringWithUTF8String:window]];
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
void Prewarm() {
  // Off unless MERLIN_PREWARM=1. Measured on 2026-11-12, starting React
  // while Chromium loads the profile delayed the first page by about 25 ms
  // and did not bring the window forward (docs/PERFORMANCE.md).
  const char* on = getenv("MERLIN_PREWARM");
  if (!on || strcmp(on, "1")) return;
  if (NSThread.isMainThread) [Runtime() prewarm];
}
const MerlinShellAPI api = {1, sizeof(MerlinShellAPI), CreateRoot, ReleaseRoot, Shutdown, Prewarm};
}
extern "C" __attribute__((visibility("default"), used))
const MerlinShellAPI* MerlinShellGetAPI(uint32_t version) {
  return version == 1 ? &api : nullptr;
}
