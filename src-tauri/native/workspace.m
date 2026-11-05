#import <AppKit/AppKit.h>
#import "window.h"
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
    cq_disarm_top_hide();
    [NSApp activateIgnoringOtherApps:YES];
    [window makeKeyAndOrderFront:nil];
    [window orderFrontRegardless];
}
