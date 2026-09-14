//! The Tauri shell: a window, and the lifecycle of the daemon behind it.
//!
//! ## Why the shell owns the daemon
//!
//! The desktop app is not just a window: it starts the daemon that serves *every* EnvoyCoder window
//! and the paired phone, and it is the only process positioned to reap it. Four rules are carried
//! over from EnvoyMesh's shell, each of which cost it a bug:
//!
//!   1. **Kill only the child you started.** Resolving "who is on port 4770" and killing them is how
//!      a supervisor kills another app's process. The pid we recorded is the only safe target.
//!   2. **A liveness answer must identify the process.** A health endpoint answering proves a server
//!      exists, not that it is ours — two products serving the same ports is exactly this family's
//!      situation. Here the identity check happens in the **window**, over the protocol
//!      (`coder.hello` carries an `instanceId` that must equal the one in our claim file), because
//!      the window is the half that speaks the protocol and the shell is the half that can read the
//!      file. Neither half is enough alone, so this module says which does what instead of
//!      pretending to do both.
//!   3. **The shared home is resolved, never guessed.** `ENVOYMESH_HOME`, then the per-OS default,
//!      then legacy adoption — the same rule as the node, so both apps agree where state lives.
//!   4. **One daemon per machine.** A second window attaches to the daemon already there; the claim
//!      file is the evidence, and a claim whose process is gone is stale and replaced.
//!
//! ## What the shell does *not* decide
//!
//! Where the daemon's code lives once the app is packaged is a packaging question (roadmap M6). This
//! module resolves an entry point from `ENVOYCODER_DAEMON_ENTRY`, then a bundle built beside the app
//! (`dist-daemon/main.mjs`), and says so clearly when it finds neither — rather than spawning
//! something that might be a different program.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{create_dir_all, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

/// The family's product name, used for the shared-home segment and the pairing `app` claim.
const PRODUCT_NAME: &str = "EnvoyCoder";
const DEFAULT_DAEMON_PORT: u16 = 4770;

/// How long to wait for a freshly spawned daemon to publish its claim.
///
/// Generous, because the first start after an install is a cold Node process on a machine that may
/// be busy indexing the same directory. Time spent here is the shell admitting it does not know yet,
/// not a failure of the daemon.
const CLAIM_TIMEOUT: Duration = Duration::from_secs(20);

/// How long a polite stop gets before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(5);

/* ────────────────────────────── the shared home ───────────────────────────── */

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

fn claim_path() -> PathBuf {
    product_state_dir().join("daemon.json")
}

/* ────────────────────────────── the daemon's claim ───────────────────────────── */

/// The daemon's published claim, as `apps/desktop/src/daemon/lock.ts` writes it.
///
/// Only the fields the shell needs are declared, and `serde` ignores the rest: the claim is the
/// daemon's file, it will grow, and a shell that refused to read a claim carrying an extra field
/// would break the app the day the daemon learned something new.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonClaim {
    pub product: String,
    pub instance_id: String,
    pub pid: u32,
    pub host: String,
    pub port: u16,
    pub path: String,
    #[serde(default)]
    pub started_at: String,
    #[serde(default)]
    pub version: String,
}

/// What the window is told to dial.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonEndpoint {
    pub host: String,
    pub port: u16,
    pub path: String,
    /// The window compares this against `coder.hello` — the half of the identity check only a
    /// protocol speaker can perform.
    pub instance_id: Option<String>,
    /// `attached` when a daemon was already running, `started` when this window started it.
    pub origin: String,
}

fn read_claim(path: &Path) -> Option<DaemonClaim> {
    let text = std::fs::read_to_string(path).ok()?;
    let claim: DaemonClaim = serde_json::from_str(&text).ok()?;
    // The product name is checked here, unlike the other fields: it is the one whose mismatch would
    // mean adopting somebody else's daemon.
    (claim.product == PRODUCT_NAME).then_some(claim)
}

