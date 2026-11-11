#import "MerlinEngineBridge.h"
#include "MerlinEngineAPI.h"
#include <dlfcn.h>
#include <map>

namespace {
const MerlinEngineAPI* API() {
  auto get = reinterpret_cast<MerlinEngineGetAPIFn>(dlsym(RTLD_DEFAULT, "MerlinEngineGetAPI"));
  const auto* api = get ? get(1) : nullptr;
  return api && api->abi_version == 1 && api->struct_size >= sizeof(MerlinEngineAPI) &&
      api->call && api->release_string && api->subscribe && api->unsubscribe &&
      api->attach_page && api->detach_page ? api : nullptr;
}
NSMutableDictionary<NSNumber*, id>* Listeners() {
  static NSMutableDictionary* listeners = [NSMutableDictionary new];
  return listeners;
}
void OnEvent(const char* json, void* context) {
  NSCAssert([NSThread isMainThread], @"Engine events must use the UI thread");
  auto listener = (__bridge void (^)(NSString*))context;
  listener([NSString stringWithUTF8String:json]);
}
}
@implementation MerlinEngineBridge
+ (NSString*)callWindow:(NSString*)window method:(NSString*)method arguments:(NSString*)arguments {
  NSAssert([NSThread isMainThread], @"Engine calls must use the UI thread");
  const auto* api = API();
  if (!api) return @"{\"ok\":false,\"error\":\"The Chromium framework does not export MerlinEngine ABI 1\"}";
  char* json = api->call(window.UTF8String, method.UTF8String, arguments.UTF8String);
  if (!json) return @"{\"ok\":false,\"error\":\"The browser engine returned no response\"}";
  NSString* result = [NSString stringWithUTF8String:json];
  api->release_string(json);
  return result ?: @"{\"ok\":false,\"error\":\"Invalid engine response encoding\"}";
}
+ (uint64_t)subscribe:(void (^)(NSString*))listener {
  NSAssert([NSThread isMainThread], @"Subscribe on UI thread");
  const auto* api = API();
  if (!api) return 0;
  auto block = [listener copy];
  uint64_t token = api->subscribe(OnEvent, (__bridge void*)block);
  if (token) Listeners()[@(token)] = block;
  return token;
}
+ (void)unsubscribe:(uint64_t)token {
  NSAssert([NSThread isMainThread], @"Unsubscribe on UI thread");
  if (const auto* api = API(); api && token) api->unsubscribe(token);
  [Listeners() removeObjectForKey:@(token)];
}
+ (NSView*)attachWindow:(NSString*)window tab:(NSString*)tab parent:(NSView*)parent {
  NSAssert([NSThread isMainThread], @"Attach on UI thread");
  const auto* api = API();
  return api ? (__bridge NSView*)api->attach_page(window.UTF8String, tab.UTF8String, (__bridge void*)parent) : nil;
}
+ (void)detachWindow:(NSString*)window tab:(NSString*)tab parent:(NSView*)parent {
  NSAssert([NSThread isMainThread], @"Detach on UI thread");
  if (const auto* api = API()) api->detach_page(window.UTF8String, tab.UTF8String, (__bridge void*)parent);
}
@end
