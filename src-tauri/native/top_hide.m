#import "window.h"

// Only this module owns parking state. Animations never move the window, so
// persistence and drag-end handling see actual user positions, including y < 0.
static NSWindow *parkedWindow;
static NSWindow *indicator;
static NSTimer *cursorTimer;
static NSTimer *fadeTimer;
static BOOL revealed;
static BOOL mouseAway;
static NSInteger awayTicks;

/// Fade without generating window-move events; replacing a fade cancels its completion.
static void fade(NSWindow *window, CGFloat target) {
    [fadeTimer invalidate];
    CGFloat startAlpha = window.alphaValue;
    CFTimeInterval start = NSProcessInfo.processInfo.systemUptime;
    fadeTimer = [NSTimer timerWithTimeInterval:1.0 / 60.0 repeats:YES block:^(NSTimer *timer) {
        double p = MIN(1.0, (NSProcessInfo.processInfo.systemUptime - start) / 0.25);
        window.alphaValue = startAlpha + (target - startAlpha) * p;
        if (p >= 1.0) {
            [timer invalidate];
            window.ignoresMouseEvents = target == 0;
        }
    }];
    [[NSRunLoop mainRunLoop] addTimer:fadeTimer forMode:NSRunLoopCommonModes];
}

/// Place the discoverable strip on the parked window's own screen, below its menu bar.
static void showIndicator(void) {
    NSRect frame = parkedWindow.frame;
    NSScreen *screen = parkedWindow.screen;
    if (!screen) return;
    NSRect stripFrame = NSMakeRect(frame.origin.x, NSMaxY(screen.visibleFrame) - 2.5, frame.size.width, 2.5);
    if (!indicator) {
        indicator = [[NSWindow alloc] initWithContentRect:stripFrame styleMask:NSWindowStyleMaskBorderless
                                                backing:NSBackingStoreBuffered defer:NO];
        indicator.level = NSFloatingWindowLevel;
        indicator.opaque = NO;
        indicator.hasShadow = NO;
        indicator.ignoresMouseEvents = YES;
        indicator.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces;
        indicator.contentView.wantsLayer = YES;
        indicator.contentView.layer.backgroundColor =
            [NSColor colorWithRed:0.17 green:0.62 blue:0.60 alpha:0.6].CGColor;
        indicator.contentView.layer.cornerRadius = 1.25;
    }
    [indicator setFrame:stripFrame display:YES];
    [indicator orderFrontRegardless];
}

/// Reveal on a fresh hover entry; keep the watcher until leaving compact mode or explicitly showing.
static void reveal(void) {
    revealed = YES;
    awayTicks = 0;
    [indicator orderOut:nil];
    parkedWindow.ignoresMouseEvents = NO;
    fade(parkedWindow, 1);
}

/// Park at the existing position, leaving only the indicator as the hover target.
static void park(void) {
    revealed = NO;
    awayTicks = 0;
    mouseAway = NO;
    showIndicator();
    fade(parkedWindow, 0);
}

/// Check the owning screen's hot zone; stop work when lifecycle or tray hides the window.
static void checkCursor(void) {
    if (!parkedWindow.isVisible) { cq_disarm_top_hide(); return; }
    NSPoint mouse = NSEvent.mouseLocation;
    NSRect frame = parkedWindow.frame;
    NSScreen *screen = parkedWindow.screen;
    if (!screen) { cq_disarm_top_hide(); return; }
    if (!revealed) {
        // The work area accounts for menu bars on both primary and secondary displays.
        NSRect zone = NSMakeRect(frame.origin.x - 48, NSMaxY(screen.visibleFrame) - 30,
                                 frame.size.width + 96, NSMaxY(screen.frame) - NSMaxY(screen.visibleFrame) + 30);
        BOOL inside = NSPointInRect(mouse, zone) && NSPointInRect(mouse, screen.frame);
        if (!inside) mouseAway = YES;
        else if (mouseAway) { mouseAway = NO; reveal(); }
        return;
    }
    if (NSPointInRect(mouse, NSInsetRect(frame, -12, -12)) || NSEvent.pressedMouseButtons != 0) {
        awayTicks = 0;
        return;
    }
    if (++awayTicks >= 3) park();
}

/// Check drag-end geometry natively, without mixing global physical pixels and logical screen points.
void cq_arm_top_hide(void *pointer) {
    NSCAssert(NSThread.isMainThread, @"Window operations must run on the main thread");
    NSWindow *window = (__bridge NSWindow *)pointer;
    NSScreen *screen = window.screen;
    if (!screen || !window.isVisible) return;
    double fromTop = NSMaxY(screen.visibleFrame) - NSMaxY(window.frame);
    if (fromTop < -1 || fromTop > 60) { cq_disarm_top_hide(); return; }
    if (parkedWindow) return;
    parkedWindow = window;
    park();
    cursorTimer = [NSTimer timerWithTimeInterval:0.2 repeats:YES block:^(__unused NSTimer *timer) {
        checkCursor();
    }];
    cursorTimer.tolerance = 0.04;
    [[NSRunLoop mainRunLoop] addTimer:cursorTimer forMode:NSRunLoopCommonModes];
}

/// End parking completely: cancel both timers and restore visibility and mouse input immediately.
void cq_disarm_top_hide(void) {
    NSCAssert(NSThread.isMainThread, @"Window operations must run on the main thread");
    [cursorTimer invalidate]; cursorTimer = nil;
    [fadeTimer invalidate]; fadeTimer = nil;
    [indicator orderOut:nil];
    parkedWindow.alphaValue = 1;
    parkedWindow.ignoresMouseEvents = NO;
    parkedWindow = nil;
    revealed = NO;
    awayTicks = 0;
}
