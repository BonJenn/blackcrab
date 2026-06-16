//! Blackcrab relay: a dumb, end-to-end-encrypted message router.
//!
//! A desktop **host** and its paired **devices** (phones) each open a WebSocket
//! to the relay and `hello` into a room keyed by `hostId`. The relay then
//! forwards opaque `data` frames between them — host→device (addressed by
//! `deviceId`) and device→host. It never parses the `payload` (a NaCl
//! secretbox sealed frame), so it cannot read transcripts or actions; it only
//! ever sees `{hostId, deviceId, ciphertext}`-shaped routing metadata.
//!
//! `hello` from a host must carry a `token` matching the relay's configured
//! `RELAY_TOKEN`; this gates *room creation* so a stranger can't squat a
//! `hostId`. Devices need no token — they can only reach a desktop able to
//! decrypt their frames, so end-to-end encryption is the real access control.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::time::{timeout, Duration, Instant};
use tokio_tungstenite::tungstenite::Message as WsMessage;

const HELLO_TIMEOUT: Duration = Duration::from_secs(15);

/// Global ceiling on simultaneously-open connections. Excess connections are
/// rejected with an error frame and closed; this only sheds abusive load and
/// never affects a healthy host with its handful of devices.
const MAX_CONNECTIONS: usize = 1_024;

/// Per-room (per-host) ceiling on connected devices. A host plus its phones is
/// a tiny set; extra device connections beyond this are anti-abuse rejections.
const MAX_DEVICES_PER_ROOM: usize = 8;

/// Inbound message rate limit per connection: at most `RATE_LIMIT_BURST`
/// frames may arrive in any `RATE_LIMIT_WINDOW`. A connection that exceeds this
/// is closed. The window is generous enough for normal interactive use.
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(1);
const RATE_LIMIT_BURST: u32 = 60;

/// Fixed-window inbound rate limiter for a single connection.
struct RateLimiter {
    window_start: Instant,
    count: u32,
}

impl RateLimiter {
    fn new(now: Instant) -> Self {
        Self {
            window_start: now,
            count: 0,
        }
    }

    /// Record a frame at `now`; returns `false` if the connection has exceeded
    /// its allowance for the current window and should be closed.
    fn allow(&mut self, now: Instant) -> bool {
        if now.duration_since(self.window_start) >= RATE_LIMIT_WINDOW {
            self.window_start = now;
            self.count = 0;
        }
        self.count += 1;
        self.count <= RATE_LIMIT_BURST
    }
}

/// Process-wide count of live connections, used to enforce `MAX_CONNECTIONS`.
/// Decremented via the `ConnectionGuard` RAII drop so every exit path frees it.
type ConnectionCount = Arc<AtomicUsize>;

/// Decrements the live-connection counter when dropped, regardless of how the
/// connection task ends.
struct ConnectionGuard(ConnectionCount);

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Clone)]
pub struct RelayConfig {
    /// Shared secret a host must present to claim a room.
    pub token: String,
    /// When true, a device hello must carry a valid per-device token derived as
    /// `hex(HMAC-SHA256(token, device_id))`; missing/mismatched tokens are
    /// rejected. Off by default — enabling it is a BREAKING change that requires
    /// every device to re-pair against a host that mints the derived token.
    pub require_device_auth: bool,
}

