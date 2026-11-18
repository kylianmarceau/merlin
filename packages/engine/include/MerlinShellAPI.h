#ifndef MERLIN_SHELL_API_H
#define MERLIN_SHELL_API_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

// Chromium calls the presentation host on its UI thread. create_root returns a
// retained NSView; the window must release it before destroying the native host.
// The host never creates an NSApplication, NSWindow, or a second event loop.
typedef struct MerlinShellAPI {
  uint32_t abi_version;
  uint32_t struct_size;
  void* (*create_root)(const char* window_id);
  void (*release_root)(void* root_nsview);
  void (*shutdown)(void);
  // Added within ABI 1: present when struct_size covers it. Starts the React
  // bridge and bundle load early, before the first window asks for a root.
  void (*prewarm)(void);
  // Added within ABI 1. Removes WebKit pages' data for Clear Browsing Data.
  // `json` is {"since": seconds since the epoch (0: all time), "types": any of
  // "cookies" (cookies and site data) and "cache", "site": a registrable
  // domain (optional; all time), "private": the private session's data, not
  // the normal store's}. `done` runs once on the UI thread, possibly before
  // this returns, with NULL or an error that is valid only during the call.
  void (*clear_webkit_data)(const char* json, void (*done)(const char* error, void* context), void* context);
  // Added within ABI 1. Reloads the shared React bridge: the bundle runs
  // again, and every window's root runs the app again with its window ID.
  // Pages stay with Chromium. The host also does this itself, a few times at
  // most, when JavaScript fails outside any window's error boundary.
  // `reason` is logged.
  void (*reload)(const char* reason);
} MerlinShellAPI;
typedef const MerlinShellAPI* (*MerlinShellGetAPIFn)(uint32_t abi_version);
const MerlinShellAPI* MerlinShellGetAPI(uint32_t abi_version);
#ifdef __cplusplus
}
#endif
#endif
