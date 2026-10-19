// Declares the app's own commands in an app manifest, so each one needs an explicit
// permission in capabilities/ (Tauri otherwise allows every app command to every local window).
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["secret_get", "secret_set", "secret_remove"]),
        ),
    )
    .expect("failed to run tauri-build");
}
