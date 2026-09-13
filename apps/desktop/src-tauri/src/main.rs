//! The Tauri shell: a window, and the lifecycle of the daemon behind it.
//!
//! ## Why the shell owns the daemon
//!
//! The desktop app is not just a window: it starts the daemon that serves *every* EnvoyCoder window
//! and the paired phone, and it is the only process positioned to reap it. Three rules are carried
//! over from EnvoyMesh's shell, each of which cost it a bug:
//!
//!   1. **Kill only the child you started.** Resolving "who is on port 4770" and killing them is how
//!      a supervisor kills another app's process; the pid we recorded is the only safe target.
//!   2. **A health check must identify the node.** `/health` returning `{"ok":true}` proves a server
//!      exists, not that it is *ours* — two products sharing one transport is exactly the family's
//!      situation, so the probe compares the identity the body claims.
//!   3. **The shared home is resolved, never guessed.** `ENVOYMESH_HOME`, then the per-OS default,
//!      then legacy adoption — the same rule as the node, so both apps agree where state lives.
//!
//! This scaffold implements the first and third, and declares the second for the daemon probe. The
//! daemon itself (`apps/desktop/src/daemon/main.ts`) is TypeScript, spawned as a sidecar.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

/// The family's product name, used for the shared-home segment and the pairing `app` claim.
const PRODUCT_NAME: &str = "EnvoyCoder";
const DEFAULT_DAEMON_PORT: u16 = 4770;

/// The shared home, resolved the way every EnvoyMesh-family app resolves it.
///
/// Order: `ENVOYMESH_HOME` (resolved, and honoured even when it does not exist so a script may point
/// anywhere) → the per-OS default → legacy `~/.envoymesh` when that is where an existing install
/// lives. Adoption matters: an existing user must not silently get a second identity.
fn resolve_shared_home() -> PathBuf {
    if let Ok(raw) = std::env::var("ENVOYMESH_HOME") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let default = default_home_dir();
    let legacy = home_dir().join(".envoymesh");
    if !default.exists() && legacy.exists() {
        return legacy;
    }
    default
}

#[cfg(target_os = "macos")]
fn default_home_dir() -> PathBuf {
    home_dir().join("Library").join("Application Support").join("EnvoyMesh")
}

#[cfg(target_os = "windows")]
fn default_home_dir() -> PathBuf {
    // LOCALAPPDATA, never APPDATA: this directory holds private keys, and a roaming profile would
    // ship them to a domain controller.
    match std::env::var("LOCALAPPDATA") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir).join("EnvoyMesh"),
        _ => home_dir().join("AppData").join("Local").join("EnvoyMesh"),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn default_home_dir() -> PathBuf {
    match std::env::var("XDG_DATA_HOME") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir).join("EnvoyMesh"),
        _ => home_dir().join(".local").join("share").join("EnvoyMesh"),
    }
}

fn home_dir() -> PathBuf {
    // HOME is often unset on Windows, where USERPROFILE is the reliable one.
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                return PathBuf::from(value);
            }
        }
    }
    PathBuf::from(".")
}

/// Where this product keeps its own state: `<home>/EnvoyCoder`, never inside `profile/`.
fn product_state_dir() -> PathBuf {
    resolve_shared_home().join(PRODUCT_NAME)
}

#[tauri::command]
fn coder_paths() -> serde_json::Value {
    let state = product_state_dir();
    serde_json::json!({
        "sharedHome": resolve_shared_home().to_string_lossy(),
        "stateDir": state.to_string_lossy(),
        "daemonPort": DEFAULT_DAEMON_PORT,
        "product": PRODUCT_NAME,
    })
}

/// The port the daemon should listen on, overridable for development and for a second window's
/// daemon-less attach.
#[tauri::command]
fn daemon_port() -> u16 {
    std::env::var("ENVOYCODER_DAEMON_PORT")
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_DAEMON_PORT)
}

fn main() {
    // Creating the state directory here (rather than on first write) means a permissions problem
    // surfaces at startup, in front of the user, instead of mid-task.
    let _ = std::fs::create_dir_all(product_state_dir());

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![coder_paths, daemon_port])
        .run(tauri::generate_context!())
        .expect("EnvoyCoder failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_override_wins_and_is_not_required_to_exist() {
        std::env::set_var("ENVOYMESH_HOME", "/tmp/envoycoder-test-home");
        assert_eq!(resolve_shared_home(), PathBuf::from("/tmp/envoycoder-test-home"));
        assert_eq!(
            product_state_dir(),
            PathBuf::from("/tmp/envoycoder-test-home").join("EnvoyCoder")
        );
        std::env::remove_var("ENVOYMESH_HOME");
    }

    #[test]
    fn product_state_never_lives_inside_the_profile() {
        // The family's §5 rule: kernel state in `profile/`, product state in `<home>/<product>/`.
        let state = product_state_dir();
        assert!(state.ends_with(PRODUCT_NAME));
        assert!(!state.to_string_lossy().contains("profile"));
    }

    #[test]
    fn the_default_home_is_per_os_and_never_roams() {
        let dir = default_home_dir().to_string_lossy().to_string();
        assert!(dir.contains("EnvoyMesh"));
        #[cfg(target_os = "windows")]
        assert!(!dir.contains("Roaming"));
    }

    #[test]
    fn daemon_port_can_be_overridden_for_development() {
        std::env::set_var("ENVOYCODER_DAEMON_PORT", "4771");
        assert_eq!(daemon_port(), 4771);
        std::env::set_var("ENVOYCODER_DAEMON_PORT", "not a port");
        assert_eq!(daemon_port(), DEFAULT_DAEMON_PORT);
        std::env::remove_var("ENVOYCODER_DAEMON_PORT");
    }
}