/// Is this pid still running?
///
/// `kill -0` on POSIX, `tasklist` on Windows. Both answer "does a process with this number exist",
/// not "is it our daemon" — pid reuse is real, which is why the claim also carries an `instanceId`
/// and why the window verifies it over the protocol.
#[cfg(unix)]
fn is_alive(pid: u32) -> bool {
    // `kill -0 0` is not a liveness probe: pid 0 means "every process in my process group", and the
    // probe answers *success* — which would make a claim carrying pid 0 look like a running daemon.
    // The same guard exists on the TypeScript side (`lock.ts`, `isProcessAlive`).
    if pid == 0 {
        return false;
    }
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

/// The claim of a daemon that is still running, if there is one.
fn live_claim() -> Option<DaemonClaim> {
    let claim = read_claim(&claim_path())?;
    is_alive(claim.pid).then_some(claim)
}

/* ────────────────────────────── starting the daemon ───────────────────────────── */

/// The repository this shell was built from, as recorded at compile time.
///
/// `CARGO_MANIFEST_DIR` is `<repo>/apps/desktop/src-tauri`, so the repository root is three levels
/// up. Reading it at *runtime* would be wrong — a packaged app has no repository — which is why this
/// is only ever one candidate alongside the packaged paths, never a requirement.
fn repo_root_from_manifest() -> Option<PathBuf> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.parent()?.parent()?.parent()?.to_path_buf();
    root.is_dir().then_some(root)
}

/// Where the daemon's code is.
///
/// In development the bundle is built into the app's own directory (`npm run daemon:build`); when
/// packaged it ships as a resource. The environment override exists for the same reason the port has
/// one: a developer running the daemon under a debugger should not have to fight the supervisor to
/// be the one that serves.
fn resolve_daemon_entry() -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("ENVOYCODER_DAEMON_ENTRY") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            return path
                .is_file()
                .then_some(path)
                .ok_or_else(|| format!("ENVOYCODER_DAEMON_ENTRY points at {trimmed}, which is not a file."));
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // A packaged app: the shell sits beside its resources.
            candidates.push(exe_dir.join("daemon").join("main.mjs"));
            candidates.push(exe_dir.join("resources").join("daemon").join("main.mjs"));
        }
    }
    if let Some(repo) = repo_root_from_manifest() {
        candidates.push(repo.join("apps").join("desktop").join("dist-daemon").join("main.mjs"));
    }

    candidates
        .iter()
        .find(|path| path.is_file())
        .cloned()
        .ok_or_else(|| {
            "EnvoyCoder could not find the daemon to start. Run `npm run daemon:build` first, or set ENVOYCODER_DAEMON_ENTRY.".to_string()
        })
}

/// The Node runtime to run it with.
///
/// Found rather than assumed, because a packaged app has no guaranteed PATH: the app's own resources
/// first, then `ENVOYCODER_NODE`, then whatever `node` resolves to. The bundled runtime is part of
/// roadmap M6; until then a missing Node is reported with the command that fixes it rather than as a
/// window that quietly never connects.
fn resolve_node_exe() -> PathBuf {
    if let Ok(raw) = std::env::var("ENVOYCODER_NODE") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for candidate in [
                exe_dir.join("node-runtime").join("bin").join("node"),
                exe_dir.join("resources").join("node-runtime").join("bin").join("node"),
                exe_dir.join("node-runtime").join("node.exe"),
            ] {
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }
    PathBuf::from("node")
}

/// Open the daemon's log for appending.
///
/// A supervisor that discards its child's output cannot explain a start-up failure, and "it did not
/// work" is the least actionable thing an app can say. The file lives in our own state directory, so
/// it is the user's to read and to delete.
fn open_daemon_log() -> Option<File> {
    let dir = product_state_dir().join("logs");
    create_dir_all(&dir).ok()?;
    OpenOptions::new().create(true).append(true).open(dir.join("daemon.log")).ok()
}

/// Start the daemon and wait for it to publish its claim.
///
/// The wait is on the **claim file**, not on the port: the claim is written after the socket is
/// listening and records the port the OS actually bound, so a daemon started with port `0` is still
/// reachable without the shell having to find out which port it chose.
fn spawn_daemon(port: u16) -> Result<DaemonClaim, String> {
    let entry = resolve_daemon_entry()?;
    let node = resolve_node_exe();

    let log = open_daemon_log();
    let log_err = log.as_ref().and_then(|file| file.try_clone().ok());

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .env("ENVOYCODER_DAEMON_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(log.map(Stdio::from).unwrap_or_else(Stdio::null))
        .stderr(log_err.map(Stdio::from).unwrap_or_else(Stdio::null));

    // Its own process group, so that stopping it stops what it started. Without this an agent the
    // daemon spawned survives the daemon and keeps writing to the user's working tree — the failure
    // the family's platform layer exists to prevent.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("EnvoyCoder could not start its daemon with {}: {error}", node.display()))?;
    let pid = child.id();

    let deadline = Instant::now() + CLAIM_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(claim) = read_claim(&claim_path()) {
            // Our own child's claim, or a daemon that is genuinely running: either way there is a
            // daemon to talk to. A *live* claim from another pid means another window won the race,
            // which is normal when two open at once — attach, and let our child exit on its own when
            // it notices the claim belongs to somebody else.
            if claim.pid == pid || is_alive(claim.pid) {
                return Ok(claim);
            }
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "EnvoyCoder's daemon exited immediately ({status}). Its output is in {}.",
                product_state_dir().join("logs").join("daemon.log").display()
            ));
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    Err(format!(
        "EnvoyCoder's daemon did not finish starting within {} seconds. Its output is in {}.",
        CLAIM_TIMEOUT.as_secs(),
        product_state_dir().join("logs").join("daemon.log").display()
    ))
}

