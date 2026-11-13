fn main() {
    for key in [
        "BLACKCRAB_EMBEDDED_DESKTOP_MANIFEST_SHA256",
        "BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256",
        "BLACKCRAB_EMBEDDED_DESKTOP_ARCHIVE_SHA256",
        "BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256",
        "BLACKCRAB_EMBEDDED_HOST_SERVICE_PROFILE",
        "BLACKCRAB_SERVICE_ISSUER_PATH",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    println!("cargo:rustc-check-cfg=cfg(blackcrab_bundled_service_issuer)");
    if let Some(path) = std::env::var_os("BLACKCRAB_SERVICE_ISSUER_PATH") {
        let path = std::path::PathBuf::from(path);
        assert!(path.is_absolute() && path.is_file(), "Service issuer input must be an absolute file");
        println!("cargo:rerun-if-changed={}", path.display());
        println!("cargo:rustc-cfg=blackcrab_bundled_service_issuer");
    }
    tauri_build::build()
}
