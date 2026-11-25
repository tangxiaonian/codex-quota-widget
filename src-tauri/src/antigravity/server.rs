use serde_json::Value;
use std::collections::HashSet;
use std::process::Command;

use super::native::{self, LocalRoute};
use super::{parse_report, Snapshot};

const CSRF_ENV_NAME: &str = "ANTIGRAVITY_SERVER_CSRF_TOKEN";
const ORIGINS: [&str; 2] = ["/Antigravity.app/", "/Antigravity IDE.app/"];

#[derive(Debug)]
pub(super) enum ServerOutcome {
    Snapshot(Snapshot),
    NoLimits,
    NotAnswering,
    NotRunning,
}

#[derive(Debug, PartialEq, Eq)]
struct Candidate {
    pid: i32,
    token: String,
}

/// Query running local Antigravity language servers in desktop-first order.
pub(super) fn fetch() -> ServerOutcome {
    let candidates = locate_candidates();
    if candidates.is_empty() {
        return ServerOutcome::NotRunning;
    }

    let mut answered_empty = false;
    let mut something_answered = false;

    for candidate in candidates {
        for port in listening_ports(candidate.pid) {
            let Some((status, payload)) =
                native::local_post(port, LocalRoute::QuotaSummary, &candidate.token)
            else {
                continue;
            };
            match status {
                200 => {
                    something_answered = true;
                    if let Ok(mut snapshot) = parse_report(&payload, None, "languageServer") {
                        snapshot.plan = fetch_plan(port, &candidate.token);
                        return ServerOutcome::Snapshot(snapshot);
                    }
                    if has_response_groups(&payload) {
                        answered_empty = true;
                    }
                }
                // Antigravity IDE may run two language servers where the non-quota one replies 401.
                401 | 403 => {
                    something_answered = true;
                }
                _ => {}
            }
        }
    }

    if answered_empty {
        ServerOutcome::NoLimits
    } else if something_answered {
        ServerOutcome::NotAnswering
    } else {
        ServerOutcome::NotRunning
    }
}

