#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
// Forward declarations: cq_bring_to_front reveals a parked mini bar defined below.
static void *topHideWindow;
static void topHideReveal(void);
static void (*stateChanged)(bool, bool, bool);
static bool sleeping = false;
static NSMutableArray *observers;
/// Read the actual Codex bundle identity; its display name may be ChatGPT.
bool cq_codex_running(void) {
    return [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.openai.codex"].count > 0;
}
/// Emit only lifecycle and accessibility state; no account information crosses this bridge.
static void emitState(void) {
    if (stateChanged) stateChanged(cq_codex_running(), sleeping, NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency);
}
/// Subscribe once on the main thread; keep observers alive for the helper's lifetime.
void cq_observe(void (*callback)(bool, bool, bool)) {
    stateChanged = callback;
    observers = [NSMutableArray new];
    NSNotificationCenter *center = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[NSWorkspaceDidLaunchApplicationNotification, NSWorkspaceDidTerminateApplicationNotification, NSWorkspaceWillSleepNotification, NSWorkspaceDidWakeNotification, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification]) {
        id observer = [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            if ([note.name isEqualToString:NSWorkspaceDidLaunchApplicationNotification] || [note.name isEqualToString:NSWorkspaceDidTerminateApplicationNotification]) {
                NSRunningApplication *application = note.userInfo[NSWorkspaceApplicationKey];
                if (![application.bundleIdentifier isEqualToString:@"com.openai.codex"]) return;
            }
            if ([note.name isEqualToString:NSWorkspaceWillSleepNotification]) sleeping = true;
            if ([note.name isEqualToString:NSWorkspaceDidWakeNotification]) sleeping = false;
            emitState();
        }];
        [observers addObject:observer];
    }
    emitState();
}

/// A user-requested show activates the accessory app without changing its window level.
/// A parked mini bar is revealed first, so tray "show" and relaunch both recover it.
void cq_bring_to_front(void *pointer) {
    NSWindow *window = (__bridge NSWindow *)pointer;
    if (topHideWindow == pointer) topHideReveal();
    [NSApp activateIgnoringOtherApps:YES];
    [window makeKeyAndOrderFront:nil];
    [window orderFrontRegardless];
}

#pragma mark - Top-edge parking (compact mini bar)

// While parked, the mini bar sits behind the menu bar and a run-loop timer
// watches the global cursor; entering the parked zone slides it back down.
// A reveal cooldown breaks the hide->reveal->re-arm flicker loop: after the
// mini bar slides back, position events must not immediately park it again.
static void *topHideWindow = nil;
static double topHideRestoreY = 0;
static double topHideX = 0;
static double topHideW = 0;
static double topHideH = 0;
static NSTimer *topHideTimer = nil;
// A thin glowing strip shown at the parked card's top edge: the only visible
// trace of a hidden mini bar, so the parking spot can be found again later.
static NSWindow *topHideIndicator = nil;
// Full auto-hide cycle: parked (hidden, waiting for a fresh cursor entry) and
// revealed (visible until the cursor stays away for a few polls).
static BOOL topHideRevealed = NO;
static NSInteger topHideAwayTicks = 0;
// Edge-triggered reveal: the cursor must leave the zone before re-entering it
// again, otherwise a cursor resting inside the zone would park/reveal forever.
static BOOL topHideMouseAway = NO;

/// Animate window origin Y and alpha together. NSWindow's animator and even
/// setFrameOrigin are clamped below the menu bar for this window, so parking
/// relies on a short upward drift plus a fade to alpha 0 (never clamped).
static void animateWindow(NSWindow *window, double y, double alpha,
                          NSTimeInterval duration, BOOL ignoreMouseWhenDone) {
    double startY = window.frame.origin.y;
    double startA = window.alphaValue;
    NSDate *start = [NSDate date];
    NSTimer *timer = [NSTimer timerWithTimeInterval:(1.0 / 60.0) repeats:YES block:^(NSTimer *t) {
        double p = [[NSDate date] timeIntervalSinceDate:start] / duration;
        if (p >= 1.0) {
            p = 1.0;
            [t invalidate];
        }
        double ease = p < 0.5 ? 2 * p * p : 1 - pow(-2 * p + 2, 2) / 2;
        NSRect frame = window.frame;
        frame.origin.y = startY + (y - startY) * ease;
        [window setFrameOrigin:frame.origin];
        window.alphaValue = startA + (alpha - startA) * ease;
        if (p == 1.0 && ignoreMouseWhenDone) [window setIgnoresMouseEvents:YES];
    }];
    [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
}

/// Show or hide the 2.5pt teal strip pinned at the parked card's top edge.
/// Borderless, click-through, joins all spaces; multi-monitor aware because the
/// strip is placed from the card's own saved frame, not the main screen.
static void topHideIndicatorShow(BOOL show) {
    void (^apply)(void) = ^{
        if (!show) {
            if (topHideIndicator) {
                topHideIndicator.alphaValue = 0.0;
                [topHideIndicator orderOut:nil];
            }
            return;
        }
        NSRect stripFrame = NSMakeRect(topHideX, topHideRestoreY + topHideH, topHideW, 2.5);
        if (!topHideIndicator) {
            topHideIndicator = [[NSWindow alloc] initWithContentRect:stripFrame
                                                           styleMask:NSWindowStyleMaskBorderless
                                                             backing:NSBackingStoreBuffered
                                                               defer:NO];
            topHideIndicator.level = NSFloatingWindowLevel;
            topHideIndicator.opaque = NO;
            topHideIndicator.hasShadow = NO;
            topHideIndicator.ignoresMouseEvents = YES;
            topHideIndicator.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces;
            NSView *strip = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, topHideW, 2.5)];
            strip.wantsLayer = YES;
            strip.layer.backgroundColor =
                [NSColor colorWithRed:0.17 green:0.62 blue:0.60 alpha:0.6].CGColor;
            strip.layer.cornerRadius = 1.25;
            topHideIndicator.contentView = strip;
        } else {
            [topHideIndicator setFrame:stripFrame display:YES];
        }
        [topHideIndicator orderFrontRegardless];
        topHideIndicator.alphaValue = 1.0;
    };
    if ([NSThread isMainThread]) apply();
    else dispatch_async(dispatch_get_main_queue(), apply);
}

