#import <Foundation/Foundation.h>
#import <Security/Security.h>

@interface CQAntigravityLoopbackDelegate : NSObject <NSURLSessionDelegate, NSURLSessionTaskDelegate>
@end

@implementation CQAntigravityLoopbackDelegate
/// Never follow redirects from the local language server so the CSRF token cannot leave 127.0.0.1.
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
 willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *))completion {
    completion(nil);
}

/// Trust the local language server's self-signed certificate strictly on 127.0.0.1.
- (void)URLSession:(NSURLSession *)session
didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge
 completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completion {
    NSURLProtectionSpace *space = challenge.protectionSpace;
    if ([space.authenticationMethod isEqualToString:NSURLAuthenticationMethodServerTrust] &&
        [space.host isEqualToString:@"127.0.0.1"] &&
        space.serverTrust != NULL) {
        completion(NSURLSessionAuthChallengeUseCredential, [NSURLCredential credentialForTrust:space.serverTrust]);
        return;
    }
    completion(NSURLSessionAuthChallengePerformDefaultHandling, nil);
}
@end

/// Reuse one proxy-free ephemeral session for loopback RPCs to avoid XPC proxy leaks and VPN routing.
static NSURLSession *antigravityLoopbackSession(void) {
    static NSURLSession *session;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.timeoutIntervalForRequest = 6;
        config.timeoutIntervalForResource = 10;
        config.HTTPShouldSetCookies = NO;
        config.URLCache = nil;
        config.URLCredentialStorage = nil;
        config.connectionProxyDictionary = @{};
        session = [NSURLSession sessionWithConfiguration:config
                                                delegate:[CQAntigravityLoopbackDelegate new]
                                           delegateQueue:nil];
    });
    return session;
}

/// Post an empty JSON body to a fixed Antigravity language-server RPC on loopback HTTPS.
char *cq_antigravity_local_post(int port, int route, const char *csrfToken, int *status) {
    @autoreleasepool {
        static NSArray<NSString *> *paths;
        static dispatch_once_t once;
        dispatch_once(&once, ^{
            paths = @[
                @"/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary",
                @"/exa.language_server_pb.LanguageServerService/GetUserStatus"
            ];
        });
        if (status) { *status = 0; }
        if (port <= 0 || port > 65535 || route < 0 || (NSUInteger)route >= paths.count || !csrfToken || csrfToken[0] == '\0') {
            return NULL;
        }
        NSString *urlText = [NSString stringWithFormat:@"https://127.0.0.1:%d%@", port, paths[route]];
        NSURL *url = [NSURL URLWithString:urlText];
        if (!url) { return NULL; }
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
        request.HTTPMethod = @"POST";
        request.HTTPBody = [NSData dataWithBytes:"{}" length:2];
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        [request setValue:[NSString stringWithUTF8String:csrfToken] forHTTPHeaderField:@"x-codeium-csrf-token"];

        __block NSData *result = nil;
        __block int httpStatus = 0;
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        [[antigravityLoopbackSession() dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (!error && [response isKindOfClass:NSHTTPURLResponse.class]) {
                httpStatus = (int)[(NSHTTPURLResponse *)response statusCode];
                if (data.length <= 1024 * 1024) { result = data; }
            }
            dispatch_semaphore_signal(done);
        }] resume];
        dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
        if (status) { *status = httpStatus; }
        NSString *json = [[NSString alloc] initWithData:result ?: [NSData data] encoding:NSUTF8StringEncoding];
        return json.length ? strdup(json.UTF8String) : NULL;
    }
}
