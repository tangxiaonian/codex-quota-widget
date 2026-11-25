mod api;
mod packages;
mod parse;
use serde::Serialize;
use serde_json::Value;
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub account_key: String,
    pub name: String,
    pub plan: Option<String>,
    pub remaining: Option<f64>,
    pub total: Option<f64>,
    pub used: Option<f64>,
    pub package_error: Option<String>,
    pub packages: Vec<Package>,
    pub fetched_at: i64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub id: String,
    pub name: String,
    pub remaining: Option<f64>,
    pub total: Option<f64>,
    pub expires_at: Option<i64>,
}
/// Resolve the installed app by bundle identity, including user-local installations.
fn executable() -> Option<PathBuf> {
    let found = Command::new("/usr/bin/mdfind")
        .args(["kMDItemCFBundleIdentifier == 'com.tencent.workbuddy.mac'"])
        .output()
        .ok();
    let mut roots: Vec<PathBuf> = found
        .iter()
        .flat_map(|v| {
            String::from_utf8_lossy(&v.stdout)
                .lines()
                .map(PathBuf::from)
                .collect::<Vec<_>>()
        })
        .collect();
    roots.push("/Applications/WorkBuddy.app".into());
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications/WorkBuddy.app"));
    }
    roots
        .into_iter()
        .map(|p| p.join("Contents/MacOS/Electron"))
        .find(|p| p.is_file())
}
/// Decode just the active local session through WorkBuddy's own runtime. No login or auth-file writes.
fn session() -> Result<Value, String> {
    let exe = executable().ok_or("请先安装并登录 WorkBuddy")?;
    let mut child = Command::new(exe)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .env_remove("NODE_OPTIONS")
        .args(["-e", include_str!("read_session.cjs")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法读取 WorkBuddy 登录信息")?;
    let start = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|_| "WorkBuddy 登录读取失败")?
            .is_some()
        {
            break;
        }
        if start.elapsed() > Duration::from_secs(8) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("WorkBuddy 登录读取超时".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    let output = child
        .wait_with_output()
        .map_err(|_| "WorkBuddy 登录读取失败")?;
    if !output.status.success() {
        return Err("请打开 WorkBuddy 并重新登录后刷新".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "WorkBuddy 登录格式暂不支持".into())
}
/// Request a read-only billing summary; only account labels, credit numbers and dates reach the UI.
pub fn refresh(expected_account_key: Option<&str>) -> Result<Snapshot, String> {
    let session = session()?;
    let key = parse::identity(&session)?;
    query(&session).map_err(|error| scoped_error(error, &key, expected_account_key))
}

/// A failed query after changing accounts must not leave the prior account's balance visible.
fn scoped_error(error: String, current_key: &str, expected: Option<&str>) -> String {
    if expected.is_some_and(|previous| previous != current_key) {
        "WorkBuddy 账号已改变，新账号读取失败，请重新刷新".into()
    } else {
        error
    }
}

/// Fetch the summary for one resolved local identity without returning credential contents.
fn query(session: &Value) -> Result<Snapshot, String> {
    let summary = api::request(session, 0, &serde_json::json!({}))?;
    let mut snapshot = parse::snapshot(&summary, session)?;
    match packages::read(session, &summary) {
        Ok(packages) => snapshot.packages = packages,
        Err(_) => snapshot.package_error = Some("积分包详情暂未获取，请稍后刷新".into()),
    }
    Ok(snapshot)
}
#[cfg(test)]
#[test]
#[ignore = "requires signed-in WorkBuddy; explicitly run for read-only verification"]
fn live_summary() {
    let s = refresh(None).expect("read WorkBuddy summary");
    assert!(s.package_error.is_none(), "package details unavailable");
    println!(
        "dated={}; spendable={}; unknown_balances={}",
        s.packages.iter().filter(|p| p.expires_at.is_some()).count(),
        s.packages
            .iter()
            .filter(|p| p.remaining.is_some_and(|n| n > 0.))
            .count(),
        s.packages.iter().filter(|p| p.remaining.is_none()).count()
    );
    println!(
        "remaining={:?}; total={:?}; packages={}",
        s.remaining,
        s.total,
        s.packages.len()
    );
}

#[cfg(test)]
#[test]
fn changed_identity_drops_stale_balance_on_network_failure() {
    assert!(scoped_error("网络失败".into(), "b", Some("a")).contains("账号已改变"));
    assert_eq!(scoped_error("网络失败".into(), "a", Some("a")), "网络失败");
}
