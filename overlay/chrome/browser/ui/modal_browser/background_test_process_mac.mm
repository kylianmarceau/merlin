// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//
// Test-only. Lets browser_tests run without taking over the developer's
// screen: with MODAL_TESTS_IN_BACKGROUND set, every browser_tests process
// (the launcher and each child) becomes a background application before
// AppKit starts (the same call Chrome's headless mode makes,
// chrome/browser/headless/headless_mode_platform_mac.mm) and its activation
// policy becomes "prohibited" once NSApp launches. It never becomes the
// frontmost app, so it cannot steal keyboard focus. Combine with
// --headless, which makes Chromium use a headless screen so windows are
// never shown. See scripts/run_browser_tests.sh.
//
// Linked only into browser_tests (patches/0003); does nothing unless the
// variable is set.

#ifdef UNSAFE_BUFFERS_BUILD
// argv comes from the OS as a C array; this test-only file reads it before
// base::CommandLine exists.
#pragma allow_unsafe_buffers
#endif

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <crt_externs.h>

#include <cstdlib>
#include <string_view>

namespace {

__attribute__((constructor)) void ModalBrowserTestsInBackground() {
  if (!std::getenv("MODAL_TESTS_IN_BACKGROUND")) {
    return;
  }
  // browser_tests re-launches itself for renderers, GPU and utilities
  // (--type=...). Those are sandboxed and must not touch the window server;
  // like Chrome's headless mode, only the browser process changes.
  char** argv = *_NSGetArgv();
  for (int i = 1; i < *_NSGetArgc(); ++i) {
    if (std::string_view(argv[i]).starts_with("--type=")) {
      return;
    }
  }
  ProcessSerialNumber psn = {0, kCurrentProcess};
  TransformProcessType(&psn, kProcessTransformToBackgroundApplication);
  // The call above can be undone when AppKit registers the app, so also
  // forbid activation once NSApp exists, before it would activate itself.
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationWillFinishLaunchingNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                [NSApp setActivationPolicy:
                           NSApplicationActivationPolicyProhibited];
              }];
}

}  // namespace
