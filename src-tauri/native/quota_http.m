#import "quota_http.h"

@interface CQQuotaHTTPDelegate : NSObject <NSURLSessionTaskDelegate>
@end
@implementation CQQuotaHTTPDelegate
/// Keep each bearer on its fixed endpoint instead of forwarding it through redirects.
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
 willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *))completion {
    completion(nil);
}
@end

/// Repeated session creation leaks proxy XPC objects on the tested macOS build.
/// Keep one connection pool while every caller supplies its current authorization headers.
NSURLSession *cq_quota_http_session(void) {
    static NSURLSession *session;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.timeoutIntervalForRequest = 15;
        config.timeoutIntervalForResource = 20;
        config.HTTPShouldSetCookies = NO;
        config.URLCache = nil;
        config.URLCredentialStorage = nil;
        session = [NSURLSession sessionWithConfiguration:config delegate:[CQQuotaHTTPDelegate new] delegateQueue:nil];
    });
    return session;
}
