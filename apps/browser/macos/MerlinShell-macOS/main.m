#import <Foundation/Foundation.h>
#import <MerlinEngine/MerlinEngineAPI.h>
#import <MerlinEngine/MerlinShellAPI.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern int MerlinRunUpdateInstaller(int pid, const char* stage, const char* current, const char* version);

// ChromeMain creates BrowserCrApplication, installs Chromium's app delegate,
// and runs its UI message loop. Starting NSApplicationMain here would give
// React Native a competing application lifecycle and break Chromium helpers.
int main(int argc, const char* argv[]) {
  @autoreleasepool {
    if (argc == 6 && !strcmp(argv[1], "--merlin-install-update"))
      return MerlinRunUpdateInstaller(atoi(argv[2]), argv[3], argv[4], argv[5]);

    NSString* path = [NSBundle.mainBundle.privateFrameworksPath
        stringByAppendingPathComponent:@"Merlin Framework.framework/Merlin Framework"];
    void* framework = dlopen(path.fileSystemRepresentation, RTLD_NOW | RTLD_GLOBAL);
    if (!framework) {
      fprintf(stderr, "Merlin: cannot load the packaged Chromium framework: %s\n", dlerror());
      return 78;
    }
    int (*chromeMain)(int, const char**) = dlsym(framework, "ChromeMain");
    MerlinEngineGetAPIFn getEngine = dlsym(framework, "MerlinEngineGetAPI");
    const MerlinEngineAPI* engine = getEngine ? getEngine(1) : NULL;
    if (!chromeMain || !engine || engine->abi_version != 1 || engine->struct_size < sizeof(MerlinEngineAPI)) {
      fprintf(stderr, "Merlin: the packaged Chromium framework does not support the React shell ABI. Rebuild it with the shell patches.\n");
      return 78;
    }
    for (int i = 1; i < argc; ++i) {
      if (!strcmp(argv[i], "--merlin-check-framework")) {
        puts("Merlin Chromium and React shell ABI 1 available");
        return 0;
      }
    }
    const char** arguments = calloc((size_t)argc + 3, sizeof(char*));
    if (!arguments) return 71;
    for (int i = 0; i < argc; ++i) arguments[i] = argv[i];
    int count = argc;
    arguments[count++] = "--merlin-react-shell";
    // Chromium's stack sampling profiler only feeds usage metrics, which
    // Merlin doesn't send: without it the browser runs no sampling thread at
    // startup and periodically after, and starts none in its helpers.
    // --modal-browser-upstream-defaults keeps Chromium's own choice.
    BOOL upstream = NO;
    for (int i = 1; i < argc; ++i)
      if (!strcmp(argv[i], "--modal-browser-upstream-defaults")) upstream = YES;
    if (!upstream) arguments[count++] = "--disable-stack-profiler";
    int result = chromeMain(count, arguments);
    MerlinShellGetAPI(1)->shutdown();
    free(arguments);
    // Chromium may retain thread-local framework data until process exit.
    // Do not dlclose its image after ChromeMain returns.
    return result;
  }
}
