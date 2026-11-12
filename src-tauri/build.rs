fn main() {
    for key in [
        "BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256",
        "BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256",
        "BLACKCRAB_EMBEDDED_DESKTOP_ARCHIVE_SHA256",
        "BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    tauri_build::build()
}
