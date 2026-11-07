//! Read the credential store for this Codex home without searching unrelated profiles.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

/// Resolve the same local profile as the child Codex CLI (including custom CODEX_HOME).
pub fn load() -> Option<Value> {
    let home = std::env::var_os("CODEX_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".codex")))?;
    load_at(&home, read_keychain)
}

/// Respect all four storage modes; a denied keychain request must not fall through to a stale file.
fn load_at(
    home: &Path,
    keychain: impl FnOnce(&Path) -> Result<Option<Value>, ()>,
) -> Option<Value> {
    let config = match fs::read_to_string(home.join("config.toml")) {
        Ok(text) => text.parse::<toml::Table>().ok()?,
        Err(e) if e.kind() == ErrorKind::NotFound => toml::Table::new(),
        Err(_) => return None,
    };
    let mode = config
        .get("cli_auth_credentials_store")
        .map(|v| v.as_str())
        .unwrap_or(Some("file"))?;
    let file = || serde_json::from_reader(fs::File::open(home.join("auth.json")).ok()?).ok();
    match mode {
        "file" => file(),
        "keyring" => keychain(home).ok().flatten(),
        "auto" => keychain(home).ok()?.or_else(file),
        _ => None, // Ephemeral and unknown storage formats have no supported persistent source.
    }
}

/// Query only the Codex generic-password item scoped to this profile's canonical directory.
fn read_keychain(home: &Path) -> Result<Option<Value>, ()> {
    let path = home.canonicalize().unwrap_or_else(|_| home.to_owned());
    let hash = format!("{:x}", Sha256::digest(path.to_string_lossy().as_bytes()));
    let item = format!("cli|{}", &hash[..16]);
    // stdout is a private pipe into this process; never forward command output or stderr.
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            "Codex Auth",
            "-a",
            &item,
            "-w",
        ])
        .output()
        .map_err(|_| ())?;
    if output.status.code() == Some(44) {
        return Ok(None);
    }
    if !output.status.success() {
        return Err(());
    }
    serde_json::from_slice(&output.stdout)
        .map(Some)
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_home_respects_storage_mode_and_does_not_bypass_denial() {
        let home = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&home).unwrap();
        fs::write(home.join("auth.json"), br#"{"source":"file"}"#).unwrap();
        assert_eq!(load_at(&home, |_| panic!()).unwrap()["source"], "file");
        for mode in ["keyring", "auto", "ephemeral"] {
            fs::write(
                home.join("config.toml"),
                format!("cli_auth_credentials_store = '{mode}'"),
            )
            .unwrap();
            let found = load_at(&home, |_| Ok(Some(serde_json::json!({"source":"keyring"}))));
            assert_eq!(found.is_some(), mode != "ephemeral");
            if let Some(value) = found {
                assert_eq!(value["source"], "keyring");
            }
            assert_eq!(load_at(&home, |_| Ok(None)).is_some(), mode == "auto");
            assert!(load_at(&home, |_| Err(())).is_none());
        }
        fs::remove_file(home.join("auth.json")).unwrap();
        fs::remove_file(home.join("config.toml")).unwrap();
        fs::remove_dir(home).unwrap();
    }
}
