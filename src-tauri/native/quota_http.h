#import <Foundation/Foundation.h>
/// Reuse one read-only session for quota queries; request-specific identity remains in each request.
NSURLSession *cq_quota_http_session(void);
