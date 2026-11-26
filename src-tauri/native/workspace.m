#import <AppKit/AppKit.h>
#import "window.h"
static void (*stateChanged)(bool, bool, bool);
static bool sleeping = false;
static NSMutableArray *observers;
static id railGlobalMonitor;
static id railLocalMonitor;
static __weak NSWindow *railTrackedWindow;
static __weak NSWindow *railPopoverWindow;
static void (*railPointerCallback)(int, double, double);
static int railLastTarget = 0;
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

/// Evaluate global pointer location against the rail and popover windows without stealing focus.
/// Target codes: 0 = outside both, 1 = inside rail strip, 2 = inside visible popover window.
static void handleRailPointer(void) {
    NSWindow *window = railTrackedWindow;
    if (!window || !railPointerCallback) return;
    if (NSEvent.pressedMouseButtons != 0) return;
    if (!window.isVisible) {
        if (railLastTarget != 0) {
            railLastTarget = 0;
            railPointerCallback(0, 0, 0);
        }
        return;
    }
    NSPoint mouse = NSEvent.mouseLocation;
    NSRect railFrame = window.frame;
    BOOL inRail = NSPointInRect(mouse, NSInsetRect(railFrame, -2, -2));
    if (inRail) {
        railLastTarget = 1;
        double x = mouse.x - railFrame.origin.x;
        double y = NSMaxY(railFrame) - mouse.y;
        railPointerCallback(1, x, y);
        return;
    }
    NSWindow *popover = railPopoverWindow;
    BOOL inPopover = popover && popover.isVisible && NSPointInRect(mouse, NSInsetRect(popover.frame, -2, -2));
    if (inPopover) {
        railLastTarget = 2;
        railPointerCallback(2, 0, 0);
        return;
    }
    if (railLastTarget != 0) {
        railLastTarget = 0;
        railPointerCallback(0, 0, 0);
    }
}

/// Start or stop zero-timer mouse tracking for the floating rail so hover works while unfocused.
void cq_set_rail_pointer_monitor(void *pointer, bool enabled, void (*callback)(int, double, double)) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (enabled && pointer && callback) {
            NSWindow *window = (__bridge NSWindow *)pointer;
            window.acceptsMouseMovedEvents = YES;
            // Keep existing monitors and target state intact across rail updates.
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
            railLastTarget = NSPointInRect(NSEvent.mouseLocation, NSInsetRect(window.frame, -2, -2)) ? 1 : 0;
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
        railLastTarget = 0;
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
        // Avoid redundant styleMask writes that force AppKit to revalidate window backing chrome.
        if (mask != window.styleMask) {
            window.styleMask = mask;
        }
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

/// Recursively toggle every NSVisualEffectView inside a view hierarchy.
static void setVisualEffectsHidden(NSView *view, BOOL hidden) {
    if ([view isKindOfClass:NSVisualEffectView.class]) {
        view.hidden = hidden;
    }
    for (NSView *sub in view.subviews) {
        setVisualEffectsHidden(sub, hidden);
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
        if (content) {
            setVisualEffectsHidden(content, !rectangular);
            if (!rectangular && content.layer) {
                content.layer.backgroundColor = NSColor.clearColor.CGColor;
            }
        }
        [window invalidateShadow];
    });
}

/// Configure the dedicated rail-popover window as a transparent borderless overlay tracked by the pointer monitor.
void cq_configure_rail_popover(void *popoverPtr, void *mainPtr) {
    if (!popoverPtr) return;
    NSWindow *popover = (__bridge NSWindow *)popoverPtr;
    NSWindow *mainWin = mainPtr ? (__bridge NSWindow *)mainPtr : nil;
    void (^apply)(void) = ^{
        railPopoverWindow = popover;
        popover.opaque = NO;
        popover.backgroundColor = NSColor.clearColor;
        popover.hasShadow = NO;
        popover.acceptsMouseMovedEvents = YES;
        if (mainWin) {
            popover.level = mainWin.level;
            popover.collectionBehavior = mainWin.collectionBehavior;
            popover.sharingType = mainWin.sharingType;
            popover.appearance = mainWin.appearance;
        }
        NSView *content = popover.contentView;
        if (content) {
            setVisualEffectsHidden(content, YES);
            if (content.layer) {
                content.layer.backgroundColor = NSColor.clearColor.CGColor;
            }
        }
        [popover invalidateShadow];
    };
    if ([NSThread isMainThread]) {
        apply();
    } else {
        dispatch_sync(dispatch_get_main_queue(), apply);
    }
}

/// Show the dedicated rail-popover window without stealing focus or activating the application.
void cq_show_rail_popover(void *popoverPtr, void *mainPtr) {
    if (!popoverPtr) return;
    NSWindow *popover = (__bridge NSWindow *)popoverPtr;
    NSWindow *mainWin = mainPtr ? (__bridge NSWindow *)mainPtr : nil;
    void (^apply)(void) = ^{
        railPopoverWindow = popover;
        if (mainWin) {
            popover.level = mainWin.level;
            popover.collectionBehavior = mainWin.collectionBehavior;
            popover.sharingType = mainWin.sharingType;
            popover.appearance = mainWin.appearance;
        }
        [popover orderFrontRegardless];
    };
    if ([NSThread isMainThread]) {
        apply();
    } else {
        dispatch_sync(dispatch_get_main_queue(), apply);
    }
}

/// Hide the dedicated rail-popover window without affecting the main rail strip window.
void cq_hide_rail_popover(void *popoverPtr) {
    if (!popoverPtr) return;
    NSWindow *popover = (__bridge NSWindow *)popoverPtr;
    void (^apply)(void) = ^{
        [popover orderOut:nil];
    };
    if ([NSThread isMainThread]) {
        apply();
    } else {
        dispatch_sync(dispatch_get_main_queue(), apply);
    }
}
