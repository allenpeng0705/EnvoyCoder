//! A browser tab: a child webview, not an iframe.
//!
//! An iframe cannot show most sites (they refuse to be framed) and the window's CSP would block
//! it anyway. `Window::add_child` is the shell's own page, positioned over the slot the tab row
//! measured. Pop-ups are refused, and only `http`/`https` navigate.
//!
//! Closing the tab has to take the page off the window before destroying it. `close` by itself
//! drops the handle from the manager immediately, and on macOS the native view can stay where it
//! was — covering the window and eating every click. A resize that was already in flight would
//! also call `show` again after that. Hide and shrink first, remember the tab is gone, and ignore
//! a later show.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use tauri::webview::WebviewBuilder;
use tauri::{LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl, WebviewWindow};

fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase() && id.len() <= 40 && chars.all(|c| c.is_ascii_hexdigit())
}

fn label_for(id: &str) -> Result<String, String> {
    if !valid_id(id) {
        return Err("This browser tab cannot be opened.".into());
    }
    Ok(format!("browser-{id}"))
}

fn page(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "That is not a web address.".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err("That is not a web address.".into()),
    }
}

fn host(window: &WebviewWindow) -> tauri::Window {
    window.as_ref().window()
}

/// Open browser tabs, and the ones the window has already closed.
///
/// A close and a resize can be in flight together. The resize must not put a closed page back.
pub struct Pages {
    inner: Mutex<Book>,
}

struct Book {
    open: HashMap<String, Webview>,
    gone: HashSet<String>,
}

impl Default for Pages {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Book {
                open: HashMap::new(),
                gone: HashSet::new(),
            }),
        }
    }
}

fn lock(pages: &Pages) -> Result<std::sync::MutexGuard<'_, Book>, String> {
    pages
        .inner
        .lock()
        .map_err(|_| "Could not reach that browser.".to_string())
}

/// Off the window first. `close` alone can leave the page up and still clickable.
fn dismiss(webview: &Webview) {
    let _ = webview.hide();
    let _ = webview.set_position(LogicalPosition::new(-10_000.0, -10_000.0));
    let _ = webview.set_size(LogicalSize::new(0.0, 0.0));
    let _ = webview.close();
}

fn collect(window: &WebviewWindow, book: &mut Book, label: &str) -> Vec<Webview> {
    let mut found = Vec::new();
    if let Some(webview) = book.open.remove(label) {
        found.push(webview);
    }
    if let Some(webview) = window.get_webview(label) {
        found.push(webview);
    }
    for webview in host(window).webviews() {
        if webview.label() == label {
            found.push(webview);
        }
    }
    found
}

/// Async on purpose: creating a webview from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn browser_open(
    window: WebviewWindow,
    pages: tauri::State<'_, Pages>,
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = label_for(&id)?;
    let url = page(&url)?;
    {
        let mut book = lock(&pages)?;
        if book.gone.contains(&label) {
            for webview in collect(&window, &mut book, &label) {
                dismiss(&webview);
            }
            return Ok(());
        }
    }
    let parent = host(&window);
    if let Some(existing) = window.get_webview(&label) {
        if lock(&pages)?.gone.contains(&label) {
            dismiss(&existing);
            return Ok(());
        }
        existing
            .navigate(url)
            .map_err(|_| "Could not open that page.".to_string())?;
        place(&existing, x, y, width, height, true)?;
        let mut book = lock(&pages)?;
        if book.gone.contains(&label) {
            dismiss(&existing);
            return Ok(());
        }
        book.open.insert(label, existing);
        return Ok(());
    }
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_navigation(|next| matches!(next.scheme(), "http" | "https"))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    let webview = parent
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|_| "Could not open a browser tab.".to_string())?;
    let mut book = lock(&pages)?;
    if book.gone.contains(&label) {
        dismiss(&webview);
        return Ok(());
    }
    let _ = webview.show();
    book.open.insert(label, webview);
    Ok(())
}

#[tauri::command]
pub async fn browser_frame(
    window: WebviewWindow,
    pages: tauri::State<'_, Pages>,
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let label = label_for(&id)?;
    let mut book = lock(&pages)?;
    if book.gone.contains(&label) {
        for webview in collect(&window, &mut book, &label) {
            dismiss(&webview);
        }
        return Ok(());
    }
    let webview = book
        .open
        .get(&label)
        .cloned()
        .or_else(|| window.get_webview(&label));
    let Some(webview) = webview else {
        return Ok(());
    };
    if !visible {
        let _ = webview.hide();
        return Ok(());
    }
    place(&webview, x, y, width, height, true)
}

#[tauri::command]
pub async fn browser_navigate(
    window: WebviewWindow,
    pages: tauri::State<'_, Pages>,
    id: String,
    url: String,
) -> Result<(), String> {
    let label = label_for(&id)?;
    let url = page(&url)?;
    let book = lock(&pages)?;
    if book.gone.contains(&label) {
        return Err("This browser tab is already closed.".into());
    }
    let Some(webview) = book
        .open
        .get(&label)
        .cloned()
        .or_else(|| window.get_webview(&label))
    else {
        return Err("This browser tab is already closed.".into());
    };
    drop(book);
    webview
        .navigate(url)
        .map_err(|_| "Could not open that page.".to_string())
}

#[tauri::command]
pub async fn browser_close(
    window: WebviewWindow,
    pages: tauri::State<'_, Pages>,
    id: String,
) -> Result<(), String> {
    let label = label_for(&id)?;
    let mut book = lock(&pages)?;
    book.gone.insert(label.clone());
    for webview in collect(&window, &mut book, &label) {
        dismiss(&webview);
    }
    Ok(())
}

fn place(
    webview: &Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    if !visible || width < 1.0 || height < 1.0 {
        let _ = webview.hide();
        return Ok(());
    }
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|_| "Could not move the browser.".to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|_| "Could not resize the browser.".to_string())?;
    webview
        .show()
        .map_err(|_| "Could not show the browser.".to_string())
}
