//! Desktop shell for the Match Feed web client (shipped as Meme Video).
//!
//! The Rust side does three things and nothing else:
//! - serves the synced web build (`www/`, see scripts/sync-web.mjs) under Tauri's app protocol;
//! - stores two named secrets in the OS keychain (`secret_get`, `secret_set`, `secret_remove`);
//! - keeps the main window on the app origin or https (no file:, data:, javascript: navigation).
//!
//! No plugins are compiled in: no shell, opener, filesystem, HTTP, notification or updater.
//! Auto-update is deliberately absent (docs/SHIPPING.md, "Desktop"); turning it on later means
//! adding tauri-plugin-updater with a minisign public key and signed release artifacts only.

mod secrets;

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Navigation allowed for the main window and its frames: the app's own origin
/// (tauri://localhost on macOS/Linux, http(s)://tauri.localhost on Windows) and https pages.
/// WebKitGTK reports iframe navigations through the same hook, so https stays allowed for the
/// PeerTube embeds; those origins get no IPC (capabilities cover local windows only).
fn navigation_allowed(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "https" => true,
        "about" => url.as_str() == "about:blank" || url.as_str() == "about:srcdoc",
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_remove
        ])
        .setup(|app| {
            // No keychain (e.g. no Secret Service on a minimal Linux desktop) is not fatal: the
            // secret commands then return an error and the web app keeps its IndexedDB key.
            if let Err(e) = secrets::init_store() {
                eprintln!("OS keychain unavailable: {e}");
            }
            let title = app.config().product_name.clone().unwrap_or_else(|| "Meme Video".into());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title(title)
                .inner_size(1200.0, 820.0)
                .min_inner_size(380.0, 560.0)
                .on_navigation(navigation_allowed)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the application");
}

#[cfg(test)]
mod tests {
    use super::navigation_allowed;

    fn ok(s: &str) -> bool {
        navigation_allowed(&tauri::Url::parse(s).unwrap())
    }

    #[test]
    fn navigation_policy() {
        assert!(ok("tauri://localhost/index.html"));
        assert!(ok("http://tauri.localhost/index.html"));
        assert!(ok("https://framatube.org/videos/embed/abc?p2p=0"));
        assert!(!ok("tauri://evil/index.html"));
        assert!(!ok("http://example.com/"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!ok("data:text/html,<script>alert(1)</script>"));
        assert!(!ok("javascript:alert(1)"));
    }
}
