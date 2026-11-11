#ifndef MERLIN_ENGINE_API_H
#define MERLIN_ENGINE_API_H

#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

// The framework owns browser state and WebContents. The shell owns presentation.
// All calls run on the Chromium UI thread. Returned JSON must be freed through
// release_string; views remain engine-owned until detached. No C++ ABI crosses.
typedef void (*MerlinEventCallback)(const char* json, void* context);
typedef struct MerlinEngineAPI {
  uint32_t abi_version;
  uint32_t struct_size;
  char* (*call)(const char* window, const char* method, const char* json);
  void (*release_string)(char* json);
  uint64_t (*subscribe)(MerlinEventCallback callback, void* context);
  void (*unsubscribe)(uint64_t subscription);
  void* (*attach_page)(const char* window, const char* tab, void* parent_nsview);
  void (*detach_page)(const char* window, const char* tab, void* parent_nsview);
} MerlinEngineAPI;

typedef const MerlinEngineAPI* (*MerlinEngineGetAPIFn)(uint32_t abi_version);
// Exported by Merlin's Chromium framework, never supplied by page content.
const MerlinEngineAPI* MerlinEngineGetAPI(uint32_t abi_version);

#ifdef __cplusplus
}
#endif
#endif
