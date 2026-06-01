//! Blackcrab relay binary.
//!
//! Env:
//!   RELAY_ADDR  — bind address (default `0.0.0.0:8787`)
//!   RELAY_TOKEN — required shared secret hosts must present to claim a room
//!
//! The relay is end-to-end-encrypted: it forwards opaque ciphertext frames and
//! never sees keys or plaintext. Deploy behind a TLS-terminating proxy (wss://)
//! in production.

use blackcrab_relay::{serve, RelayConfig};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let addr = std::env::var("RELAY_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
    let token = match std::env::var("RELAY_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => {
            eprintln!("RELAY_TOKEN must be set (the secret hosts present to claim a room)");
            std::process::exit(1);
        }
    };

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("failed to bind {addr}: {e}");
            std::process::exit(1);
        }
    };
    println!("blackcrab relay listening on {addr}");
    serve(listener, RelayConfig { token }).await;
}
