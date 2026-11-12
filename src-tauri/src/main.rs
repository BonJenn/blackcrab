#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = blackcrab_lib::dispatch_private_service_issuer(std::env::args_os().skip(1).collect()) {
        std::process::exit(code);
    }
    blackcrab_lib::run()
}
