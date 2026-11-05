use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

pub trait Transport {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String>;
}
pub struct Rpc {
    child: Child,
    input: ChildStdin,
    lines: Receiver<Result<Value, String>>,
    next_id: u64,
}
impl Rpc {
    /// Start the installed Codex client with its existing profile; never start a model turn.
    pub fn connect() -> Result<Self, String> {
        let executable = discover_codex()?;
        let mut child = Command::new(executable)
            .args(["app-server", "--stdio"])
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动 Codex App Server")?;
        let input = child.stdin.take().ok_or("无法连接 Codex 输入管道")?;
        let output = child.stdout.take().ok_or("无法连接 Codex 输出管道")?;
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let result = line
                    .map_err(|_| "Codex 连接已中断".to_string())
                    .and_then(|s| {
                        serde_json::from_str(&s).map_err(|_| "Codex 返回了无法解析的数据".into())
                    });
                if tx.send(result).is_err() {
                    break;
                }
            }
        });
        let mut rpc = Self {
            child,
            input,
            lines,
            next_id: 1,
        };
        rpc.call("initialize",json!({"clientInfo":{"name":"codex_quota_widget","title":"Codex Quota Widget","version":"0.1.0"}}))?;
        rpc.write(&json!({"method":"initialized"}))?;
        Ok(rpc)
    }
    /// Write only protocol requests; server responses never enter logs.
    fn write(&mut self, value: &Value) -> Result<(), String> {
        serde_json::to_writer(&mut self.input, value).map_err(|_| "发送 Codex 请求失败")?;
        self.input
            .write_all(b"\n")
            .and_then(|_| self.input.flush())
            .map_err(|_| "Codex 连接已关闭".into())
    }
}
impl Transport for Rpc {
    /// Correlate replies and bound each request, ignoring unrelated notifications.
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&json!({"method":method,"params":params,"id":id}))?;
        let deadline = Instant::now() + Duration::from_secs(40);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let value = self
                .lines
                .recv_timeout(remaining)
                .map_err(|_| "Codex 请求超时或连接中断，请稍后刷新")??;
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = value.get("error") {
                // Do not propagate raw server messages: they can contain private response content.
                return Err(match error["code"].as_i64() {
                    Some(-32601) => "本机 Codex 版本不支持此接口，请升级 Codex",
                    _ => "Codex 未完成请求，请确认登录状态后重试",
                }
                .into());
            }
            return value
                .get("result")
                .cloned()
                .ok_or_else(|| "Codex 响应缺少结果".into());
        }
    }
}
impl Drop for Rpc {
    /// Each operation owns its helper process; never leave an idle server behind.
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
/// Locate Codex by its bundle ID rather than its visible application name.
fn discover_codex() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/mdfind")
            .args(["kMDItemCFBundleIdentifier == 'com.openai.codex'"])
            .output();
        if let Ok(output) = output {
            for root in String::from_utf8_lossy(&output.stdout).lines() {
                for relative in [
                    "Contents/Resources/codex-cli/bin/codex",
                    "Contents/Resources/codex",
                ] {
                    let path = PathBuf::from(root).join(relative);
                    if path.is_file() {
                        return Ok(path);
                    }
                }
            }
        }
    }
    for path in [
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
    ] {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Ok(p);
        }
    }
    Err("未找到 Codex，请先安装 Codex 桌面端".into())
}