/// Fetch only the plan name from GetUserStatus; ignore user email or personal fields.
fn fetch_plan(port: u16, token: &str) -> Option<String> {
    let (status, payload) = native::local_post(port, LocalRoute::UserStatus, token)?;
    if status != 200 {
        return None;
    }
    payload["userStatus"]["planStatus"]["planInfo"]["planName"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Distinguish a valid empty groups payload from an unrelated service returning non-quota JSON.
fn has_response_groups(payload: &Value) -> bool {
    payload
        .get("response")
        .and_then(|r| r.get("groups"))
        .or_else(|| payload.get("groups"))
        .is_some_and(Value::is_array)
}

/// Discover all Antigravity language server processes owned by the current user.
fn locate_candidates() -> Vec<Candidate> {
    let Ok(output) = Command::new("/bin/ps")
        .args(["-axww", "-o", "pid=,command="])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let listing = String::from_utf8_lossy(&output.stdout);
    collect_candidates(&listing, |pid| {
        process_arguments(pid)
            .and_then(|record| extract_env_value(CSRF_ENV_NAME, &record))
    })
}

/// Filter ps output by Antigravity bundle paths and extract per-launch CSRF tokens.
fn collect_candidates(
    ps_output: &str,
    env_lookup: impl Fn(i32) -> Option<String>,
) -> Vec<Candidate> {
    let matching: Vec<&str> = ps_output
        .lines()
        .filter(|line| line.contains("/language_server"))
        .collect();
    let mut results = Vec::new();
    let mut seen_pids = HashSet::new();

    for origin in ORIGINS {
        for line in &matching {
            if !line.contains(origin) {
                continue;
            }
            let Some((pid, cmd_token)) = parse_ps_line(line) else {
                continue;
            };
            if !seen_pids.insert(pid) {
                continue;
            }
            // Antigravity 2.34 moved the CSRF token from argv into the process environment.
            let Some(token) = cmd_token.or_else(|| env_lookup(pid)) else {
                continue;
            };
            if !token.is_empty() {
                results.push(Candidate { pid, token });
            }
        }
    }
    results
}

/// Extract pid and optional legacy `--csrf_token` flag from one `ps` output line.
fn parse_ps_line(line: &str) -> Option<(i32, Option<String>)> {
    let mut fields = line.split_whitespace();
    let pid = fields.next()?.parse::<i32>().ok()?;
    let mut token = None;
    while let Some(field) = fields.next() {
        if field == "--csrf_token" {
            token = fields.next().filter(|v| !v.is_empty()).map(str::to_owned);
            break;
        }
        if let Some(inline) = field.strip_prefix("--csrf_token=") {
            if !inline.is_empty() {
                token = Some(inline.to_owned());
            }
            break;
        }
    }
    Some((pid, token))
}

/// Read macOS `KERN_PROCARGS2` for a process owned by the current user.
fn process_arguments(pid: i32) -> Option<Vec<u8>> {
    let mut argmax: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let mut mib_max = [libc::CTL_KERN, libc::KERN_ARGMAX];
    let rc = unsafe {
        libc::sysctl(
            mib_max.as_mut_ptr(),
            2,
            (&mut argmax as *mut libc::c_int).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 || argmax <= 0 {
        return None;
    }

    let mut buffer = vec![0u8; argmax as usize];
    let mut buf_size = buffer.len();
    let mut mib_args = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let rc = unsafe {
        libc::sysctl(
            mib_args.as_mut_ptr(),
            3,
            buffer.as_mut_ptr().cast(),
            &mut buf_size,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 || buf_size == 0 {
        return None;
    }
    buffer.truncate(buf_size);
    Some(buffer)
}

/// Extract a single named environment variable from a `KERN_PROCARGS2` byte record.
fn extract_env_value(name: &str, record: &[u8]) -> Option<String> {
    if record.len() < 4 {
        return None;
    }
    let argc = i32::from_ne_bytes(record[0..4].try_into().ok()?);
    if argc < 0 {
        return None;
    }
    let mut idx = 4;

    // Skip executable path, NUL padding, then `argc` NUL-terminated arguments.
    while idx < record.len() && record[idx] != 0 {
        idx += 1;
    }
    while idx < record.len() && record[idx] == 0 {
        idx += 1;
    }
    for _ in 0..argc {
        if idx >= record.len() {
            return None;
        }
        while idx < record.len() && record[idx] != 0 {
            idx += 1;
        }
        idx += 1;
    }

    let prefix = format!("{name}=");
    let prefix_bytes = prefix.as_bytes();
    while idx < record.len() && record[idx] != 0 {
        let start = idx;
        while idx < record.len() && record[idx] != 0 {
            idx += 1;
        }
        let entry = &record[start..idx];
        if let Some(rest) = entry.strip_prefix(prefix_bytes) {
            let value = std::str::from_utf8(rest).ok()?;
            return (!value.is_empty()).then(|| value.to_owned());
        }
        idx += 1;
    }
    None
}

/// List unique listening TCP ports of one process via `lsof -F n`.
fn listening_ports(pid: i32) -> Vec<u16> {
    let Ok(output) = Command::new("/usr/sbin/lsof")
        .args([
            "-nP",
            "-a",
            "-p",
            &pid.to_string(),
            "-iTCP",
            "-sTCP:LISTEN",
            "-F",
            "n",
        ])
        .output()
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_lsof_ports(&String::from_utf8_lossy(&output.stdout))
}

/// Parse `lsof -F n` lines such as `n127.0.0.1:51234` or `n[::1]:51234`.
fn parse_lsof_ports(listing: &str) -> Vec<u16> {
    let mut seen = HashSet::new();
    let mut ports = Vec::new();
    for line in listing.lines() {
        let Some(name) = line.strip_prefix('n') else {
            continue;
        };
        let Some(port) = name.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) else {
            continue;
        };
        if port > 0 && seen.insert(port) {
            ports.push(port);
        }
    }
    ports
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_procargs2(exec_path: &str, args: &[&str], envs: &[&str]) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(&(args.len() as i32).to_ne_bytes());
        buf.extend_from_slice(exec_path.as_bytes());
        buf.extend_from_slice(&[0, 0, 0]);
        for arg in args {
            buf.extend_from_slice(arg.as_bytes());
            buf.push(0);
        }
        for env in envs {
            buf.extend_from_slice(env.as_bytes());
            buf.push(0);
        }
        buf.push(0);
        buf
    }

    #[test]
    fn extracts_csrf_token_from_procargs2_environment() {
        let record = build_procargs2(
            "/Applications/Antigravity.app/Contents/Resources/language_server",
            &["language_server", "--https_server_port", "0"],
            &[
                "PATH=/usr/bin",
                "ANTIGRAVITY_SERVER_CSRF_TOKEN=token-from-env",
                "HOME=/Users/demo",
            ],
        );
        assert_eq!(
            extract_env_value(CSRF_ENV_NAME, &record).as_deref(),
            Some("token-from-env")
        );
        assert_eq!(extract_env_value("MISSING_VAR", &record), None);
        assert_eq!(extract_env_value(CSRF_ENV_NAME, &[1, 2]), None);
    }

    #[test]
    fn prioritizes_desktop_app_and_ignores_other_codeium_servers() {
        let ps = "\
 101 /Applications/Windsurf.app/Contents/MacOS/language_server --csrf_token windsurf-tok
 202 /Applications/Antigravity IDE.app/Contents/Resources/language_server_macos_arm --https_server_port 0
 303 /Applications/Antigravity.app/Contents/Resources/language_server --csrf_token legacy-tok
 404 /Applications/Antigravity.app/Contents/Resources/language_server --https_server_port 0
";
        let candidates = collect_candidates(ps, |pid| match pid {
            202 => Some("ide-env-tok".to_owned()),
            404 => Some("app-env-tok".to_owned()),
            _ => None,
        });
        assert_eq!(
            candidates,
            vec![
                Candidate {
                    pid: 303,
                    token: "legacy-tok".to_owned()
                },
                Candidate {
                    pid: 404,
                    token: "app-env-tok".to_owned()
                },
                Candidate {
                    pid: 202,
                    token: "ide-env-tok".to_owned()
                },
            ]
        );
    }

    #[test]
    fn parses_unique_listening_ports_from_lsof() {
        let lsof = "p123\nf12\nn127.0.0.1:54321\nf13\nn[::1]:54321\nf14\nn127.0.0.1:54322\n";
        assert_eq!(parse_lsof_ports(lsof), vec![54321, 54322]);
    }
}
