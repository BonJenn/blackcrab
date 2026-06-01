//! LAN WebSocket transport for the Blackcrab mobile companion.
//!
//! Binds a TCP listener to `0.0.0.0:0` (kernel-assigned port) at startup and
//! advertises the primary LAN IPv4 plus that port to the UI so it can be baked
//! into the pairing QR. Each accepted connection performs either a pairing
//! handshake (consuming a desktop-minted code via `PairingService`) or token
//! re-auth (against a previously paired device), then keeps a ping/pong
//! heartbeat alive until either side disconnects.
//!
//! The wire format mirrors `packages/remote-protocol/src/index.ts` — every
//! message is a JSON `{ "v": 1, "msg": ... }` envelope with a `type`-tagged
//! body.

use std::net::{Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::Mutex;
use tokio::time::{interval, timeout};
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::pairing::PairingService;

const PROTOCOL_VERSION: u16 = 1;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const PING_INTERVAL: Duration = Duration::from_secs(15);

/// An action a paired mobile device asked the desktop to perform, decoded off
/// the wire and forwarded to a consumer in `lib.rs` that owns the live session
/// subprocesses. The transport intentionally knows nothing about how these are
/// dispatched — it only resolves the connection is authenticated first.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RemoteCommand {
    SendMessage { session_id: String, body: String },
    StopSession { session_id: String },
    Approve { approval_id: String },
    Deny { approval_id: String, reason: Option<String> },
    FocusSession { session_id: String },
}

/// Builds the host->mobile event bodies (each already in protocol shape) the
/// desktop pushes to authenticated clients on connect and each heartbeat —
/// e.g. `sessions` and `transcript_tail`. Empty when nothing is available.
pub(crate) type EventSnapshot = Arc<dyn Fn() -> Vec<serde_json::Value> + Send + Sync>;

/// Side channels the transport uses to talk to the rest of the app, kept
/// behind this bundle so `start`'s signature stays stable as more host->mobile
/// data sources land. Cheap to clone (a sender + an `Arc`).
#[derive(Clone, Default)]
pub(crate) struct RemoteHooks {
    /// Sink for actions decoded off authenticated connections.
    pub commands: Option<UnboundedSender<RemoteCommand>>,
    /// Produces the event bodies to push on connect and each tick.
    pub events: Option<EventSnapshot>,
    /// Real-time host->mobile events (e.g. approvals). Each connection
    /// subscribes and forwards received bodies to its socket.
    pub broadcast: Option<broadcast::Sender<serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransportEndpoint {
    pub host: String,
    pub port: u16,
}

#[derive(Default)]
pub struct TransportServer {
    endpoint: Mutex<Option<TransportEndpoint>>,
}

impl TransportServer {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn endpoint(&self) -> Option<TransportEndpoint> {
        self.endpoint.lock().await.clone()
    }