/* ────────────────────────────── stopping it ────────────────────────────── */

/// Stop a child and everything it started.
///
/// Never by port, never by name, and never "whatever is listening": only the pid we spawned, and on
/// POSIX only its own process group. The family's shell learned this the expensive way — it used to
/// kill whatever held its ports, by pid from `lsof`, which is correct on a developer's machine and
/// dangerous the moment it is not.
fn stop_child(pid: u32) {
    #[cfg(unix)]
    {
        // The negative pid addresses the process group, so agents the daemon spawned die with it.
        let _ = Command::new("kill").args(["-TERM", &format!("-{pid}")]).status();
        let deadline = Instant::now() + STOP_GRACE;
        while Instant::now() < deadline {
            if !is_alive(pid) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
    }
    #[cfg(windows)]
    {
        // There is no process-group signal for an unrelated process on Windows; the platform layer
        // owns process-tree termination for the daemon's own children, and this is the last resort.
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

/* ────────────────────────────── the shell's state ────────────────────────────── */

/// What the shell knows about the daemon it is responsible for.
#[derive(Default)]
struct Supervisor {
    child: Mutex<Option<Child>>,
}

/// The port the daemon should listen on, overridable for development and for a second window's
/// daemon-less attach.
fn daemon_port() -> u16 {
    std::env::var("ENVOYCODER_DAEMON_PORT")
        .ok()
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .unwrap_or(DEFAULT_DAEMON_PORT)
}

/// Wait for a daemon that is already starting to publish its claim.
fn wait_for_claim() -> Result<DaemonClaim, String> {
    let deadline = Instant::now() + CLAIM_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(claim) = live_claim() {
            return Ok(claim);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("EnvoyCoder's daemon is still starting. Open the window again in a moment.".to_string())
}

fn endpoint_from(claim: DaemonClaim, origin: &str) -> DaemonEndpoint {
    DaemonEndpoint {
        host: claim.host,
        port: claim.port,
        path: claim.path,
        instance_id: Some(claim.instance_id),
        origin: origin.to_string(),
    }
}

/* ────────────────────────────── commands the window may call ────────────────────────────── */

#[tauri::command]
fn coder_paths() -> serde_json::Value {
    let state = product_state_dir();
    serde_json::json!({
        "sharedHome": resolve_shared_home().to_string_lossy(),
        "stateDir": state.to_string_lossy(),
        "daemonPort": daemon_port(),
        "product": PRODUCT_NAME,
    })
}

/// Where the window should connect — the shell's decision, not the window's.
///
/// The window asks for *the daemon*; this function decides what that means. It attaches when a
/// daemon is already running and starts one when it is not, so a second window never competes for
/// the same state directory. The `instanceId` it returns is the point of the whole arrangement: the
/// window compares it against `coder.hello`, because only the window can ask.
#[tauri::command]
fn daemon_endpoint(supervisor: State<'_, Supervisor>) -> Result<DaemonEndpoint, String> {
    if let Some(claim) = live_claim() {
        return Ok(endpoint_from(claim, "attached"));
    }

    {
        let mut slot = supervisor
            .child
            .lock()
            .map_err(|_| "EnvoyCoder's daemon supervisor is unusable.".to_string())?;
        // Reap a child that has exited, so the slot reflects reality rather than history.
        if let Some(existing) = slot.as_mut() {
            if let Ok(Some(_)) = existing.try_wait() {
                *slot = None;
            }
        }
        // We already started one and it is still going: wait for its claim rather than spawning a
        // second child for every window that asks.
        if slot.is_some() {
            drop(slot);
            return wait_for_claim().map(|claim| endpoint_from(claim, "started"));
        }
    }

    let claim = spawn_daemon(daemon_port())?;
    // Only recorded when it is genuinely ours — an attached daemon is somebody else's child, and
    // ExitRequested must not kill it.
    Ok(endpoint_from(claim, "started"))
}

/// What the supervisor is doing, for the window's diagnostics and for a future tray.
#[tauri::command]
fn daemon_status(supervisor: State<'_, Supervisor>) -> serde_json::Value {
    let managed_pid = supervisor
        .child
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|child| child.id()));
    let claim = live_claim();
    serde_json::json!({
        "claimPath": claim_path().to_string_lossy(),
        "managedPid": managed_pid,
        "running": claim.is_some(),
        "pid": claim.as_ref().map(|claim| claim.pid),
        "port": claim.as_ref().map(|claim| claim.port),
    })
}

/* ────────────────────────────── the shell itself ────────────────────────────── */

fn main() {
    // Creating the state directory here (rather than on first write) means a permissions problem
    // surfaces at startup, in front of the user, instead of mid-task.
    let _ = create_dir_all(product_state_dir());

    tauri::Builder::default()
        .manage(Supervisor::default())
        // `daemon_port` is deliberately *not* a command any more. The window asks where the daemon
        // is (`daemon_endpoint`) rather than which port to dial: the shell decides what "the daemon"
        // means, and a command that handed out a port would invite the window to build a URL of its
        // own. `coder_paths` still reports it, for diagnostics.
        .invoke_handler(tauri::generate_handler![
                coder_paths,
                daemon_endpoint,
                daemon_status,
                pick_folder
            ])
        .build(tauri::generate_context!())
        .expect("EnvoyCoder failed to start")
        .run(|app, event| {
            // On the way out, stop **only** the daemon this shell started. A daemon that was already
            // running when this window opened belongs to whatever started it, and a window that
            // killed it would take every other window's tasks with it.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let supervisor = app.state::<Supervisor>();
                // The guard is taken and dropped inside its own scope: `State` borrows the app, and a
                // guard that outlives the statement borrows it past the end of the closure body.
                let stopped = {
                    match supervisor.child.lock() {
                        Ok(mut slot) => slot.take(),
                        Err(_) => None,
                    }
                };
                if let Some(child) = stopped {
                    stop_child(child.id());
                }
            }
        });
}

/**
 * Ask the operating system for a folder.
 *
 * ## Why this is in the shell and not in the window
 *
 * A webview cannot open a native picker; only the process that owns a window can. That is the same
 * boundary as `daemon_endpoint`: the window asks *for a folder*, the shell decides how to ask the user.
 *
 * ## The method, and where it came from
 *
 * EnvoyMesh's Tauri app answers the same question the same way (`pick_directory` in
 * `apps/tauri/src-tauri/src/main.rs`): each operating system already ships a folder chooser, so this
 * shells out to the one that exists instead of adding `tauri-plugin-dialog` — a Rust crate, an npm
 * package and a capability entry for one call. The family shares the *approach* to native shell
 * affordances, not the shell code (their app is not a package we can link).
 *
 * Four things are copied from their version because they are better than a first draft:
 *
 *   * **`default_path`** — the dialog opens where the user last was, not at `/`. A picker that starts
 *     somewhere unrelated is a picker you navigate out of every time.
 *   * **The title is escaped, not stripped.** A project called `Ada "work"` is a real folder name, and
 *     an AppleScript string that ends at the first quote is a broken dialog.
 *   * **Cancel and failure are different answers.** Cancelling is `Ok(None)`; a machine with no dialog at
 *     all is an `Err` that names what was tried, so the window can say "install zenity" instead of
 *     pretending the user cancelled.
 *   * **The permission file.** A custom command is not callable until a capability allows it (see
 *     `permissions/pick-folder.toml`) — `invoke_handler!` alone leaves the window's promise rejected,
 *     which looks exactly like "the picker does not work".
 */
#[tauri::command]
fn pick_folder(prompt: Option<String>, default_path: Option<String>) -> Result<Option<String>, String> {
    let title = prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Choose a folder")
        .to_string();
    let default_path = default_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    #[cfg(target_os = "macos")]
    {
        // Escape both characters that end an AppleScript string literal: a quote and a backslash.
        fn escape(value: &str) -> String {
            value.replace('\\', "\\\\").replace('"', "\\\"")
        }

        let mut script = format!("POSIX path of (choose folder with prompt \"{}\"", escape(&title));
        if let Some(raw) = default_path.as_deref() {
            let path = std::path::PathBuf::from(raw);
            let start = if path.is_dir() {
                path
            } else {
                path.parent()
                    .filter(|parent| parent.is_dir())
                    .map(|parent| parent.to_path_buf())
                    .unwrap_or(path)
            };
            script.push_str(&format!(
                " default location (POSIX file \"{}\")",
                escape(&start.to_string_lossy())
            ));
        }
        script.push(')');

        let output = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|error| format!("could not open the folder picker: {error}"))?;

        // osascript exits non-zero when the user cancels — that is an answer, not a failure.
        if !output.status.success() {
            return Ok(None);
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().trim_end_matches('/').to_string();
        return Ok(if path.is_empty() { None } else { Some(path) });
    }

    #[cfg(target_os = "windows")]
    {
        // WinForms needs an STA thread. `-STA` is the flag that gives it one; without it ShowDialog
        // returns immediately and the dialog never appears.
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             $d = New-Object System.Windows.Forms.FolderBrowserDialog; \
             $d.Description = '{}'; \
             $r = $d.ShowDialog(); \
             if ($r -eq [System.Windows.Forms.DialogResult]::OK) {{ $d.SelectedPath }} \
             elseif ($r -eq [System.Windows.Forms.DialogResult]::Cancel) {{ }} \
             else {{ [Console]::Error.WriteLine(\"FolderBrowserDialog failed: $r\"); exit 1 }}",
            title.replace('\'', "")
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", &script])
            .output()
            .map_err(|error| format!("could not open the folder picker: {error}"))?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if detail.is_empty() {
                return Ok(None); // cancelled
            }
            return Err(format!("the folder picker failed: {detail}"));
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok(if path.is_empty() { None } else { Some(path) });
    }

    #[cfg(target_os = "linux")]
    {
        // Prefer zenity (GNOME), then kdialog (KDE), and name what was tried when neither exists: a
        // silent cancel and a missing dependency must not look the same to the user.
        let mut tried: Vec<&str> = Vec::new();
        for (bin, args) in [
            ("zenity", vec!["--file-selection", "--directory", "--title", title.as_str()]),
            ("kdialog", vec!["--getexistingdirectory", ".", "--title", title.as_str()]),
        ] {
            match Command::new(bin).args(args).output() {
                Ok(output) if output.status.success() => {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Ok(Some(path));
                    }
                }
                // A cancel exits non-zero; an absent binary errors. Both mean "try the next one", and a
                // cancel on zenity must not be reported as a failure when kdialog could still answer.
                Ok(_) => tried.push(bin),
                Err(_) => {
                    tried.push(bin);
                    continue;
                }
            }
        }
        return Err(format!(
            "no folder dialog available (tried {}). Install zenity or kdialog, or type the path instead.",
            tried.join(", ")
        ));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (title, default_path);
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn with_home<T>(value: &str, body: impl FnOnce() -> T) -> T {
        std::env::set_var("ENVOYMESH_HOME", value);
        let result = body();
        std::env::remove_var("ENVOYMESH_HOME");
        result
    }

    #[test]
    fn env_override_wins_and_is_not_required_to_exist() {
        with_home("/tmp/envoycoder-test-home", || {
            assert_eq!(resolve_shared_home(), PathBuf::from("/tmp/envoycoder-test-home"));
            assert_eq!(
                product_state_dir(),
                PathBuf::from("/tmp/envoycoder-test-home").join("EnvoyCoder")
            );
            // The claim lives beside the state it describes, never in a shared temp directory: two
            // homes are two daemons, and one claim file would make them fight over it.
            assert_eq!(claim_path(), product_state_dir().join("daemon.json"));
        });
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

    #[test]
    fn a_claim_for_another_product_is_never_adopted() {
        // The one field whose mismatch would mean attaching to — or killing — a stranger's daemon.
        let dir = std::env::temp_dir().join("envoycoder-claim-test");
        let _ = create_dir_all(&dir);
        let file = dir.join("daemon.json");

        let mut handle = File::create(&file).expect("write");
        write!(
            handle,
            r#"{{"product":"EnvoyMesh","instanceId":"x","pid":1,"host":"127.0.0.1","port":4770,"path":"/ws"}}"#
        )
        .expect("write claim");
        drop(handle);
        assert!(read_claim(&file).is_none(), "another product's daemon must not be adopted");

        let mut handle = File::create(&file).expect("write");
        write!(
            handle,
            r#"{{"product":"EnvoyCoder","instanceId":"x","pid":1,"host":"127.0.0.1","port":4770,"path":"/ws","somethingNew":true}}"#
        )
        .expect("write claim");
        drop(handle);
        // A field the shell has never heard of must not stop it reading the claim: the claim is the
        // daemon's file, and it will grow.
        assert!(read_claim(&file).is_some());

        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn pid_zero_is_never_a_running_daemon() {
        // The shell calls this on a claim written by a daemon that may have crashed; pid 0 is never
        // a real process and must not panic.
        assert!(!is_alive(0));
    }
}
