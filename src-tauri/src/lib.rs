mod credential_store;
mod model;
mod provider;
mod rpc;
mod storage;
mod subscription;
mod window;
use model::{Preferences, Snapshot};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static SLEEPING: AtomicBool = AtomicBool::new(false);
static REDUCED: AtomicBool = AtomicBool::new(false);
struct State {
    storage: Mutex<storage::Storage>,
    busy: AtomicBool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Lifecycle {
    running: bool,
    sleeping: bool,
    reduce_transparency: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    preferences: Preferences,
    cached: Option<Snapshot>,
    lifecycle: Lifecycle,
    demo: bool,
}
#[cfg(target_os = "macos")]
extern "C" {
    fn cq_codex_running() -> bool;
    fn cq_observe(callback: extern "C" fn(bool, bool, bool));
}
/// Relay native events to the UI without polling the process table.
extern "C" fn on_workspace(running: bool, sleeping: bool, reduce: bool) {
    SLEEPING.store(sleeping, Ordering::Relaxed);
    REDUCED.store(reduce, Ordering::Relaxed);
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "codex-state",
            Lifecycle {
                running,
                sleeping,
                reduce_transparency: reduce,
            },
        );
    }
}
/// Current native state is also read on first mount, so early events cannot be lost.
fn lifecycle() -> Lifecycle {
    #[cfg(target_os = "macos")]
    let running = unsafe { cq_codex_running() };
    #[cfg(not(target_os = "macos"))]
    let running = true;
    Lifecycle {
        running,
        sleeping: SLEEPING.load(Ordering::Relaxed),
        reduce_transparency: REDUCED.load(Ordering::Relaxed),
    }
}
#[tauri::command]
/// Load the local UI state; this command never contacts an account service.
fn bootstrap(state: tauri::State<State>) -> Result<Bootstrap, String> {
    let db = state.storage.lock().map_err(|_| "本地存储不可用")?;
    Ok(Bootstrap {
        preferences: db.preferences()?,
        cached: db.snapshot()?,
        lifecycle: lifecycle(),
        demo: std::env::args().any(|a| a == "--demo"),
    })
}
#[tauri::command]
/// Save UI preferences only. OS autostart is handled separately by the explicit settings toggle.
/// Tray visibility applies immediately; the card's settings view stays reachable to undo it.
fn save_preferences(
    state: tauri::State<State>,
    app: tauri::AppHandle,
    preferences: Preferences,
) -> Result<(), String> {
    let db = state.storage.lock().map_err(|_| "本地存储不可用")?;
    let previous = db.preferences()?;
    db.save_preferences(&preferences)?;
    if previous.show_tray_icon != preferences.show_tray_icon {
        if let Some(tray) = app.tray_by_id("main-tray") {
            tray.set_visible(preferences.show_tray_icon)
                .map_err(|_| "更新菜单栏图标失败")?;
        }
    }
    Ok(())
}
#[tauri::command]
/// Return just the locally matched date when the user has enabled subscription display.
async fn subscription_active_until(
    app: tauri::AppHandle,
    account_key: String,
) -> Result<Option<i64>, String> {
    let enabled = app
        .state::<State>()
        .storage
        .lock()
        .map_err(|_| "本地存储不可用")?
        .preferences()?
        .show_subscription;
    if !enabled {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || subscription::active_until(&account_key))
        .await
        .map_err(|_| "读取订阅有效期失败".into())
}
#[tauri::command]
/// Fetch live read-only data off the event loop, then atomically cache the safe view model.
async fn refresh_snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut rpc = rpc::Rpc::connect()?;
        let snapshot = provider::read_snapshot(&mut rpc)?;
        app.state::<State>()
            .storage
            .lock()
            .map_err(|_| "本地存储不可用")?
            .save_snapshot(&snapshot)?;
        Ok(snapshot)
    })
    .await
    .map_err(|_| "额度读取任务异常".to_string())?
}
#[tauri::command]
/// The only production redemption entry: invoked exclusively by the user confirmation button.
async fn consume_credit(
    state: tauri::State<'_, State>,
    account_key: String,
    credit_id: String,
    attempt_id: String,
) -> Result<String, String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("已有用卡请求正在处理".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut rpc = rpc::Rpc::connect()?;
        provider::consume(&mut rpc, &account_key, &credit_id, &attempt_id)
    })
    .await
    .map_err(|_| "用卡请求结果待确认，请刷新状态".to_string());
    state.busy.store(false, Ordering::SeqCst);
    result?
}
/// Draw a small template tray icon without bundling a font or downloading artwork.
fn tray_image() -> tauri::image::Image<'static> {
    let mut pixels = vec![0u8; 22 * 22 * 4];
    for y in 0..22 {
        for x in 0..22 {
            let d = ((x as f32 - 10.5).powi(2) + (y as f32 - 10.5).powi(2)).sqrt();
            if (6.0..9.0).contains(&d) && !(y > 15 && x > 7 && x < 15) {
                pixels[(y * 22 + x) * 4 + 3] = 255;
            }
        }
    }
    tauri::image::Image::new_owned(pixels, 22, 22)
}
/// Install menu, native lifecycle observation and the narrow application command surface.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            window::show_card(app);
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let path = std::env::var_os("CQ_WIDGET_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?)
                .join("widget.sqlite3");
            let storage = storage::Storage::open(&path)?;
            let show_tray = storage.preferences()?.show_tray_icon;
            app.manage(State {
                storage: Mutex::new(storage),
                busy: AtomicBool::new(false),
            });
            let _ = APP.set(app.handle().clone());
            #[cfg(target_os = "macos")]
            unsafe {
                cq_observe(on_workspace)
            };
            let show = MenuItem::with_id(app, "show", "显示卡片", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "隐藏卡片", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "刷新额度", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "偏好设置…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出额度卡片", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &refresh, &settings, &quit])?;
            let tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_image())
                .icon_as_template(true)
                .tooltip("Codex 额度卡片")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if let Some(w) = app.get_webview_window("main") {
                        match event.id.as_ref() {
                            "show" => {
                                window::show_card(app);
                                let _ = app.emit("menu-action", "show");
                            }
                            "hide" => {
                                window::hide_card(&w);
                            }
                            "settings" => {
                                window::show_card(app);
                                let _ = app.emit("menu-action", "settings");
                            }
                            "refresh" => {
                                let _ = app.emit("menu-action", "refresh");
                            }
                            "quit" => app.exit(0),
                            _ => {}
                        }
                    }
                })
                .build(app)?;
            tray.set_visible(show_tray)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            save_preferences,
            subscription_active_until,
            refresh_snapshot,
            consume_credit,
            window::arm_top_hide,
            window::disarm_top_hide
        ])
        .run(tauri::generate_context!())
        .expect("无法启动额度卡片");
}

/// Terminal diagnostic with an intentionally read-only call graph and no personal identifiers.
pub fn read_only_check() -> Result<(), String> {
    let mut rpc = rpc::Rpc::connect()?;
    let snapshot = provider::read_snapshot(&mut rpc)?;
    println!(
        "account: ChatGPT; plan: {}",
        snapshot.account.plan_type.as_deref().unwrap_or("unknown")
    );
    println!(
        "windows: {}; credit count: {:?}; detail rows: {}; details: {}",
        snapshot.windows.len(),
        snapshot.available_count,
        snapshot.credits.len(),
        snapshot.detail_state
    );
    for window in snapshot.windows {
        println!(
            "window_minutes: {}; used_percent: {:?}",
            window.minutes, window.used_percent
        );
    }
    println!("read-only check passed; no consumption method invoked");
    Ok(())
}
