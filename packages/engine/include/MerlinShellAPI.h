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
} MerlinShellAPI;
typedef const MerlinShellAPI* (*MerlinShellGetAPIFn)(uint32_t abi_version);
const MerlinShellAPI* MerlinShellGetAPI(uint32_t abi_version);
#ifdef __cplusplus
}
#endif
#endif
