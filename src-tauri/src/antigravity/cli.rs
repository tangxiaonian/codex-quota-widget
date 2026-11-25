use serde_json::Value;
use std::env;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::{parse_report, Snapshot};

/// Versions before 1.1.11 send `-p "/usage"` to the model as a real prompt and spend quota.
const MIN_VERSION: [u32; 3] = [1, 1, 11];
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const USAGE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;

#[derive(Debug)]
pub(super) enum CliOutcome {
    Snapshot(Snapshot),
    NoLimits,
    NotAvailable,
    Failed,
}

/// Fallback to the official `agy` CLI only when its version guarantees read-only `/usage`.
pub(super) fn fetch() -> CliOutcome {
    let Some(binary) = locate_cli() else {
        return CliOutcome::NotAvailable;
    };
    let Some(version_bytes) = run_bounded(&binary, &["--version"], VERSION_TIMEOUT, 4096) else {
        return CliOutcome::NotAvailable;
    };
    let version_text = String::from_utf8_lossy(&version_bytes);
    if !supports_read_only_usage(&version_text) {
        return CliOutcome::NotAvailable;
    }

    // `--log-file /dev/null` keeps periodic checks from replacing the user's active CLI log link.
    let Some(output) = run_bounded(
        &binary,
        &["--log-file", "/dev/null", "-p", "/usage", "--output-format", "json"],
        USAGE_TIMEOUT,
        MAX_OUTPUT_BYTES,
    ) else {
        return CliOutcome::Failed;
    };
    parse_cli_output(&output)
}

/// Parse the JSON envelope printed by `agy -p "/usage" --output-format json`.
fn parse_cli_output(bytes: &[u8]) -> CliOutcome {
    let Ok(root) = serde_json::from_slice::<Value>(bytes) else {
        return CliOutcome::Failed;
    };
    if root["status"].as_str() != Some("SUCCESS") {
        return CliOutcome::Failed;
    }
    let Some(command) = root.get("command").filter(|v| v.is_object()) else {
        return CliOutcome::Failed;
    };
    if let Some(name) = command.get("name").and_then(Value::as_str) {
        if !matches!(name, "usage" | "/usage" | "quota" | "/quota") {
            return CliOutcome::Failed;
        }
    }
    let Some(data) = command.get("data").filter(|v| v.is_object()) else {
        return CliOutcome::Failed;
    };
    match parse_report(data, None, "cli") {
        Ok(snapshot) => CliOutcome::Snapshot(snapshot),
        Err(_) if data.get("groups").is_some_and(Value::is_array) => CliOutcome::NoLimits,
        Err(_) => CliOutcome::Failed,
    }
}

/// Locate the official `agy` binary (never `antigravity`, which is the editor launcher).
fn locate_cli() -> Option<PathBuf> {
    if let Some(path_var) = env::var_os("PATH") {
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join("agy");
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    let home = env::var_os("HOME").map(PathBuf::from);
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/agy"),
        PathBuf::from("/usr/local/bin/agy"),
    ];
    if let Some(home) = home {
        candidates.insert(0, home.join(".local/bin/agy"));
        // Gemini.app bundles the same CLI here when installed standalone.
        candidates.push(home.join(".gemini/bin/agy"));
    }
    candidates.into_iter().find(|path| is_executable(path))
}

fn is_executable(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.is_file() && (meta.permissions().mode() & 0o111 != 0))
        .unwrap_or(false)
}

/// Accept `agy` only at or above 1.1.11 so `/usage` never falls through to a model turn.
fn supports_read_only_usage(printed: &str) -> bool {
    let token = printed
        .split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .unwrap_or(printed.trim());
    let parts: Vec<Option<u32>> = token
        .trim_start_matches('v')
        .split('.')
        .map(|segment| {
            let digits: String = segment.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse::<u32>().ok()
        })
        .collect();
    if parts.len() < 2 || parts.iter().any(Option::is_none) {
        return false;
    }
    let nums: Vec<u32> = parts.into_iter().flatten().collect();
    for (idx, min) in MIN_VERSION.iter().enumerate() {
        let value = nums.get(idx).copied().unwrap_or(0);
        if value != *min {
            return value > *min;
        }
    }
    true
}

/// Run a child process from temp_dir with a strict timeout and output ceiling.
fn run_bounded(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
    max_bytes: usize,
) -> Option<Vec<u8>> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    // Prepend the binary's parent directory so wrapper scripts find sibling runtimes in GUI launches.
    if let Some(parent) = binary.parent() {
        let existing = env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![parent.to_path_buf()];
        paths.extend(env::split_paths(&existing));
        if let Ok(joined) = env::join_paths(paths) {
            command.env("PATH", joined);
        }
    }

    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.take((max_bytes + 1) as u64).read_to_end(&mut buf);
        buf
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => break None,
        }
    };

    let bytes = reader.join().ok()?;
    if !status?.success() || bytes.len() > max_bytes {
        return None;
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_minimum_safe_agy_version() {
        assert!(!supports_read_only_usage("1.1.10"));
        assert!(!supports_read_only_usage("1.0.99"));
        assert!(!supports_read_only_usage("unknown"));
        assert!(supports_read_only_usage("1.1.11"));
        assert!(supports_read_only_usage("1.5.13-beta\n"));
        assert!(supports_read_only_usage("agy 1.3.5"));
    }

    #[test]
    fn parses_snake_case_cli_usage_envelope() {
        let payload = br#"{
            "status": "SUCCESS",
            "command": {
                "name": "/usage",
                "data": {
                    "groups": [
                        {
                            "name": "Gemini Models",
                            "buckets": [
                                {"id": "gemini-weekly", "window": "weekly", "remaining_fraction": 0.88, "reset_time": "2026-11-30T08:00:00Z"},
                                {"id": "gemini-5h", "window": "5h", "remaining_fraction": 0.72, "reset_time": "2026-11-25T18:00:00Z"}
                            ]
                        },
                        {
                            "name": "Gemini 4 Argon",
                            "buckets": [
                                {"id": "gemini-argon-wtu-weekly", "window": "weekly", "remaining_fraction": 1.0, "reset_time": "2026-11-30T08:00:00Z"}
                            ]
                        }
                    ]
                }
            }
        }"#;
        match parse_cli_output(payload) {
            CliOutcome::Snapshot(snapshot) => {
                assert_eq!(snapshot.source, "cli");
                assert_eq!(snapshot.plan, None);
                assert_eq!(snapshot.groups.len(), 2);
                assert_eq!(snapshot.groups[0].windows[0].kind, "session");
                assert_eq!(snapshot.groups[0].windows[0].remaining, Some(72.0));
                assert_eq!(snapshot.groups[0].windows[1].kind, "weekly");
                assert_eq!(snapshot.groups[1].name, "Gemini 4 Argon");
            }
            other => panic!("unexpected outcome: {other:?}"),
        }
    }
}
