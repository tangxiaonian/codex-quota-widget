use tauri::Manager;

#[cfg(target_os = "macos")]
extern "C" {
    fn cq_bring_to_front(window: *mut std::ffi::c_void);
    fn cq_arm_top_hide(window: *mut std::ffi::c_void);
    fn cq_disarm_top_hide();
}

#[tauri::command]
/// Compact drag-end entry; AppKit evaluates proximity on the window's own display.
pub fn arm_top_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let pointer = window.ns_window().map_err(|e| e.to_string())?;
        unsafe { cq_arm_top_hide(pointer) };
    }
    Ok(())
}
#[tauri::command]
/// Stop parking, cancel in-flight fades and restore both visibility and pointer input.
pub fn disarm_top_hide() {
    #[cfg(target_os = "macos")]
    unsafe {
        cq_disarm_top_hide();
    }
}

/// Tray hiding also removes the parking indicator and cursor timer.
pub fn hide_card(window: &tauri::WebviewWindow) {
    disarm_top_hide();
    let _ = window.hide();
}

/// Explicit show ends auto-hide and activates the card without changing the user's pin preference.
pub fn show_card(app: &tauri::AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            #[cfg(target_os = "macos")]
            if let Ok(pointer) = window.ns_window() {
                unsafe {
                    cq_bring_to_front(pointer);
                }
            }
        }
    });
}