/// Show the parked mini bar at its pre-park position; the watcher stays armed
/// so the cursor leaving the bar parks it again (Dock-style auto-hide cycle).
static void topHideReveal(void) {
    void *pointer = topHideWindow;
    if (!pointer) return;
    topHideRevealed = YES;
    topHideAwayTicks = 0;
    topHideIndicatorShow(NO);
    NSWindow *window = (__bridge NSWindow *)pointer;
    double y = topHideRestoreY;
    void (^reveal)(void) = ^{
        [window setIgnoresMouseEvents:NO];
        animateWindow(window, y, 1.0, 0.3, NO);
    };
    if ([NSThread isMainThread]) reveal();
    else dispatch_async(dispatch_get_main_queue(), reveal);
}

/// Fade the revealed mini bar back out while staying armed for the next hover.
static void topHidePark(NSWindow *window) {
    topHideRevealed = NO;
    topHideAwayTicks = 0;
    topHideIndicatorShow(YES);
    // A park counts as "the cursor is where it is": re-showing requires the
    // cursor to leave the hot zone and come back, which kills any flicker loop.
    topHideMouseAway = NO;
    // Drift UP and fade out (bottom-left origin: larger y = higher on screen);
    // the position clamp would bounce any attempt to slide behind the menu bar.
    animateWindow(window, window.frame.origin.y + 16, 0.0, 0.35, YES);
}

/// Poll the cursor (NSEvent.mouseLocation needs no permission). Parked: reveal
/// on a fresh entry into the top hot zone. Revealed: park again once the cursor
/// stays away from the bar for ~0.6s (the Dock-style auto-hide cycle).
static void topHideCheck(void) {
    if (!topHideWindow) return;
    NSPoint mouse = [NSEvent mouseLocation];
    NSScreen *screen = NSScreen.mainScreen;
    double fromTop = CGRectGetMaxY(screen.frame) - mouse.y;
    if (!topHideRevealed) {
        BOOL inside =
            fromTop <= 30 && mouse.x >= topHideX - 48 && mouse.x <= topHideX + topHideW + 48;
        if (!inside) {
            topHideMouseAway = YES;
            return;
        }
        if (topHideMouseAway) {
            topHideMouseAway = NO;
            topHideReveal();
        }
        return;
    }
    NSWindow *window = (__bridge NSWindow *)topHideWindow;
    NSRect f = window.frame;
    BOOL overBar = mouse.x >= f.origin.x - 12 && mouse.x <= f.origin.x + f.size.width + 12 &&
                   mouse.y >= f.origin.y - 12 && mouse.y <= f.origin.y + f.size.height + 12;
    if (overBar) {
        topHideAwayTicks = 0;
        topHideMouseAway = NO;
        return;
    }
    // Away: require three consecutive polls (~0.6s) so brief excursions and
    // click-drag interactions never collapse the bar mid-use.
    if (++topHideAwayTicks >= 3) topHidePark(window);
}

/// Enter the auto-hide cycle at the current position; safe to call repeatedly
/// (calls while already parked or revealed are ignored).
void cq_arm_top_hide(void *pointer) {
    void (^arm)(void) = ^{
        if (topHideWindow) return; // already in the cycle: keep the original restore Y
        NSWindow *window = (__bridge NSWindow *)pointer;
        NSRect frame = window.frame;
        topHideWindow = pointer;
        topHideRestoreY = frame.origin.y;
        topHideX = frame.origin.x;
        topHideW = frame.size.width;
        topHideH = frame.size.height;
        topHideMouseAway = NO; // cursor is near the park spot right after arming
        topHidePark(window);
        if (!topHideTimer) {
            topHideTimer = [NSTimer timerWithTimeInterval:0.2 repeats:YES block:^(__unused NSTimer *t) {
                topHideCheck();
            }];
            [[NSRunLoop mainRunLoop] addTimer:topHideTimer forMode:NSRunLoopCommonModes];
        }
    };
    if ([NSThread isMainThread]) arm();
    else dispatch_async(dispatch_get_main_queue(), arm);
}

/// Stop watching the cursor without moving the window (mode changes, teardown).
void cq_disarm_top_hide(void) {
    void (^disarm)(void) = ^{
        topHideWindow = nil;
        topHideRevealed = NO;
        topHideAwayTicks = 0;
        topHideIndicatorShow(NO);
        [topHideTimer invalidate];
        topHideTimer = nil;
    };
    if ([NSThread isMainThread]) disarm();
    else dispatch_async(dispatch_get_main_queue(), disarm);
}
