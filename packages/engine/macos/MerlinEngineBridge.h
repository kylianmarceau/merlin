#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN
@interface MerlinEngineBridge : NSObject
+ (NSString*)callWindow:(NSString*)window method:(NSString*)method arguments:(NSString*)arguments;
+ (uint64_t)subscribe:(void (^)(NSString*))listener;
+ (void)unsubscribe:(uint64_t)token;
+ (nullable NSView*)attachWindow:(NSString*)window tab:(NSString*)tab parent:(NSView*)parent;
+ (void)detachWindow:(NSString*)window tab:(NSString*)tab parent:(NSView*)parent;
@end
NS_ASSUME_NONNULL_END