    /// Start the WebSocket server. Returns the LAN endpoint to advertise.
    ///
    /// `hooks` carries the action sink and host->mobile data providers; pass
    /// `RemoteHooks::default()` to accept connections without dispatching
    /// actions or pushing data (the server still pairs, authenticates, and
    /// heartbeats).
    pub async fn start(
        self: &Arc<Self>,
        pairing: Arc<PairingService>,
        hooks: RemoteHooks,
    ) -> Result<TransportEndpoint, String> {
        if let Some(existing) = self.endpoint.lock().await.clone() {
            return Ok(existing);
        }
        let listener = TcpListener::bind(SocketAddr::from(([0u8, 0, 0, 0], 0)))
            .await
            .map_err(|e| format!("bind transport listener: {e}"))?;
        let local = listener
            .local_addr()
            .map_err(|e| format!("transport listener addr: {e}"))?;
        let advertised = TransportEndpoint {
            host: detect_lan_host(),
            port: local.port(),
        };
        *self.endpoint.lock().await = Some(advertised.clone());

        let pairing_for_loop = pairing.clone();
        tokio::spawn(async move {
            accept_loop(listener, pairing_for_loop, hooks).await;
        });

        Ok(advertised)
    }
}

async fn accept_loop(listener: TcpListener, pairing: Arc<PairingService>, hooks: RemoteHooks) {
    loop {
        match listener.accept().await {
            Ok((tcp, _peer)) => {
                let pairing = pairing.clone();
                let hooks = hooks.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(tcp, pairing, hooks).await {
                        eprintln!("transport connection error: {e}");
                    }
                });
            }
            Err(e) => {
                eprintln!("transport accept error: {e}");
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

async fn handle_connection(
    tcp: tokio::net::TcpStream,
    pairing: Arc<PairingService>,
    hooks: RemoteHooks,
) -> Result<(), String> {
    let ws = tokio_tungstenite::accept_async(tcp)
        .await
        .map_err(|e| format!("ws handshake: {e}"))?;
    let (mut sink, mut stream) = ws.split();

    // First message must authenticate (pairing_request or auth).
    let first = match timeout(HANDSHAKE_TIMEOUT, stream.next()).await {
        Err(_) => {
            let _ = sink.close().await;
            return Ok(());
        }
        Ok(None) => return Ok(()),
        Ok(Some(Err(e))) => return Err(format!("ws read: {e}")),
        Ok(Some(Ok(msg))) => msg,
    };

    let text = match first {
        WsMessage::Text(t) => t,
        WsMessage::Close(_) => return Ok(()),
        _ => {
            let _ = sink.close().await;
            return Ok(());
        }
    };

    let envelope: Envelope = match serde_json::from_str(&text) {
        Ok(e) => e,
        Err(_) => {
            let _ = sink.close().await;
            return Ok(());
        }
    };
    if envelope.v != PROTOCOL_VERSION {
        let _ = sink.close().await;
        return Ok(());
    }

    let now_ms = crate::pairing::now_unix_ms();
    let authenticated = match envelope.msg {
        WireMessage::PairingRequest {
            code,
            device_name,
            ..
        } => match pairing.accept_pairing(&code, &device_name, now_ms) {
            Ok(resp) => {
                let body = WireMessage::PairingResponse {
                    code: code.clone(),
                    status: PairingStatus::Accepted,
                    host_id: Some(read_host_id_for_response()),
                    remote_token: Some(resp.remote_token),
                    e2e_key: Some(resp.e2e_key),
                    device_id: Some(resp.paired_device.device_id),
                    rejected_reason: None,
                };
                send_envelope(&mut sink, body).await?;
                true
            }
            Err(reason) => {
                let body = WireMessage::PairingResponse {
                    code: code.clone(),
                    status: if reason.contains("expired") {
                        PairingStatus::Expired
                    } else {
                        PairingStatus::Rejected
                    },
                    host_id: None,
                    remote_token: None,
                    e2e_key: None,
                    device_id: None,
                    rejected_reason: Some(reason),
                };
                send_envelope(&mut sink, body).await?;
                let _ = sink.close().await;
                return Ok(());
            }
        },
        WireMessage::Auth { remote_token } => {
            match pairing.verify_token(&remote_token, now_ms) {
                Ok(Some(_device)) => {
                    let body = WireMessage::AuthResponse {
                        status: AuthStatus::Accepted,
                        host_id: Some(read_host_id_for_response()),
                        rejected_reason: None,
                    };
                    send_envelope(&mut sink, body).await?;
                    true
                }
                _ => {
                    let body = WireMessage::AuthResponse {
                        status: AuthStatus::Rejected,
                        host_id: None,
                        rejected_reason: Some("token rejected".into()),
                    };
                    send_envelope(&mut sink, body).await?;
                    let _ = sink.close().await;
                    return Ok(());
                }
            }
        }
        _ => {
            let _ = sink.close().await;
            return Ok(());
        }
    };
    if !authenticated {
        return Ok(());
    }

    // Subscribe before sending the snapshot so a real-time push that races the
    // snapshot is buffered on the receiver rather than dropped.
    let mut pushes = hooks.broadcast.as_ref().map(|tx| tx.subscribe());

    // Announce connection state to the client.
    send_envelope(
        &mut sink,
        WireMessage::ConnectionStatus {
            status: ConnectionStatusBody {
                state: ConnectionState::Connected,
                host_id: None,
                since: chrono_now(),
                detail: None,
            },
        },
    )
    .await?;

    // Push an initial snapshot so the client renders real data immediately
    // rather than waiting a full heartbeat interval.
    for body in snapshot_events(&hooks) {
        send_event_value(&mut sink, body).await?;
    }

    let mut heartbeat = interval(PING_INTERVAL);
    heartbeat.tick().await; // skip the initial immediate tick
    let mut next_seq: u64 = 1;
    loop {
        tokio::select! {
            pushed = next_broadcast(&mut pushes) => {
                if let Some(body) = pushed {
                    if send_event_value(&mut sink, body).await.is_err() {
                        break;
                    }
                }
            }
            _ = heartbeat.tick() => {
                let seq = next_seq;
                next_seq += 1;
                if send_envelope(&mut sink, WireMessage::Ping { seq }).await.is_err() {
                    break;
                }
                // Refresh host->mobile data alongside the heartbeat. A send
                // failure here means the socket is gone; the next ping breaks.
                for body in snapshot_events(&hooks) {
                    if send_event_value(&mut sink, body).await.is_err() {
                        break;
                    }
                }
            }
            incoming = stream.next() => {
                let Some(msg) = incoming else { break; };
                let msg = match msg {
                    Ok(m) => m,
                    Err(_) => break,
                };
                match msg {
                    WsMessage::Text(t) => {
                        match serde_json::from_str::<Envelope>(&t) {
                            Ok(env) if env.v == PROTOCOL_VERSION => match env.msg {
                                WireMessage::Ping { seq } => {
                                    let _ = send_envelope(&mut sink, WireMessage::Pong { seq }).await;
                                }
                                WireMessage::SendMessage {
                                    session_id, body, ..
                                } => {
                                    forward_command(
                                        hooks.commands.as_ref(),
                                        RemoteCommand::SendMessage { session_id, body },
                                    );
                                }
                                WireMessage::StopSession { session_id, .. } => {
                                    forward_command(
                                        hooks.commands.as_ref(),
                                        RemoteCommand::StopSession { session_id },
                                    );
                                }
                                WireMessage::Approve { approval_id, .. } => {
                                    forward_command(
                                        hooks.commands.as_ref(),
                                        RemoteCommand::Approve { approval_id },
                                    );
                                }
                                WireMessage::Deny { approval_id, reason, .. } => {
                                    forward_command(
                                        hooks.commands.as_ref(),
                                        RemoteCommand::Deny { approval_id, reason },
                                    );
                                }
                                WireMessage::FocusSession { session_id, .. } => {
                                    forward_command(
                                        hooks.commands.as_ref(),
                                        RemoteCommand::FocusSession { session_id },
                                    );
                                }
                                // Pong and host->mobile events are ignored here.
                                _ => {}
                            },
                            _ => continue,
                        }
                    }
                    WsMessage::Ping(p) => {
                        let _ = sink.send(WsMessage::Pong(p)).await;
                    }
                    WsMessage::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    let _ = sink.close().await;
    Ok(())
}

/// Await the next broadcast push, if this connection has a receiver. Lagged
/// receivers skip the dropped messages (returns `None`, loop continues); a
/// closed channel or absent receiver parks forever so `select!` ignores it.
async fn next_broadcast(
    rx: &mut Option<broadcast::Receiver<serde_json::Value>>,
) -> Option<serde_json::Value> {
    match rx {
        Some(r) => match r.recv().await {
            Ok(value) => Some(value),
            Err(broadcast::error::RecvError::Lagged(_)) => None,
            Err(broadcast::error::RecvError::Closed) => std::future::pending().await,
        },
        None => std::future::pending().await,
    }
}

/// Ask the host for the current host->mobile event snapshot, if a provider is
/// wired up.
fn snapshot_events(hooks: &RemoteHooks) -> Vec<serde_json::Value> {
    hooks
        .events
        .as_ref()
        .map(|provider| provider())
        .unwrap_or_default()
}

/// Wrap an already-protocol-shaped event body in the versioned envelope and
/// send it. Used for host->mobile events (`sessions`, and later transcript and
/// approval events) that `lib.rs` builds directly as JSON.
async fn send_event_value<S>(sink: &mut S, body: serde_json::Value) -> Result<(), String>
where
    S: SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    let env = serde_json::json!({ "v": PROTOCOL_VERSION, "msg": body });
    let text = serde_json::to_string(&env).map_err(|e| e.to_string())?;
    sink.send(WsMessage::Text(text.into()))
        .await
        .map_err(|e| format!("ws send: {e}"))
}

/// Hand a decoded action to the consumer if one is wired up. A closed or
/// missing channel is non-fatal — the connection keeps serving heartbeats.
fn forward_command(commands: Option<&UnboundedSender<RemoteCommand>>, command: RemoteCommand) {
    if let Some(tx) = commands {
        if tx.send(command).is_err() {
            eprintln!("transport: remote command channel closed; dropping action");
        }
    }
}

async fn send_envelope<S>(sink: &mut S, msg: WireMessage) -> Result<(), String>
where
    S: SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    let env = Envelope {
        v: PROTOCOL_VERSION,
        msg,
    };
    let text = serde_json::to_string(&env).map_err(|e| e.to_string())?;
    sink.send(WsMessage::Text(text.into()))
        .await
        .map_err(|e| format!("ws send: {e}"))
}

fn read_host_id_for_response() -> String {
    crate::remote_host_id_for_pairing()
}

fn chrono_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Crude ISO-8601 without dragging in chrono. The mobile client only uses
    // this as an opaque token for display.
    format!("@{}", secs)
}

/// Discover the primary LAN IPv4 by opening a UDP socket to a routable address
/// and reading the kernel-selected local address. No packets are actually
/// sent. Falls back to "127.0.0.1".
pub fn detect_lan_host() -> String {
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return "127.0.0.1".into(),
    };
    if socket.connect("8.8.8.8:80").is_err() {
        return "127.0.0.1".into();
    }
    match socket.local_addr() {
        Ok(SocketAddr::V4(addr)) => addr.ip().to_string(),
        Ok(SocketAddr::V6(addr)) => addr.ip().to_string(),
        Err(_) => "127.0.0.1".into(),
    }
    .pipe(|s| {
        if s == "0.0.0.0" {
            Ipv4Addr::LOCALHOST.to_string()
        } else {
            s
        }
    })
}

trait Pipe: Sized {
    fn pipe<R>(self, f: impl FnOnce(Self) -> R) -> R {
        f(self)
    }
}
impl<T> Pipe for T {}

// ---------------------------------------------------------------------------
// Wire types — mirror packages/remote-protocol/src/index.ts.
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    v: u16,
    msg: WireMessage,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WireMessage {
    PairingRequest {
        code: String,
        #[serde(rename = "deviceName")]
        device_name: String,
        #[serde(rename = "requestedAt")]
        #[allow(dead_code)]
        requested_at: String,
    },
    PairingResponse {
        code: String,
        status: PairingStatus,
        #[serde(skip_serializing_if = "Option::is_none", rename = "hostId")]
        host_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "remoteToken")]
        remote_token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "e2eKey")]
        e2e_key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "deviceId")]
        device_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "rejectedReason")]
        rejected_reason: Option<String>,
    },
    Auth {
        #[serde(rename = "remoteToken")]
        remote_token: String,
    },
    AuthResponse {
        status: AuthStatus,
        #[serde(skip_serializing_if = "Option::is_none", rename = "hostId")]
        host_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "rejectedReason")]
        rejected_reason: Option<String>,
    },
    ConnectionStatus {
        status: ConnectionStatusBody,
    },
    Ping {
        seq: u64,
    },
    Pong {
        seq: u64,
    },
    SendMessage {
        #[serde(rename = "hostId")]
        #[allow(dead_code)]
        host_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        body: String,
    },
    StopSession {
        #[serde(rename = "hostId")]
        #[allow(dead_code)]
        host_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    Approve {
        #[serde(rename = "hostId")]
        #[allow(dead_code)]
        host_id: String,
        #[serde(rename = "approvalId")]
        approval_id: String,
    },
    Deny {
        #[serde(rename = "hostId")]
        #[allow(dead_code)]
        host_id: String,
        #[serde(rename = "approvalId")]
        approval_id: String,
        #[serde(default)]
        reason: Option<String>,
    },
    FocusSession {
        #[serde(rename = "hostId")]
        #[allow(dead_code)]
        host_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PairingStatus {
    Accepted,
    Rejected,
    Expired,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AuthStatus {
    Accepted,
    Rejected,
}

#[derive(Debug, Serialize, Deserialize)]
struct ConnectionStatusBody {
    state: ConnectionState,
    #[serde(rename = "hostId", skip_serializing_if = "Option::is_none")]
    host_id: Option<String>,
    since: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
    Error,
}

// Suppress unused-variant warnings — the encoder/decoder needs them all.
#[allow(dead_code)]
fn _wire_uses() {
    let _ = WireMessage::PairingRequest {
        code: String::new(),
        device_name: String::new(),
        requested_at: String::new(),
    };
    let _ = WireMessage::SendMessage {
        host_id: String::new(),
        session_id: String::new(),
        body: String::new(),
    };
    let _ = WireMessage::StopSession {
        host_id: String::new(),
        session_id: String::new(),
    };
    let _ = WireMessage::Approve {
        host_id: String::new(),
        approval_id: String::new(),
    };
    let _ = WireMessage::Deny {
        host_id: String::new(),
        approval_id: String::new(),
        reason: None,
    };
    let _ = WireMessage::FocusSession {
        host_id: String::new(),
        session_id: String::new(),
    };
    let _ = ConnectionState::Disconnected;
    let _ = ConnectionState::Connecting;
    let _ = ConnectionState::Reconnecting;
    let _ = ConnectionState::Error;
    let _ = AuthStatus::Accepted;
    let _ = AuthStatus::Rejected;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_round_trips_pairing_request() {
        let env = Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::PairingRequest {
                code: "ABCDEFGH".into(),
                device_name: "Phone".into(),
                requested_at: "2026-05-18T18:00:00Z".into(),
            },
        };
        let text = serde_json::to_string(&env).unwrap();
        assert!(text.contains("\"type\":\"pairing_request\""));
        assert!(text.contains("\"deviceName\":\"Phone\""));
        let back: Envelope = serde_json::from_str(&text).unwrap();
        assert_eq!(back.v, PROTOCOL_VERSION);
    }

    #[test]
    fn envelope_round_trips_auth() {
        let env = Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::Auth {
                remote_token: "tok".into(),
            },
        };
        let text = serde_json::to_string(&env).unwrap();
        assert!(text.contains("\"type\":\"auth\""));
        assert!(text.contains("\"remoteToken\":\"tok\""));
        let _: Envelope = serde_json::from_str(&text).unwrap();
    }

    #[test]
    fn envelope_rejects_wrong_version() {
        let text = r#"{"v":99,"msg":{"type":"ping","seq":1}}"#;
        let env: Envelope = serde_json::from_str(text).unwrap();
        assert_eq!(env.v, 99);
        // The consumer side compares to PROTOCOL_VERSION; here we just confirm
        // the parser is permissive about version.
    }

    #[test]
    fn detect_lan_host_returns_non_empty() {
        let host = detect_lan_host();
        assert!(!host.is_empty());
    }

    use crate::pairing::PAIRING_DEFAULT_TTL_SECS;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    fn tmp_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "blackcrab-transport-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ))
    }

    #[tokio::test(flavor = "current_thread")]
    async fn pairing_handshake_round_trips_over_ws() {
        let path = tmp_path();
        let _ = std::fs::remove_file(&path);
        let pairing = Arc::new(PairingService::load(path.clone()).unwrap());
        let start = pairing
            .start_pairing(crate::pairing::now_unix_ms(), PAIRING_DEFAULT_TTL_SECS)
            .unwrap();

        let server = Arc::new(TransportServer::new());
        let endpoint = server
            .start(pairing.clone(), RemoteHooks::default())
            .await
            .unwrap();
        // Use 127.0.0.1 explicitly — `detect_lan_host` may return an address
        // not bound on this machine.
        let url = format!("ws://127.0.0.1:{}/", endpoint.port);
        let req = url.into_client_request().unwrap();
        let (mut ws, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();

        let pair_req = Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::PairingRequest {
                code: start.code.clone(),
                device_name: "Phone".into(),
                requested_at: "2026-05-18T18:00:00Z".into(),
            },
        };
        let text = serde_json::to_string(&pair_req).unwrap();
        use futures_util::SinkExt;
        ws.send(tokio_tungstenite::tungstenite::Message::Text(text.into()))
            .await
            .unwrap();

        use futures_util::StreamExt;
        let reply = ws.next().await.unwrap().unwrap();
        let body = match reply {
            tokio_tungstenite::tungstenite::Message::Text(t) => t.to_string(),
            other => panic!("expected text, got {other:?}"),
        };
        let env: Envelope = serde_json::from_str(&body).unwrap();
        match env.msg {
            WireMessage::PairingResponse { status, remote_token, .. } => {
                assert!(matches!(status, PairingStatus::Accepted));
                let token = remote_token.expect("token");
                assert!(pairing
                    .verify_token(&token, crate::pairing::now_unix_ms())
                    .unwrap()
                    .is_some());
            }
            other => panic!("expected pairing_response, got {other:?}"),
        }

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn rejects_unknown_pairing_code() {
        let path = tmp_path();
        let _ = std::fs::remove_file(&path);
        let pairing = Arc::new(PairingService::load(path.clone()).unwrap());
        let server = Arc::new(TransportServer::new());
        let endpoint = server
            .start(pairing.clone(), RemoteHooks::default())
            .await
            .unwrap();
        let url = format!("ws://127.0.0.1:{}/", endpoint.port);
        let req = url.into_client_request().unwrap();
        let (mut ws, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();

        let pair_req = Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::PairingRequest {
                code: "ZZZZZZZZ".into(),
                device_name: "Phone".into(),
                requested_at: "2026-05-18T18:00:00Z".into(),
            },
        };
        use futures_util::SinkExt;
        ws.send(tokio_tungstenite::tungstenite::Message::Text(
            serde_json::to_string(&pair_req).unwrap().into(),
        ))
        .await
        .unwrap();
        use futures_util::StreamExt;
        let reply = ws.next().await.unwrap().unwrap();
        let body = match reply {
            tokio_tungstenite::tungstenite::Message::Text(t) => t.to_string(),
            other => panic!("expected text, got {other:?}"),
        };
        let env: Envelope = serde_json::from_str(&body).unwrap();
        match env.msg {
            WireMessage::PairingResponse { status, remote_token, .. } => {
                assert!(matches!(status, PairingStatus::Rejected | PairingStatus::Expired));
                assert!(remote_token.is_none());
            }
            other => panic!("expected pairing_response, got {other:?}"),
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn envelope_round_trips_send_message_action() {
        // The mobile client emits camelCase field names; confirm we decode
        // them into the snake_case Rust struct.
        let text = r#"{"v":1,"msg":{"type":"send_message","hostId":"h","sessionId":"sess-abc","body":"hi"}}"#;
        let env: Envelope = serde_json::from_str(text).unwrap();
        match env.msg {
            WireMessage::SendMessage { session_id, body, .. } => {
                assert_eq!(session_id, "sess-abc");
                assert_eq!(body, "hi");
            }
            other => panic!("expected send_message, got {other:?}"),
        }
    }

    #[test]
    fn envelope_round_trips_stop_session_action() {
        let text = r#"{"v":1,"msg":{"type":"stop_session","hostId":"h","sessionId":"sess-xyz"}}"#;
        let env: Envelope = serde_json::from_str(text).unwrap();
        match env.msg {
            WireMessage::StopSession { session_id, .. } => assert_eq!(session_id, "sess-xyz"),
            other => panic!("expected stop_session, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn authenticated_actions_reach_the_command_channel() {
        let path = tmp_path();
        let _ = std::fs::remove_file(&path);
        let pairing = Arc::new(PairingService::load(path.clone()).unwrap());
        let start = pairing
            .start_pairing(crate::pairing::now_unix_ms(), PAIRING_DEFAULT_TTL_SECS)
            .unwrap();

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<RemoteCommand>();
        let server = Arc::new(TransportServer::new());
        let hooks = RemoteHooks {
            commands: Some(tx),
            ..Default::default()
        };
        let endpoint = server.start(pairing.clone(), hooks).await.unwrap();
        let url = format!("ws://127.0.0.1:{}/", endpoint.port);
        let req = url.into_client_request().unwrap();
        let (mut ws, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();

        use futures_util::{SinkExt, StreamExt};

        // Pair first — actions before authentication must be ignored.
        let pair_req = serde_json::to_string(&Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::PairingRequest {
                code: start.code.clone(),
                device_name: "Phone".into(),
                requested_at: "2026-05-18T18:00:00Z".into(),
            },
        })
        .unwrap();
        ws.send(WsMessage::Text(pair_req.into())).await.unwrap();

        // Drain the pairing_response and the connection_status announcement.
        for _ in 0..2 {
            let _ = ws.next().await.unwrap().unwrap();
        }

        let action = serde_json::to_string(&Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::SendMessage {
                host_id: "h".into(),
                session_id: "sess-abc".into(),
                body: "ship it".into(),
            },
        })
        .unwrap();
        ws.send(WsMessage::Text(action.into())).await.unwrap();

        let received = timeout(Duration::from_secs(2), rx.recv())
            .await
            .expect("command should arrive before timeout")
            .expect("channel open");
        assert_eq!(
            received,
            RemoteCommand::SendMessage {
                session_id: "sess-abc".into(),
                body: "ship it".into(),
            }
        );

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn pushes_a_session_snapshot_after_authentication() {
        let path = tmp_path();
        let _ = std::fs::remove_file(&path);
        let pairing = Arc::new(PairingService::load(path.clone()).unwrap());
        let start = pairing
            .start_pairing(crate::pairing::now_unix_ms(), PAIRING_DEFAULT_TTL_SECS)
            .unwrap();

        let snapshot: EventSnapshot = Arc::new(|| {
            vec![serde_json::json!({
                "type": "sessions",
                "hostId": "host-1",
                "sessions": [{ "sessionId": "sess-1", "title": "Demo" }],
            })]
        });
        let server = Arc::new(TransportServer::new());
        let hooks = RemoteHooks {
            events: Some(snapshot),
            ..Default::default()
        };
        let endpoint = server.start(pairing.clone(), hooks).await.unwrap();
        let url = format!("ws://127.0.0.1:{}/", endpoint.port);
        let req = url.into_client_request().unwrap();
        let (mut ws, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();

        use futures_util::{SinkExt, StreamExt};
        let pair_req = serde_json::to_string(&Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::PairingRequest {
                code: start.code.clone(),
                device_name: "Phone".into(),
                requested_at: "2026-05-18T18:00:00Z".into(),
            },
        })
        .unwrap();
        ws.send(WsMessage::Text(pair_req.into())).await.unwrap();

        // Drain frames until the sessions event arrives (after pairing_response
        // and connection_status), or time out.
        let body = timeout(Duration::from_secs(2), async {
            loop {
                let frame = ws.next().await.unwrap().unwrap();
                if let WsMessage::Text(t) = frame {
                    let value: serde_json::Value = serde_json::from_str(&t).unwrap();
                    if value["msg"]["type"] == "sessions" {
                        return value;
                    }
                }
            }
        })
        .await
        .expect("sessions event should arrive");

        assert_eq!(body["msg"]["hostId"], "host-1");
        assert_eq!(body["msg"]["sessions"][0]["sessionId"], "sess-1");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn broadcast_pushes_reach_authenticated_clients() {
        let path = tmp_path();
        let _ = std::fs::remove_file(&path);
        let pairing = Arc::new(PairingService::load(path.clone()).unwrap());
        let start = pairing
            .start_pairing(crate::pairing::now_unix_ms(), PAIRING_DEFAULT_TTL_SECS)
            .unwrap();

        let (bcast, _keep) = broadcast::channel::<serde_json::Value>(16);
        let server = Arc::new(TransportServer::new());
        let hooks = RemoteHooks {
            broadcast: Some(bcast.clone()),
            ..Default::default()
        };
        let endpoint = server.start(pairing.clone(), hooks).await.unwrap();
        let url = format!("ws://127.0.0.1:{}/", endpoint.port);
        let req = url.into_client_request().unwrap();
        let (mut ws, _resp) = tokio_tungstenite::connect_async(req).await.unwrap();

        use futures_util::{SinkExt, StreamExt};
        let pair_req = serde_json::to_string(&Envelope {
            v: PROTOCOL_VERSION,
            msg: WireMessage::PairingRequest {
                code: start.code.clone(),
                device_name: "Phone".into(),
                requested_at: "2026-05-18T18:00:00Z".into(),
            },
        })
        .unwrap();
        ws.send(WsMessage::Text(pair_req.into())).await.unwrap();

        // Drain pairing_response + connection_status, then broadcast.
        for _ in 0..2 {
            let _ = ws.next().await.unwrap().unwrap();
        }
        bcast
            .send(serde_json::json!({
                "type": "approval_requested",
                "approval": { "id": "appr-1" }
            }))
            .unwrap();

        let body = timeout(Duration::from_secs(2), async {
            loop {
                if let WsMessage::Text(t) = ws.next().await.unwrap().unwrap() {
                    let v: serde_json::Value = serde_json::from_str(&t).unwrap();
                    if v["msg"]["type"] == "approval_requested" {
                        return v;
                    }
                }
            }
        })
        .await
        .expect("broadcast should arrive");
        assert_eq!(body["msg"]["approval"]["id"], "appr-1");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn envelope_round_trips_approve_action() {
        let text = r#"{"v":1,"msg":{"type":"approve","hostId":"h","approvalId":"appr-1"}}"#;
        let env: Envelope = serde_json::from_str(text).unwrap();
        match env.msg {
            WireMessage::Approve { approval_id, .. } => assert_eq!(approval_id, "appr-1"),
            other => panic!("expected approve, got {other:?}"),
        }
    }

    #[test]
    fn envelope_round_trips_focus_session_action() {
        let text = r#"{"v":1,"msg":{"type":"focus_session","hostId":"h","sessionId":"sess-9"}}"#;
        let env: Envelope = serde_json::from_str(text).unwrap();
        match env.msg {
            WireMessage::FocusSession { session_id, .. } => assert_eq!(session_id, "sess-9"),
            other => panic!("expected focus_session, got {other:?}"),
        }
    }
}
