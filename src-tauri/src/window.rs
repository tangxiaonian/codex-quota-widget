use serde::Serialize;
use std::sync::OnceLock;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

static RAIL_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

#[derive(Clone, Serialize)]
struct RailPointerEvent {
    inside: bool,
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
extern "C" {
    fn cq_bring_to_front(window: *mut std::ffi::c_void);
    fn cq_arm_top_hide(window: *mut std::ffi::c_void);
    fn cq_disarm_top_hide();
    fn cq_set_hide_from_capture(window: *mut std::ffi::c_void, hidden: bool);
    fn cq_set_window_appearance(window: *mut std::ffi::c_void, mode: i32);
    fn cq_set_window_chrome(window: *mut std::ffi::c_void, rectangular: bool);
    fn cq_resize_window_anchored(
        window: *mut std::ffi::c_void,
        delta_x: f64,
        delta_top_y: f64,
        width: f64,
        height: f64,
        min_width: f64,
        min_height: f64,
        resizable: bool,
    );
    fn cq_set_rail_pointer_monitor(
        window: *mut std::ffi::c_void,
        enabled: bool,
        callback: extern "C" fn(bool, f64, f64),
    );
}

#[cfg(target_os = "macos")]
extern "C" fn on_rail_pointer(inside: bool, x: f64, y: f64) {
    if let Some(app) = RAIL_APP.get() {
        let _ = app.emit("rail-pointer", RailPointerEvent { inside, x, y });
    }
}

#[tauri::command]
/// Atomically move and resize the window in one native frame so rail hover never flickers.
pub fn resize_window_anchored(
    window: tauri::WebviewWindow,
    delta_x: f64,
    delta_top_y: f64,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    resizable: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let pointer = window.ns_window().map_err(|e| e.to_string())?;
        unsafe {
            cq_resize_window_anchored(
                pointer,
                delta_x,
                delta_top_y,
                width,
                height,
                min_width,
                min_height,
                resizable,
            );
        }
    }
    Ok(())
}

#[tauri::command]
/// Toggle window-level rectangular vibrancy, shadow, and unfocused rail hover monitoring.
pub fn set_window_chrome(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    rectangular: bool,
) -> Result<(), String> {
    let _ = RAIL_APP.set(app);
    #[cfg(target_os = "macos")]
    {
        let pointer = window.ns_window().map_err(|e| e.to_string())?;
        unsafe {
            cq_set_window_chrome(pointer, rectangular);
            cq_set_rail_pointer_monitor(pointer, !rectangular, on_rail_pointer);
        }
    }
    Ok(())
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

/// Apply native window capture protection and vibrant appearance to the floating card.
pub fn apply_main_window_flags(app: &tauri::AppHandle, hide_from_capture: bool, theme: &str) {
    #[cfg(target_os = "macos")]
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(pointer) = window.ns_window() {
            let mode = match theme {
                "light" => 1,
                "dark" => 2,
                _ => 0,
            };
            unsafe {
                cq_set_hide_from_capture(pointer, hide_from_capture);
                cq_set_window_appearance(pointer, mode);
            }
        }
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

/// Open or focus the on-demand dashboard window (usage analytics + preferences).
/// Closing the window destroys its WebView so idle memory stays minimal.
pub fn open_dashboard(app: &tauri::AppHandle, tab: &str) -> Result<(), String> {
    let normalized = if tab == "settings" {
        "settings"
    } else {
        "usage"
    };
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("dashboard-tab", normalized);
        #[cfg(target_os = "macos")]
        if let Ok(pointer) = window.ns_window() {
            unsafe {
                cq_bring_to_front(pointer);
            }
        }
        return Ok(());
    }

    let url = format!("index.html?view=dashboard&tab={normalized}");
    let win = WebviewWindowBuilder::new(app, "dashboard", WebviewUrl::App(url.into()))
        .title("额度卡片 · 控制中心")
        .inner_size(780.0, 560.0)
        .min_inner_size(640.0, 460.0)
        .center()
        .resizable(true)
        .visible(true)
        .build()
        .map_err(|_| "无法打开控制中心窗口")?;
    let _ = win.set_focus();
    #[cfg(target_os = "macos")]
    if let Ok(pointer) = win.ns_window() {
        unsafe {
            cq_bring_to_front(pointer);
        }
    }
    Ok(())
}
