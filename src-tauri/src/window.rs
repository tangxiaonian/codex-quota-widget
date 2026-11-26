use serde::Serialize;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static RAIL_APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static RAIL_POPOVER_STATE: Mutex<Option<Value>> = Mutex::new(None);
static RAIL_POPOVER_OPEN_ID: AtomicU64 = AtomicU64::new(0);
const RAIL_POPOVER_LABEL: &str = "rail-popover";

#[derive(Clone, Serialize)]
struct RailPointerEvent {
    inside: bool,
    target: &'static str,
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
        callback: extern "C" fn(i32, f64, f64),
    );
    fn cq_configure_rail_popover(popover: *mut std::ffi::c_void, main: *mut std::ffi::c_void);
    fn cq_show_rail_popover(popover: *mut std::ffi::c_void, main: *mut std::ffi::c_void);
    fn cq_hide_rail_popover(popover: *mut std::ffi::c_void);
}

#[cfg(target_os = "macos")]
extern "C" fn on_rail_pointer(target: i32, x: f64, y: f64) {
    if let Some(app) = RAIL_APP.get() {
        let label = match target {
            1 => "rail",
            2 => "popover",
            _ => "none",
        };
        let _ = app.emit_to(
            "main",
            "rail-pointer",
            RailPointerEvent {
                inside: target != 0,
                target: label,
                x,
                y,
            },
        );
    }
}

/// Lazily create and configure the dedicated transparent hover-popover window so the rail strip never resizes.
fn ensure_rail_popover_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(RAIL_POPOVER_LABEL) {
        return Ok(existing);
    }
    let popover = WebviewWindowBuilder::new(
        app,
        RAIL_POPOVER_LABEL,
        WebviewUrl::App("index.html?view=rail-popover".into()),
    )
    .title("额度详情")
    .inner_size(324.0, 296.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .build()
    .map_err(|_| "无法创建侧边详情悬浮窗".to_string())?;
    #[cfg(target_os = "macos")]
    if let Ok(pop_ptr) = popover.ns_window() {
        let main_ptr = app
            .get_webview_window("main")
            .and_then(|w| w.ns_window().ok())
            .unwrap_or(std::ptr::null_mut());
        unsafe {
            cq_configure_rail_popover(pop_ptr, main_ptr);
        }
    }
    Ok(popover)
}

/// Hide the dedicated rail-popover window and clear its DOM state so the next open never flashes stale pixels.
pub fn hide_rail_popover_window(app: &tauri::AppHandle) {
    RAIL_POPOVER_OPEN_ID.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut slot) = RAIL_POPOVER_STATE.lock() {
        *slot = None;
    }
    if let Some(popover) = app.get_webview_window(RAIL_POPOVER_LABEL) {
        #[cfg(target_os = "macos")]
        if let Ok(pop_ptr) = popover.ns_window() {
            unsafe {
                cq_hide_rail_popover(pop_ptr);
            }
            let _ = app.emit_to(RAIL_POPOVER_LABEL, "rail-popover-clear", ());
            return;
        }
        let _ = popover.hide();
        let _ = app.emit_to(RAIL_POPOVER_LABEL, "rail-popover-clear", ());
    }
}

#[tauri::command]
/// Pre-create the hidden popover WebView when entering rail mode so the first hover opens instantaneously.
pub fn prewarm_rail_popover(app: tauri::AppHandle) -> Result<(), String> {
    let _ = ensure_rail_popover_window(&app)?;
    Ok(())
}

#[tauri::command]
/// Position and push state to the separate popover window.
/// When currently hidden, keeps the window off-screen until the WebView paints the new frame and calls `reveal_rail_popover`.
pub fn show_rail_popover(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    mut state: Value,
) -> Result<(), String> {
    let popover = ensure_rail_popover_window(&app)?;
    let visible = popover.is_visible().unwrap_or(false);
    let open_id = RAIL_POPOVER_OPEN_ID.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(obj) = state.as_object_mut() {
        obj.insert("openId".into(), Value::from(open_id));
    }
    if let Ok(mut slot) = RAIL_POPOVER_STATE.lock() {
        *slot = Some(state.clone());
    }
    let _ = popover.set_size(LogicalSize::new(width, height));
    let _ = popover.set_position(PhysicalPosition::new(x, y));
    let _ = app.emit_to(RAIL_POPOVER_LABEL, "rail-popover-state", &state);
    // If already visible (switching between sources), refresh window level without hiding or re-playing entrance.
    if visible {
        #[cfg(target_os = "macos")]
        if let Ok(pop_ptr) = popover.ns_window() {
            let main_ptr = app
                .get_webview_window("main")
                .and_then(|w| w.ns_window().ok())
                .unwrap_or(std::ptr::null_mut());
            unsafe {
                cq_show_rail_popover(pop_ptr, main_ptr);
            }
        }
    }
    Ok(())
}

