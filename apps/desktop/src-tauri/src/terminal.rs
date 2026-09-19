//! A terminal tab: a shell in the project folder, with a real pty on Unix.
//!
//! The window draws it (`xterm`). This module owns the process. It is not a daemon method — the
//! shell is the process that can reap it when the app quits, and a shell started in a new session
//! would otherwise outlive us.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

/// One letter, then hex. The window mints these; anything else is refused.
fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && id.len() <= 40
        && chars.all(|c| c.is_ascii_hexdigit())
}

pub struct Sessions {
    inner: Mutex<HashMap<String, Session>>,
}

impl Default for Sessions {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Option<Child>>,
    #[cfg(unix)]
    size_fd: i32,
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                stop_child(&mut child);
            }
        }
        #[cfg(unix)]
        unsafe {
            libc::close(self.size_fd);
        }
    }
}

impl Sessions {
    fn insert(&self, id: String, session: Session) -> Result<(), String> {
        let mut map = self
            .inner
            .lock()
            .map_err(|_| "EnvoyDev's terminals are unusable.".to_string())?;
        if map.contains_key(&id) {
            return Err("This terminal is already open.".into());
        }
        map.insert(id, session);
        Ok(())
    }

    fn close_one(&self, id: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(id);
        }
    }

    pub fn close_all(&self) {
        if let Ok(mut map) = self.inner.lock() {
            map.clear();
        }
    }
}

/// Kill every terminal. Called on the same path that stops the daemon, so quitting the app does
/// not leave shells behind. A shell we `setsid` would not die with us otherwise.
pub fn shutdown(app: &AppHandle) {
    if let Some(sessions) = app.try_state::<Sessions>() {
        sessions.close_all();
    }
}

#[derive(Clone, Serialize)]
struct Output {
    id: String,
    data: String,
}

#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    window: WebviewWindow,
    sessions: State<'_, Sessions>,
    id: String,
    cwd: String,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("This terminal cannot be opened.".into());
    }
    let cwd = folder(&cwd)?;
    let pty = open_pty(&cwd)?;
    let label = window.label().to_string();
    let read_id = id.clone();
    let mut reader = pty.reader;
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit_to(
                        &label,
                        "terminal-output",
                        Output {
                            id: read_id.clone(),
                            data,
                        },
                    );
                }
                Err(error) => {
                    #[cfg(unix)]
                    if error.raw_os_error() == Some(libc::EIO) {
                        break;
                    }
                    let _ = error;
                    break;
                }
            }
        }
    });
    sessions.insert(
        id,
        Session {
            writer: Mutex::new(pty.writer),
            child: Mutex::new(Some(pty.child)),
            #[cfg(unix)]
            size_fd: pty.size_fd,
        },
    )
}

#[tauri::command]
pub fn terminal_write(sessions: State<'_, Sessions>, id: String, data: String) -> Result<(), String> {
    if data.len() > 64 * 1024 {
        return Err("That is too much to send at once.".into());
    }
    let map = sessions
        .inner
        .lock()
        .map_err(|_| "EnvoyDev's terminals are unusable.".to_string())?;
    let session = map.get(&id).ok_or("This terminal is already closed.")?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "This terminal is already closed.".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|_| "This terminal is already closed.".to_string())?;
    let _ = writer.flush();
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(sessions: State<'_, Sessions>, id: String, rows: u16, cols: u16) -> Result<(), String> {
    let rows = rows.clamp(1, 500);
    let cols = cols.clamp(1, 500);
    let map = sessions
        .inner
        .lock()
        .map_err(|_| "EnvoyDev's terminals are unusable.".to_string())?;
    let session = map.get(&id).ok_or("This terminal is already closed.")?;
    #[cfg(unix)]
    {
        set_size(session.size_fd, rows, cols)?;
    }
    #[cfg(not(unix))]
    {
        let _ = (session, rows, cols);
    }
    Ok(())
}

#[tauri::command]
pub fn terminal_close(sessions: State<'_, Sessions>, id: String) -> Result<(), String> {
    sessions.close_one(&id);
    Ok(())
}

fn folder(cwd: &str) -> Result<PathBuf, String> {
    let path = Path::new(cwd);
    if !path.is_absolute() {
        return Err("That folder is not on this computer.".into());
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| "That folder is not on this computer.".to_string())?;
    if !canonical.is_dir() {
        return Err("That folder is not on this computer.".into());
    }
    Ok(canonical)
}

struct Pty {
    writer: Box<dyn Write + Send>,
    reader: Box<dyn Read + Send>,
    child: Child,
    #[cfg(unix)]
    size_fd: i32,
}

