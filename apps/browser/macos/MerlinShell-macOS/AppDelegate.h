#import <AppKit/AppKit.h>
#import <React/RCTBridgeDelegate.h>

// Chromium owns the app delegate and event loop. This object is only the
// process-wide React runtime and does not participate in NSApplication startup.
@interface MerlinShellRuntime : NSObject <RCTBridgeDelegate>
- (NSView*)rootForWindow:(NSString*)windowID;
- (void)invalidate;
@end