/// Derive the per-device relay token from the shared relay token and device id:
/// `hex(HMAC-SHA256(relay_token, device_id))`. Must stay in sync with the host's
/// `pairing::derive_relay_device_token`.
fn derive_device_token(relay_token: &str, device_id: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(relay_token.as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(device_id.as_bytes());
    let bytes = mac.finalize().into_bytes();
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// Constant-time string comparison so token checks don't leak length/contents
/// via timing. Returns true only on an exact match.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

type Tx = UnboundedSender<WsMessage>;

#[derive(Default)]
struct Room {
    host: Option<Tx>,
    devices: HashMap<String, Tx>,
}

type Rooms = Arc<Mutex<HashMap<String, Room>>>;

/// Cleartext routing frames between an endpoint and the relay. The `payload`
/// of a `data` frame is opaque to the relay.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RelayFrame {
    Hello {
        role: Role,
        #[serde(rename = "hostId")]
        host_id: String,
        #[serde(rename = "deviceId", default, skip_serializing_if = "Option::is_none")]
        device_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
        /// Optional per-device relay auth token (minted by the host at pairing).
        /// Parsed for forward-compatibility but NOT yet required or validated;
        /// devices without it are still accepted. A later release will enforce.
        #[serde(rename = "deviceToken", default, skip_serializing_if = "Option::is_none")]
        device_token: Option<String>,
    },
    HelloAck,
    HelloError {
        reason: String,
    },
    Data {
        /// Target device for host→device frames; ignored device→host.
        #[serde(rename = "to", default, skip_serializing_if = "Option::is_none")]
        to: Option<String>,
        /// Source device, stamped by the relay on device→host frames so the
        /// host knows which device's E2E key to use.
        #[serde(rename = "from", default, skip_serializing_if = "Option::is_none")]
        from: Option<String>,
        payload: serde_json::Value,
    },
    /// Host-only: a device joined or left its room. Lets the host track which
    /// devices to encrypt outbound events for.
    Presence {
        event: PresenceEvent,
        #[serde(rename = "deviceId")]
        device_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PresenceEvent {
    Joined,
    Left,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Role {
    Host,
    Device,
}

/// Accept connections on `listener` until it errors, forever.
pub async fn serve(listener: TcpListener, config: RelayConfig) {
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let live: ConnectionCount = Arc::new(AtomicUsize::new(0));
    loop {
        match listener.accept().await {
            Ok((stream, _peer)) => {
                let rooms = rooms.clone();
                let config = config.clone();
                let live = live.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, rooms, config, live).await {
                        eprintln!("relay connection error: {e}");
                    }
                });
            }
            Err(e) => {
                eprintln!("relay accept error: {e}");
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

fn send_frame(tx: &Tx, frame: &RelayFrame) {
    if let Ok(text) = serde_json::to_string(frame) {
        let _ = tx.send(WsMessage::Text(text.into()));
    }
}

async fn handle_connection(
    stream: TcpStream,
    rooms: Rooms,
    config: RelayConfig,
    live: ConnectionCount,
) -> Result<(), String> {
    // Reserve a connection slot up front. If we're at the global ceiling, back
    // out immediately (the guard's Drop releases the slot on every exit path).
    let prior = live.fetch_add(1, Ordering::SeqCst);
    let _conn_guard = ConnectionGuard(live);
    if prior >= MAX_CONNECTIONS {
        // Too many open connections; refuse without completing a handshake.
        return Ok(());
    }

    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .map_err(|e| format!("ws handshake: {e}"))?;
    let (mut sink, mut read) = ws.split();

    // First frame must be a hello.
    let first = match timeout(HELLO_TIMEOUT, read.next()).await {
        Ok(Some(Ok(WsMessage::Text(t)))) => t,
        _ => return Ok(()),
    };
    let (role, host_id, device_id) = match serde_json::from_str::<RelayFrame>(&first) {
        Ok(RelayFrame::Hello {
            role,
            host_id,
            device_id,
            token,
            device_token,
        }) => {
            if role == Role::Host && token.as_deref() != Some(config.token.as_str()) {
                let _ = sink
                    .send(error_frame("invalid relay token"))
                    .await;
                return Ok(());
            }
            // Device auth: only enforced when `require_device_auth` is set (off
            // by default). When enforced, the presented `deviceToken` must equal
            // `hex(HMAC-SHA256(config.token, device_id))` — verifiable here
            // without any per-device registry. Compared in constant time. When
            // the flag is off we ignore the token exactly as before.
            if role == Role::Device && config.require_device_auth {
                let device_id_str = device_id.clone().unwrap_or_default();
                match device_token.as_deref() {
                    None => {
                        let _ = sink
                            .send(error_frame("device authentication required"))
                            .await;
                        return Ok(());
                    }
                    Some(presented) => {
                        let expected = derive_device_token(&config.token, &device_id_str);
                        if !constant_time_eq(presented, &expected) {
                            let _ = sink
                                .send(error_frame("invalid device token"))
                                .await;
                            return Ok(());
                        }
                    }
                }
            } else {
                // Flag off (default): plumbed through but not validated.
                let _ = device_token;
            }
            (role, host_id, device_id)
        }
        _ => {
            let _ = sink.send(error_frame("expected hello")).await;
            return Ok(());
        }
    };

    // A device must identify itself; checked before touching the room map.
    let device_key = device_id.clone().unwrap_or_default();
    if role == Role::Device && device_key.is_empty() {
        let _ = sink.send(error_frame("device id required")).await;
        return Ok(());
    }

    // Per-connection outbound channel; a writer task drains it to the socket.
    let (tx, mut rx) = mpsc::unbounded_channel::<WsMessage>();

    // Register into the room under the lock, then await outside it (a std
    // MutexGuard is !Send and must not cross an await). Hosts claim a room
    // exclusively; a second host for the same id is rejected (anti-squatting).
    // We also collect presence frames to emit so the host tracks live devices.
    enum Registration {
        Ok,
        HostTaken,
        RoomFull,
    }
    let mut presence: Vec<(Tx, RelayFrame)> = Vec::new();
    let registered = {
        let mut guard = rooms.lock().unwrap();
        let room = guard.entry(host_id.clone()).or_default();
        match role {
            Role::Host if room.host.is_some() => Registration::HostTaken,
            Role::Host => {
                room.host = Some(tx.clone());
                // Tell the freshly-connected host about devices already present.
                for dev in room.devices.keys() {
                    presence.push((tx.clone(), presence_frame(PresenceEvent::Joined, dev)));
                }
                Registration::Ok
            }
            // Reject extra devices beyond the per-room cap (a reconnecting
            // device reuses its key, so this only sheds genuinely new ones).
            Role::Device
                if !room.devices.contains_key(&device_key)
                    && room.devices.len() >= MAX_DEVICES_PER_ROOM =>
            {
                // Drop the room entry if our `entry()` just created an empty one.
                if room.host.is_none() && room.devices.is_empty() {
                    guard.remove(&host_id);
                }
                Registration::RoomFull
            }
            Role::Device => {
                room.devices.insert(device_key.clone(), tx.clone());
                if let Some(host) = room.host.clone() {
                    presence.push((host, presence_frame(PresenceEvent::Joined, &device_key)));
                }
                Registration::Ok
            }
        }
    };
    match registered {
        Registration::Ok => {}
        Registration::HostTaken => {
            let _ = sink.send(error_frame("host already connected")).await;
            return Ok(());
        }
        Registration::RoomFull => {
            let _ = sink.send(error_frame("too many devices")).await;
            return Ok(());
        }
    }
    send_frame(&tx, &RelayFrame::HelloAck);
    for (target, frame) in presence {
        send_frame(&target, &frame);
    }

    // Writer task: outbound channel -> socket.
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    // Reader loop: route data frames to the counterpart(s).
    let mut limiter = RateLimiter::new(Instant::now());
    while let Some(Ok(msg)) = read.next().await {
        // Every inbound frame counts against the per-connection rate limit; a
        // connection that floods the relay is dropped (the writer task closes
        // the socket when `tx` is dropped on the way out).
        if !limiter.allow(Instant::now()) {
            break;
        }
        let text = match msg {
            WsMessage::Text(t) => t,
            WsMessage::Close(_) => break,
            WsMessage::Ping(_) | WsMessage::Pong(_) | WsMessage::Binary(_) | WsMessage::Frame(_) => {
                continue
            }
        };
        let Ok(RelayFrame::Data { to, payload, .. }) = serde_json::from_str::<RelayFrame>(&text)
        else {
            continue;
        };
        let from_device = if role == Role::Device {
            Some(device_key.as_str())
        } else {
            None
        };
        route_data(&rooms, &host_id, role, from_device, to.as_deref(), payload);
    }

    // Deregister on disconnect; tell the host if a device left.
    let left_notice = {
        let mut guard = rooms.lock().unwrap();
        let mut notice: Option<Tx> = None;
        if let Some(room) = guard.get_mut(&host_id) {
            match role {
                Role::Host => room.host = None,
                Role::Device => {
                    room.devices.remove(&device_key);
                    notice = room.host.clone();
                }
            }
            if room.host.is_none() && room.devices.is_empty() {
                guard.remove(&host_id);
            }
        }
        notice
    };
    if let Some(host) = left_notice {
        send_frame(&host, &presence_frame(PresenceEvent::Left, &device_key));
    }
    drop(tx);
    let _ = writer.await;
    Ok(())
}

fn presence_frame(event: PresenceEvent, device_id: &str) -> RelayFrame {
    RelayFrame::Presence {
        event,
        device_id: device_id.to_string(),
    }
}

/// Forward a `data` frame to its counterpart(s), preserving the opaque payload.
/// Device→host frames are stamped with `from` so the host can pick the right
/// E2E key.
fn route_data(
    rooms: &Rooms,
    host_id: &str,
    sender: Role,
    from_device: Option<&str>,
    to: Option<&str>,
    payload: serde_json::Value,
) {
    // Collect target senders under the lock, send after releasing it.
    let targets: Vec<Tx> = {
        let guard = rooms.lock().unwrap();
        let Some(room) = guard.get(host_id) else {
            return;
        };
        match sender {
            // device -> host
            Role::Device => room.host.iter().cloned().collect(),
            // host -> a specific device (or every device if unaddressed)
            Role::Host => match to {
                Some(dev) => room.devices.get(dev).cloned().into_iter().collect(),
                None => room.devices.values().cloned().collect(),
            },
        }
    };
    let from = from_device.map(|d| d.to_string());
    for tx in targets {
        send_frame(
            &tx,
            &RelayFrame::Data {
                to: None,
                from: from.clone(),
                payload: payload.clone(),
            },
        );
    }
}

fn error_frame(reason: &str) -> WsMessage {
    let frame = RelayFrame::HelloError {
        reason: reason.to_string(),
    };
    WsMessage::Text(serde_json::to_string(&frame).unwrap_or_default().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::MaybeTlsStream;
    use tokio_tungstenite::WebSocketStream;

    type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

    async fn start_relay(token: &str) -> u16 {
        start_relay_with_auth(token, false).await
    }

    async fn start_relay_with_auth(token: &str, require_device_auth: bool) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let config = RelayConfig {
            token: token.to_string(),
            require_device_auth,
        };
        tokio::spawn(async move { serve(listener, config).await });
        port
    }

    async fn connect(port: u16) -> Ws {
        let url = format!("ws://127.0.0.1:{port}/");
        let req = url.into_client_request().unwrap();
        let (ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        ws
    }

    async fn send(ws: &mut Ws, value: serde_json::Value) {
        ws.send(WsMessage::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    async fn next_text(ws: &mut Ws) -> serde_json::Value {
        loop {
            match ws.next().await.unwrap().unwrap() {
                WsMessage::Text(t) => return serde_json::from_str(&t).unwrap(),
                _ => continue,
            }
        }
    }

    fn hello_host(token: &str) -> serde_json::Value {
        serde_json::json!({"type":"hello","role":"host","hostId":"h1","token":token})
    }
    fn hello_device(dev: &str) -> serde_json::Value {
        serde_json::json!({"type":"hello","role":"device","hostId":"h1","deviceId":dev})
    }

    #[tokio::test]
    async fn routes_data_between_host_and_device() {
        let port = start_relay("secret").await;
        let mut host = connect(port).await;
        send(&mut host, hello_host("secret")).await;
        assert_eq!(next_text(&mut host).await["type"], "hello_ack");

        let mut device = connect(port).await;
        send(&mut device, hello_device("dev-1")).await;
        assert_eq!(next_text(&mut device).await["type"], "hello_ack");

        // host learns the device joined
        let presence = next_text(&mut host).await;
        assert_eq!(presence["type"], "presence");
        assert_eq!(presence["event"], "joined");
        assert_eq!(presence["deviceId"], "dev-1");

        // host -> device, addressed
        send(
            &mut host,
            serde_json::json!({"type":"data","to":"dev-1","payload":{"nonce":"n","ciphertext":"c"}}),
        )
        .await;
        let got = next_text(&mut device).await;
        assert_eq!(got["type"], "data");
        assert_eq!(got["payload"]["ciphertext"], "c");

        // device -> host, stamped with the source device id
        send(
            &mut device,
            serde_json::json!({"type":"data","payload":{"nonce":"n2","ciphertext":"c2"}}),
        )
        .await;
        let got = next_text(&mut host).await;
        assert_eq!(got["payload"]["ciphertext"], "c2");
        assert_eq!(got["from"], "dev-1");
    }

    #[tokio::test]
    async fn host_is_notified_when_a_device_leaves() {
        let port = start_relay("secret").await;
        let mut host = connect(port).await;
        send(&mut host, hello_host("secret")).await;
        assert_eq!(next_text(&mut host).await["type"], "hello_ack");

        let mut device = connect(port).await;
        send(&mut device, hello_device("dev-9")).await;
        assert_eq!(next_text(&mut device).await["type"], "hello_ack");
        assert_eq!(next_text(&mut host).await["event"], "joined");

        drop(device); // disconnect
        let left = next_text(&mut host).await;
        assert_eq!(left["type"], "presence");
        assert_eq!(left["event"], "left");
        assert_eq!(left["deviceId"], "dev-9");
    }

    #[tokio::test]
    async fn host_requires_valid_token() {
        let port = start_relay("secret").await;
        let mut host = connect(port).await;
        send(&mut host, hello_host("wrong")).await;
        assert_eq!(next_text(&mut host).await["type"], "hello_error");
    }

    #[tokio::test]
    async fn second_host_for_a_room_is_rejected() {
        let port = start_relay("secret").await;
        let mut h1 = connect(port).await;
        send(&mut h1, hello_host("secret")).await;
        assert_eq!(next_text(&mut h1).await["type"], "hello_ack");

        let mut h2 = connect(port).await;
        send(&mut h2, hello_host("secret")).await;
        assert_eq!(next_text(&mut h2).await["type"], "hello_error");
    }

    #[tokio::test]
    async fn device_requires_a_device_id() {
        let port = start_relay("secret").await;
        let mut device = connect(port).await;
        send(
            &mut device,
            serde_json::json!({"type":"hello","role":"device","hostId":"h1"}),
        )
        .await;
        assert_eq!(next_text(&mut device).await["type"], "hello_error");
    }

    #[test]
    fn rate_limiter_rejects_beyond_burst_then_resets_next_window() {
        let start = Instant::now();
        let mut limiter = RateLimiter::new(start);
        for _ in 0..RATE_LIMIT_BURST {
            assert!(limiter.allow(start));
        }
        // The next frame within the same window is over budget.
        assert!(!limiter.allow(start));
        // A frame in the following window is allowed again.
        assert!(limiter.allow(start + RATE_LIMIT_WINDOW));
    }

    #[tokio::test]
    async fn device_token_not_required_when_auth_disabled() {
        // With device auth OFF (the default), the deviceToken is ignored: a
        // device connects whether it sends a bogus token or none at all.
        let port = start_relay("secret").await;

        let mut with_tok = connect(port).await;
        send(
            &mut with_tok,
            serde_json::json!({
                "type":"hello","role":"device","hostId":"h1",
                "deviceId":"dev-tok","deviceToken":"whatever"
            }),
        )
        .await;
        assert_eq!(next_text(&mut with_tok).await["type"], "hello_ack");

        let mut without_tok = connect(port).await;
        send(&mut without_tok, hello_device("dev-none")).await;
        assert_eq!(next_text(&mut without_tok).await["type"], "hello_ack");
    }

    #[test]
    fn device_token_derivation_is_deterministic_and_keyed() {
        let a = derive_device_token("secret", "dev-1");
        let b = derive_device_token("secret", "dev-1");
        assert_eq!(a, b, "derivation must be deterministic");
        assert_eq!(a.len(), 64, "HMAC-SHA256 hex is 64 chars");
        assert_ne!(a, derive_device_token("secret", "dev-2"));
        assert_ne!(a, derive_device_token("other", "dev-1"));
        assert!(constant_time_eq(&a, &b));
        assert!(!constant_time_eq(&a, "deadbeef"));
    }

    #[tokio::test]
    async fn device_auth_required_rejects_missing_and_bad_token_accepts_correct() {
        // With device auth ON, the relay computes hex(HMAC-SHA256(token, id))
        // and requires the device to present exactly that.
        let port = start_relay_with_auth("secret", true).await;

        // Missing token → rejected.
        let mut no_tok = connect(port).await;
        send(&mut no_tok, hello_device("dev-1")).await;
        let reply = next_text(&mut no_tok).await;
        assert_eq!(reply["type"], "hello_error");
        assert_eq!(reply["reason"], "device authentication required");

        // Wrong token → rejected.
        let mut bad_tok = connect(port).await;
        send(
            &mut bad_tok,
            serde_json::json!({
                "type":"hello","role":"device","hostId":"h1",
                "deviceId":"dev-1","deviceToken":"not-the-right-token"
            }),
        )
        .await;
        let reply = next_text(&mut bad_tok).await;
        assert_eq!(reply["type"], "hello_error");
        assert_eq!(reply["reason"], "invalid device token");

        // Correct derived token → accepted.
        let good = derive_device_token("secret", "dev-1");
        let mut good_tok = connect(port).await;
        send(
            &mut good_tok,
            serde_json::json!({
                "type":"hello","role":"device","hostId":"h1",
                "deviceId":"dev-1","deviceToken": good
            }),
        )
        .await;
        assert_eq!(next_text(&mut good_tok).await["type"], "hello_ack");
    }

    #[tokio::test]
    async fn devices_beyond_room_cap_are_rejected() {
        let port = start_relay("secret").await;
        // Fill the room to its device cap; each gets an ack.
        let mut devices = Vec::new();
        for i in 0..MAX_DEVICES_PER_ROOM {
            let mut d = connect(port).await;
            send(&mut d, hello_device(&format!("dev-{i}"))).await;
            assert_eq!(next_text(&mut d).await["type"], "hello_ack");
            devices.push(d);
        }
        // One more device is over the cap and rejected.
        let mut extra = connect(port).await;
        send(&mut extra, hello_device("dev-extra")).await;
        let reply = next_text(&mut extra).await;
        assert_eq!(reply["type"], "hello_error");
        assert_eq!(reply["reason"], "too many devices");
    }
}
