#import <AppKit/AppKit.h>
#import <React/RCTBridgeDelegate.h>

// Chromium owns the app delegate and event loop. This object is only the
// process-wide React runtime and does not participate in NSApplication startup.
@interface MerlinShellRuntime : NSObject <RCTBridgeDelegate>
- (NSView*)rootForWindow:(NSString*)windowID;
// Reloads the shared bridge; every window's root runs the app again.
- (void)reload:(NSString*)reason;
// After a JavaScript failure no error boundary caught: reloads, a few times a
// minute at most.
- (void)recoverFrom:(NSString*)failure;
- (void)invalidate;
@end
