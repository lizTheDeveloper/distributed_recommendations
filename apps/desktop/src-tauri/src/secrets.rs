//! OS keychain storage for the two secrets the web app may hand over (see
//! apps/mobile/bridge/types.ts, `SecretName`). Backends, via keyring-core:
//! macOS: login Keychain (apple-native-keyring-store, `keychain` module);
//! Windows: Credential Manager (windows-native-keyring-store);
//! Linux: Secret Service over D-Bus (GNOME Keyring, KWallet) (zbus-secret-service-keyring-store).
//!
//! The service name is the app identifier from tauri.conf.json, so another app using the same
//! keyring library can't collide by accident. It is not an access-control boundary: on Linux any
//! process in the user's session can ask Secret Service for the item, and on macOS other apps
//! can request it with a user prompt. See README.md, "Keychain".

use std::sync::OnceLock;

const NAMES: [&str; 2] = ["nostr-secret-key", "vault-key"];
const MAX_LEN: usize = 4096;

static SERVICE: OnceLock<String> = OnceLock::new();

pub fn init_store() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    keyring_core::set_default_store(apple_native_keyring_store::keychain::Store::new()?);
    #[cfg(target_os = "windows")]
    keyring_core::set_default_store(windows_native_keyring_store::Store::new()?);
    #[cfg(target_os = "linux")]
    keyring_core::set_default_store(zbus_secret_service_keyring_store::Store::new()?);
    Ok(())
}

fn entry(app: &tauri::AppHandle, name: &str) -> Result<keyring_core::Entry, String> {
    if !NAMES.contains(&name) {
        return Err(format!("unknown secret name: {name}"));
    }
    let service = SERVICE.get_or_init(|| app.config().identifier.clone());
    keyring_core::Entry::new(service, name).map_err(|e| e.to_string())
}

// Synchronous commands run on the main thread, outside the async runtime, which the blocking
// keychain backends need. Each call is one short keychain round trip.

#[tauri::command]
pub fn secret_get(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    match entry(&app, &name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(app: tauri::AppHandle, name: String, value: String) -> Result<(), String> {
    if value.is_empty() || value.chars().count() > MAX_LEN {
        return Err("secret must be a non-empty string of at most 4096 characters".into());
    }
    entry(&app, &name)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_remove(app: tauri::AppHandle, name: String) -> Result<(), String> {
    match entry(&app, &name)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

