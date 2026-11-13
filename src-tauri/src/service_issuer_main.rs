//! Standalone service helper. Never initialize a GUI, even for invalid arguments.
fn main() {
    let code = blackcrab_lib::dispatch_private_service_issuer(std::env::args_os().skip(1).collect())
        .unwrap_or(64);
    std::process::exit(code);
}
