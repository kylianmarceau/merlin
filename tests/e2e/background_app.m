// Test-only. Keeps a Merlin under test from ever becoming the frontmost app,
// so it can't take the keyboard from whoever is using the Mac. The harness
// compiles this into a dylib and injects it with DYLD_INSERT_LIBRARIES into
// the test instance's browser process only (merlin_e2e.py). The same two calls
// Chromium's headless mode makes, and the deleted browser_tests shim made:
// a background process type, then a prohibited activation policy once AppKit
// has registered the app (which can undo the first call).
//
// Works only on builds without the hardened runtime, which Merlin's ad-hoc
// signed releases are.

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <WebKit/WebKit.h>
#include <crt_externs.h>
#include <stdlib.h>
#include <string.h>

static WKWebView* VideoFixtureView(NSView* view) {
  if (view.isHidden) return nil;
  if ([view isKindOfClass:WKWebView.class]) {
    WKWebView* web = (WKWebView*)view;
    return [web.URL.host isEqualToString:@"wk.localhost"] &&
           [web.URL.path isEqualToString:@"/wkvideo"] && !web.loading ? web : nil;
  }
  for (NSView* child in view.subviews) {
    WKWebView* web = VideoFixtureView(child);
    if (web) return web;
  }
  return nil;
}

// Drive the test's window and WebKit video without activating the app.
static void WatchPictureInPictureWindow(NSString* path) {
  __block __weak NSWindow* browserWindow = nil;
  [NSTimer scheduledTimerWithTimeInterval:0.05 repeats:YES block:^(NSTimer* timer) {
    NSString* action = [NSString stringWithContentsOfFile:path
                                                encoding:NSUTF8StringEncoding
                                                   error:nil];
    if ([action isEqualToString:@"play"]) {
      for (NSWindow* window in NSApp.orderedWindows) {
        WKWebView* view = VideoFixtureView(window.contentView);
        if (!view) continue;
        // WebKit's host JavaScript evaluation supplies transient activation.
        [view callAsyncJavaScript:@"await document.getElementById('v').play()"
                        arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld
                completionHandler:^(id result, NSError* error) {
          if (error) NSLog(@"WebKit video fixture: %@", error);
        }];
        [NSFileManager.defaultManager removeItemAtPath:path error:nil];
        return;
      }
      return;
    } else if ([action isEqualToString:@"hide"]) {
      if (!browserWindow) {
        for (NSWindow* window in NSApp.orderedWindows) {
          if (window.visible && window.level == NSNormalWindowLevel) {
            browserWindow = window;
            break;
          }
        }
      }
      if (!browserWindow) return;
      [browserWindow orderOut:nil];
    } else if ([action isEqualToString:@"show"] && browserWindow) {
      [browserWindow orderFrontRegardless];
    } else {
      return;
    }
    [NSFileManager.defaultManager removeItemAtPath:path error:nil];
  }];
}

__attribute__((constructor)) static void MerlinTestInBackground(void) {
  // Helpers (renderers, GPU, utilities) never see this library: the browser
  // removes the variable before it launches any of them.
  unsetenv("DYLD_INSERT_LIBRARIES");
  char** argv = *_NSGetArgv();
  for (int i = 1; i < *_NSGetArgc(); ++i) {
    if (strncmp(argv[i], "--type=", 7) == 0) return;
  }
  ProcessSerialNumber psn = {0, kCurrentProcess};
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  TransformProcessType(&psn, kProcessTransformToBackgroundApplication);
#pragma clang diagnostic pop
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationWillFinishLaunchingNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification* note) {
                [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
                NSString* sight = NSProcessInfo.processInfo.environment[@"MERLIN_E2E_PIP_SIGHT"];
                if (sight) WatchPictureInPictureWindow(sight);
                NSString* prompt_log =
                    NSProcessInfo.processInfo.environment[@"MERLIN_E2E_EXTERNAL_PROMPT_LOG"];
                if (prompt_log) {
                  [NSTimer scheduledTimerWithTimeInterval:0.1
                                                   repeats:YES
                                                     block:^(NSTimer* timer) {
                    for (NSWindow* window in NSApp.windows) {
                      if ([window.title hasPrefix:@"Open "] && [window.title hasSuffix:@"?"]) {
                        [window.title writeToFile:prompt_log
                                       atomically:YES
                                         encoding:NSUTF8StringEncoding
                                            error:nil];
                        [timer invalidate];
                        break;
                      }
                    }
                  }];
                }
              }];
}
