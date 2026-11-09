#import <Foundation/Foundation.h>

// The bearer is scoped to chatgpt.com. Never follow a login redirect or forward it to another host.
@interface CQSubscriptionRequest : NSObject <NSURLSessionTaskDelegate>
@end
@implementation CQSubscriptionRequest
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
 willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
 completionHandler:(void (^)(NSURLRequest *))completion {
    completion(nil);
}
@end

/// Fetch only the selected subscription endpoint, using macOS proxy and trust settings.
char *cq_subscription_json(const char *token, const char *workspace, bool detail) {
    @autoreleasepool {
        NSString *path = detail ? @"/backend-api/subscriptions" : @"/backend-api/accounts/check/v4-2023-04-27";
        NSURLComponents *url = [NSURLComponents componentsWithString:[@"https://chatgpt.com" stringByAppendingString:path]];
        NSString *offset = [NSString stringWithFormat:@"%ld", (long)(-NSTimeZone.localTimeZone.secondsFromGMT / 60)];
        url.queryItems = @[[NSURLQueryItem queryItemWithName:detail ? @"account_id" : @"timezone_offset_min"
                                                       value:detail ? [NSString stringWithUTF8String:workspace] : offset]];
        NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url.URL];
        [request setValue:[@"Bearer " stringByAppendingString:[NSString stringWithUTF8String:token]] forHTTPHeaderField:@"Authorization"];
        [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
        [request setValue:@"https://chatgpt.com/" forHTTPHeaderField:@"Referer"];
        [request setValue:path forHTTPHeaderField:@"x-openai-target-path"];
        [request setValue:path forHTTPHeaderField:@"x-openai-target-route"];
        NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
        config.timeoutIntervalForRequest = 12;
        config.timeoutIntervalForResource = 18;
        NSURLSession *session = [NSURLSession sessionWithConfiguration:config delegate:[CQSubscriptionRequest new] delegateQueue:nil];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block char *result = NULL;
        [[session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (!error && [(NSHTTPURLResponse *)response statusCode] == 200 && data.length) {
                NSString *body = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
                if (body.UTF8String) result = strdup(body.UTF8String);
            }
            dispatch_semaphore_signal(done);
        }] resume];
        dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
        [session finishTasksAndInvalidate];
        return result;
    }
}