#[tauri::command]
/// Reveal the hidden popover window only after its WebView has painted the matching `open_id` frame.
pub fn reveal_rail_popover(app: tauri::AppHandle, open_id: u64) -> Result<(), String> {
    if RAIL_POPOVER_OPEN_ID.load(Ordering::SeqCst) != open_id {
        return Ok(());
    }
    if let Some(popover) = app.get_webview_window(RAIL_POPOVER_LABEL) {
        if popover.is_visible().unwrap_or(false) {
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        if let Ok(pop_ptr) = popover.ns_window() {
            let main_ptr = app
                .get_webview_window("main")
                .and_then(|w| w.ns_window().ok())
                .unwrap_or(std::ptr::null_mut());
            unsafe {
                cq_show_rail_popover(pop_ptr, main_ptr);
            }
            return Ok(());
        }
        let _ = popover.show();
    }
    Ok(())
}

#[tauri::command]
/// Push live quota/closing updates to an already visible popover window without touching window geometry.
pub fn sync_rail_popover(app: tauri::AppHandle, mut state: Value) -> Result<(), String> {
    let open_id = RAIL_POPOVER_OPEN_ID.load(Ordering::SeqCst);
    if let Some(obj) = state.as_object_mut() {
        obj.insert("openId".into(), Value::from(open_id));
    }
    if let Ok(mut slot) = RAIL_POPOVER_STATE.lock() {
        *slot = Some(state.clone());
    }
    if app.get_webview_window(RAIL_POPOVER_LABEL).is_some() {
        let _ = app.emit_to(RAIL_POPOVER_LABEL, "rail-popover-state", &state);
    }
    Ok(())
}

#[tauri::command]
/// Hide the separate hover popover window after its close fade completes.
pub fn hide_rail_popover(app: tauri::AppHandle) -> Result<(), String> {
    hide_rail_popover_window(&app);
    Ok(())
}

#[tauri::command]
/// Return the latest popover payload when the popover WebView mounts for the first time.
pub fn get_rail_popover_state() -> Option<Value> {
    RAIL_POPOVER_STATE.lock().ok().and_then(|slot| slot.clone())
}

#[tauri::command]
/// Forward interactive actions clicked inside the separate popover window back to the main window.
pub fn rail_popover_action(app: tauri::AppHandle, action: Value) -> Result<(), String> {
    let _ = app.emit_to("main", "rail-popover-action", action);
    Ok(())
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
    let _ = RAIL_APP.set(app.clone());
    if rectangular {
        hide_rail_popover_window(&app);
    }
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

/// Apply native window capture protection and vibrant appearance to the floating card and rail popover.
pub fn apply_main_window_flags(app: &tauri::AppHandle, hide_from_capture: bool, theme: &str) {
    #[cfg(target_os = "macos")]
    {
        let mode = match theme {
            "light" => 1,
            "dark" => 2,
            _ => 0,
        };
        for label in ["main", RAIL_POPOVER_LABEL] {
            if let Some(window) = app.get_webview_window(label) {
                if let Ok(pointer) = window.ns_window() {
                    unsafe {
                        cq_set_hide_from_capture(pointer, hide_from_capture);
                        cq_set_window_appearance(pointer, mode);
                    }
                }
            }
        }
    }
}

/// Tray hiding also removes the parking indicator, cursor timer, and any visible rail popover.
pub fn hide_card(window: &tauri::WebviewWindow) {
    disarm_top_hide();
    hide_rail_popover_window(window.app_handle());
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
