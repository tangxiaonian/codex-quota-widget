#import <AppKit/AppKit.h>
#import "window.h"
static void (*stateChanged)(bool, bool, bool);
static bool sleeping = false;
static NSMutableArray *observers;
static id railGlobalMonitor;
static id railLocalMonitor;
static __weak NSWindow *railTrackedWindow;
static void (*railPointerCallback)(bool, double, double);
static bool railLastInside = false;
/// Read the actual Codex bundle identity; its display name may be ChatGPT.
bool cq_codex_running(void) {
    return [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.openai.codex"].count > 0;
}
/// WorkBuddy lifecycle is independent of Codex and is observed by bundle identity.
bool cq_workbuddy_running(void) {
    return [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.tencent.workbuddy.mac"].count > 0;
}
/// Detect the desktop app without inspecting the CLI account or its credentials.
bool cq_antigravity_running(void) {
    return [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.google.antigravity"].count > 0;
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
                if (![application.bundleIdentifier isEqualToString:@"com.openai.codex"] && ![application.bundleIdentifier isEqualToString:@"com.tencent.workbuddy.mac"] && ![application.bundleIdentifier isEqualToString:@"com.google.antigravity"]) return;
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
    cq_disarm_top_hide();
    [NSApp activateIgnoringOtherApps:YES];
    [window makeKeyAndOrderFront:nil];
    [window orderFrontRegardless];
}

/// Request macOS window-capture tools to exclude the floating card when opted in.
void cq_set_hide_from_capture(void *pointer, bool hidden) {
    if (!pointer) return;
    NSWindow *window = (__bridge NSWindow *)pointer;
    dispatch_async(dispatch_get_main_queue(), ^{
        window.sharingType = hidden ? NSWindowSharingNone : NSWindowSharingReadOnly;
    });
}

/// Align native vibrancy material with the chosen theme: 0=system, 1=light, 2=dark.
void cq_set_window_appearance(void *pointer, int mode) {
    if (!pointer) return;
    NSWindow *window = (__bridge NSWindow *)pointer;
    dispatch_async(dispatch_get_main_queue(), ^{
        if (mode == 1) {
            window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameVibrantLight];
        } else if (mode == 2) {
            window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameVibrantDark];
        } else {
            window.appearance = nil;
        }
    });
}

/// Evaluate global pointer location against the rail window without stealing focus.
static void handleRailPointer(void) {
    NSWindow *window = railTrackedWindow;
    if (!window || !railPointerCallback) return;
    if (NSEvent.pressedMouseButtons != 0) return;
    if (!window.isVisible) {
        if (railLastInside) {
            railLastInside = false;
            railPointerCallback(false, 0, 0);
        }
        return;
    }
    NSPoint mouse = NSEvent.mouseLocation;
    NSRect frame = window.frame;
    BOOL inside = NSPointInRect(mouse, NSInsetRect(frame, -4, -4));
    if (inside) {
        railLastInside = true;
        double x = mouse.x - frame.origin.x;
        double y = NSMaxY(frame) - mouse.y;
        railPointerCallback(true, x, y);
    } else if (railLastInside) {
        railLastInside = false;
        railPointerCallback(false, 0, 0);
    }
}

/// Start or stop zero-timer mouse tracking for the floating rail so hover works while unfocused.
void cq_set_rail_pointer_monitor(void *pointer, bool enabled, void (*callback)(bool, double, double)) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (enabled && pointer && callback) {
            NSWindow *window = (__bridge NSWindow *)pointer;
            window.acceptsMouseMovedEvents = YES;
            // Keep existing monitors and inside-state intact across rail <-> railHover resizes.
            if (railGlobalMonitor && railTrackedWindow == window) {
                railPointerCallback = callback;
                return;
            }
            if (railGlobalMonitor) {
                [NSEvent removeMonitor:railGlobalMonitor];
                railGlobalMonitor = nil;
            }
            if (railLocalMonitor) {
                [NSEvent removeMonitor:railLocalMonitor];
                railLocalMonitor = nil;
            }
            railTrackedWindow = window;
            railPointerCallback = callback;
            railLastInside = NSPointInRect(NSEvent.mouseLocation, NSInsetRect(window.frame, -4, -4));
            railGlobalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskMouseMoved
                                                                       handler:^(__unused NSEvent *event) {
                handleRailPointer();
            }];
            railLocalMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved
                                                                     handler:^NSEvent *(NSEvent *event) {
                handleRailPointer();
                return event;
            }];
            return;
        }
        if (railGlobalMonitor) {
            [NSEvent removeMonitor:railGlobalMonitor];
            railGlobalMonitor = nil;
        }
        if (railLocalMonitor) {
            [NSEvent removeMonitor:railLocalMonitor];
            railLocalMonitor = nil;
        }
        railLastInside = false;
        railTrackedWindow = nil;
        railPointerCallback = NULL;
    });
}

/// Atomically update window size and position in one AppKit transaction to eliminate hover flicker.
void cq_resize_window_anchored(void *pointer, double deltaX, double deltaTopY, double width, double height, double minWidth, double minHeight, bool resizable) {
    if (!pointer) return;
    NSWindow *window = (__bridge NSWindow *)pointer;
    void (^apply)(void) = ^{
        window.minSize = NSMakeSize(minWidth, minHeight);
        NSWindowStyleMask mask = window.styleMask;
        if (resizable) {
            mask |= NSWindowStyleMaskResizable;
        } else {
            mask &= ~NSWindowStyleMaskResizable;
        }
        window.styleMask = mask;
        NSRect cur = window.frame;
        CGFloat newTop = NSMaxY(cur) - deltaTopY;
        CGFloat newBottom = newTop - height;
        CGFloat newX = cur.origin.x + deltaX;
        NSRect target = NSMakeRect(round(newX), round(newBottom), round(width), round(height));
        [window setFrame:target display:YES animate:NO];
    };
    if ([NSThread isMainThread]) {
        apply();
    } else {
        dispatch_sync(dispatch_get_main_queue(), apply);
    }
}

/// Toggle Tauri's rectangular window-level NSVisualEffectView and drop shadow.
/// Rail modes render independent rounded cards on a fully transparent canvas without rectangular chrome.
void cq_set_window_chrome(void *pointer, bool rectangular) {
    if (!pointer) return;
    NSWindow *window = (__bridge NSWindow *)pointer;
    dispatch_async(dispatch_get_main_queue(), ^{
        window.opaque = NO;
        window.backgroundColor = NSColor.clearColor;
        window.hasShadow = rectangular;
        NSView *content = window.contentView;
        for (NSView *sub in content.subviews) {
            if ([sub isKindOfClass:NSVisualEffectView.class]) {
                sub.hidden = !rectangular;
            }
        }
        [window invalidateShadow];
    });
}
