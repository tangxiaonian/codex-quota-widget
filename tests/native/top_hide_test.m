#import <AppKit/AppKit.h>
#import <assert.h>
#import <sys/resource.h>
// Compile the production module into the test translation unit so no test-only IPC is exposed.
#import "../../src-tauri/native/top_hide.m"
#import "../../src-tauri/native/workspace.m"

/// Advance real AppKit timers to catch stale animation completions after a mode change.
static void advance(double seconds) {
    [NSRunLoop.mainRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}
int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSRect area = NSScreen.mainScreen.visibleFrame;
        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(area.origin.x + 100, NSMaxY(area) - 104, 360, 104)
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        [window orderFront:nil];
        void *pointer = (__bridge void *)window;
        NSRect initial = window.frame;
        cq_arm_top_hide(pointer);
        assert(cursorTimer != nil);
        advance(0.3);
        assert(window.alphaValue == 0 && window.ignoresMouseEvents);
        assert(NSEqualRects(window.frame, initial));
        cq_disarm_top_hide();
        advance(0.4);
        assert(cursorTimer == nil && fadeTimer == nil);
        assert(window.alphaValue == 1 && !window.ignoresMouseEvents);
        assert(!indicator.isVisible);
        // Settings/expanded entered during the fade must stay interactive after its former completion time.
        cq_arm_top_hide(pointer);
        advance(0.06);
        cq_disarm_top_hide();
        advance(0.4);
        assert(window.alphaValue == 1 && !window.ignoresMouseEvents);
        // Explicit tray/second-instance show leaves the card visible even while the pointer is away.
        cq_arm_top_hide(pointer);
        advance(0.3);
        cq_bring_to_front(pointer);
        advance(0.8);
        assert(cursorTimer == nil && window.alphaValue == 1 && !window.ignoresMouseEvents);
        // A normal drag away from the top stops parking too.
        cq_arm_top_hide(pointer);
        [window setFrameOrigin:NSMakePoint(initial.origin.x, initial.origin.y - 200)];
        cq_arm_top_hide(pointer);
        assert(cursorTimer == nil && window.alphaValue == 1);
        if (getenv("CQ_WIDGET_BENCHMARK")) {
            [window setFrameOrigin:initial.origin];
            cq_arm_top_hide(pointer);
            advance(0.3);
            struct rusage before, after;
            getrusage(RUSAGE_SELF, &before);
            advance(3);
            getrusage(RUSAGE_SELF, &after);
            double cpu = (after.ru_utime.tv_sec - before.ru_utime.tv_sec) +
                (after.ru_utime.tv_usec - before.ru_utime.tv_usec) / 1e6 +
                (after.ru_stime.tv_sec - before.ru_stime.tv_sec) +
                (after.ru_stime.tv_usec - before.ru_stime.tv_usec) / 1e6;
            printf("parked AppKit harness: 3s mean CPU %.3f%%; max RSS %.2f MiB (not the complete Tauri process tree)\n",
                   cpu / 3 * 100, after.ru_maxrss / 1048576.0);
            cq_disarm_top_hide();
        }
        [window orderOut:nil];
        printf("native parking tests passed: mode exit, interrupted fade, explicit show, drag away\n");
    }
    return 0;
}
