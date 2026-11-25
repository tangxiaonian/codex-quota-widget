#import <Foundation/Foundation.h>
#import "quota_http.h"
/// Query a fixed WorkBuddy billing endpoint with the current local identity and system proxy.
char *cq_workbuddy_json(const char *credentials, int kind, const char *body) {
    @autoreleasepool {
        NSData *input = [[NSString stringWithUTF8String:credentials] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *auth = [NSJSONSerialization JSONObjectWithData:input options:0 error:nil];
        NSArray *routes = @[@"get-user-resource-summary", @"get-user-resource-paid-packages", @"get-user-resource-free-packages"];
        if (kind < 0 || (NSUInteger)kind >= routes.count) return NULL;
        NSString *url = [@"https://copilot.tencent.com/billing/meter/" stringByAppendingString:routes[kind]];
        NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:url]];
        req.HTTPMethod = @"POST";
        req.HTTPBody = [[NSString stringWithUTF8String:body] dataUsingEncoding:NSUTF8StringEncoding];
        [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        [req setValue:@"application/json" forHTTPHeaderField:@"Accept"];
        [req setValue:@"zh" forHTTPHeaderField:@"Accept-Language"];
        [req setValue:@"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" forHTTPHeaderField:@"User-Agent"];
        [req setValue:[@"Bearer " stringByAppendingString:auth[@"token"]] forHTTPHeaderField:@"Authorization"];
        for (NSArray *pair in @[@[@"uid",@"X-User-Id"], @[@"enterprise",@"X-Enterprise-Id"], @[@"enterprise",@"X-Tenant-Id"], @[@"domain",@"X-Domain"]]) {
            NSString *value = auth[pair[0]];
            if (value.length) [req setValue:value forHTTPHeaderField:pair[1]];
        }
        req.timeoutInterval = 15;
        NSURLSession *client = cq_quota_http_session();
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block char *result = NULL;
        [[client dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            if (!error) {
                NSInteger status = [(NSHTTPURLResponse *)response statusCode];
                NSString *json = status == 200
                    ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
                    : [NSString stringWithFormat:@"{\"httpStatus\":%ld}", (long)status];
                if (json.UTF8String) result = strdup(json.UTF8String);
            }
            dispatch_semaphore_signal(done);
        }] resume];
        dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
        return result;
    }
}