#[cfg(unix)]
fn open_pty(cwd: &Path) -> Result<Pty, String> {
    let shell = shell_path()?;
    let mut master: libc::c_int = -1;
    let mut slave: libc::c_int = -1;
    let opened = unsafe {
        libc::openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if opened != 0 || master < 0 || slave < 0 {
        return Err("Could not open a terminal on this computer.".into());
    }
    // Close-on-exec before any dup: the child must not inherit the master, or the pty never
    // signals that the shell has exited. `Command` clears the flag on the three stdio dups.
    unsafe {
        libc::fcntl(master, libc::F_SETFD, libc::FD_CLOEXEC);
        libc::fcntl(slave, libc::F_SETFD, libc::FD_CLOEXEC);
    }
    let master = OwnedFd(master);
    let slave = OwnedFd(slave);
    let _ = set_size(master.0, 24, 80);

    let stdin = dup_stdio(&slave)?;
    let stdout = dup_stdio(&slave)?;
    let stderr = dup_stdio(&slave)?;
    let writer = master.dup()?.into_file();
    let size_fd = master.dup()?.into_raw();
    let reader = master.into_file();
    let slave_fd = slave.0;

    let mut command = Command::new(&shell);
    command
        .current_dir(cwd)
        .env("TERM", "xterm-256color")
        .stdin(stdin)
        .stdout(stdout)
        .stderr(stderr);
    // The child must be the session leader or the shell has no controlling terminal: no prompt,
    // no job control, and programs like `vim` refuse to start.
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(move || {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::ioctl(slave_fd, libc::TIOCSCTTY as libc::c_ulong, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            // The stdio dups are the shell's terminal. This extra copy must not survive exec.
            libc::close(slave_fd);
            Ok(())
        });
    }
    let child = command.spawn().map_err(|_| "Could not start a shell in that folder.".to_string())?;
    // The child has its own copy. Ours would keep the pty open after the shell exits.
    drop(slave);
    Ok(Pty {
        writer: Box::new(writer),
        reader: Box::new(reader),
        child,
        size_fd,
    })
}

#[cfg(unix)]
fn shell_path() -> Result<PathBuf, String> {
    if let Ok(shell) = std::env::var("SHELL") {
        let path = PathBuf::from(&shell);
        if path.is_absolute() && path.is_file() {
            return Ok(path);
        }
    }
    for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let path = Path::new(candidate);
        if path.is_file() {
            return Ok(path.to_path_buf());
        }
    }
    Err("No shell was found on this computer.".into())
}

#[cfg(unix)]
fn set_size(fd: i32, rows: u16, cols: u16) -> Result<(), String> {
    let size = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    let rc = unsafe { libc::ioctl(fd, libc::TIOCSWINSZ as libc::c_ulong, &size) };
    if rc == -1 {
        return Err("Could not resize the terminal.".into());
    }
    Ok(())
}

#[cfg(unix)]
fn dup_stdio(fd: &OwnedFd) -> Result<Stdio, String> {
    use std::os::unix::io::FromRawFd;
    let dup = fd.dup()?;
    Ok(unsafe { Stdio::from_raw_fd(dup.into_raw()) })
}

#[cfg(unix)]
struct OwnedFd(i32);

#[cfg(unix)]
impl Drop for OwnedFd {
    fn drop(&mut self) {
        if self.0 >= 0 {
            unsafe { libc::close(self.0) };
            self.0 = -1;
        }
    }
}

#[cfg(unix)]
impl OwnedFd {
    fn dup(&self) -> Result<OwnedFd, String> {
        let fd = unsafe { libc::dup(self.0) };
        if fd < 0 {
            return Err("Could not open a terminal on this computer.".into());
        }
        Ok(OwnedFd(fd))
    }

    fn into_raw(mut self) -> i32 {
        let fd = self.0;
        self.0 = -1;
        fd
    }

    fn into_file(self) -> std::fs::File {
        use std::os::unix::io::FromRawFd;
        let fd = self.into_raw();
        unsafe { std::fs::File::from_raw_fd(fd) }
    }
}

#[cfg(unix)]
fn stop_child(child: &mut Child) {
    let pid = child.id() as i32;
    unsafe {
        libc::kill(-pid, libc::SIGHUP);
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(windows)]
fn open_pty(cwd: &Path) -> Result<Pty, String> {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW: the pipe is the terminal. A console window beside the app is not a tab.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut child = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoExit"])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|_| "Could not start a shell in that folder.".to_string())?;
    let writer = child
        .stdin
        .take()
        .ok_or("Could not start a shell in that folder.")?;
    let reader = child
        .stdout
        .take()
        .ok_or("Could not start a shell in that folder.")?;
    Ok(Pty {
        writer: Box::new(writer),
        reader: Box::new(reader),
        child,
    })
}

#[cfg(windows)]
fn stop_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn a_shell_runs_in_the_folder() {
        let mut pty = open_pty(&std::env::temp_dir()).expect("pty");
        pty.writer
            .write_all(b"echo $((40+2))\n")
            .expect("write");
        let _ = pty.writer.flush();
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let mut reader = pty.reader;
        let handle = thread::spawn(move || {
            let mut buf = [0u8; 1024];
            let mut acc = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        acc.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&acc).into_owned();
                        let done = text.contains("42");
                        let _ = tx.send(text);
                        if done {
                            break;
                        }
                    }
                }
            }
        });
        let deadline = Instant::now() + Duration::from_secs(4);
        let mut last = String::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(text) => {
                    last = text;
                    if last.contains('4') && last.contains("42") {
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        stop_child(&mut pty.child);
        let _ = handle.join();
        assert!(
            last.contains("42"),
            "the shell did not run the command, it said: {last:?}"
        );
    }
}
