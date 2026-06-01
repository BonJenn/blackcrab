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
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::time::{timeout, Duration};
use tokio_tungstenite::tungstenite::Message as WsMessage;

const HELLO_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
pub struct RelayConfig {
    /// Shared secret a host must present to claim a room.
    pub token: String,
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
    },
    HelloAck,
    HelloError {
        reason: String,
    },
    Data {
        /// Target device for host→device frames; ignored device→host.
        #[serde(rename = "to", default, skip_serializing_if = "Option::is_none")]
        to: Option<String>,
        payload: serde_json::Value,
    },
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
    loop {
        match listener.accept().await {
            Ok((stream, _peer)) => {
                let rooms = rooms.clone();
                let config = config.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, rooms, config).await {
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
) -> Result<(), String> {
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
        }) => {
            if role == Role::Host && token.as_deref() != Some(config.token.as_str()) {
                let _ = sink
                    .send(error_frame("invalid relay token"))
                    .await;
                return Ok(());
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
    let registered = {
        let mut guard = rooms.lock().unwrap();
        let room = guard.entry(host_id.clone()).or_default();
        match role {
            Role::Host if room.host.is_some() => false,
            Role::Host => {
                room.host = Some(tx.clone());
                true
            }
            Role::Device => {
                room.devices.insert(device_key.clone(), tx.clone());
                true
            }
        }
    };
    if !registered {
        let _ = sink.send(error_frame("host already connected")).await;
        return Ok(());
    }
    send_frame(&tx, &RelayFrame::HelloAck);

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
    while let Some(Ok(msg)) = read.next().await {
        let text = match msg {
            WsMessage::Text(t) => t,
            WsMessage::Close(_) => break,
            WsMessage::Ping(_) | WsMessage::Pong(_) | WsMessage::Binary(_) | WsMessage::Frame(_) => {
                continue
            }
        };
        let Ok(RelayFrame::Data { to, payload }) = serde_json::from_str::<RelayFrame>(&text) else {
            continue;
        };
        route_data(&rooms, &host_id, role, to.as_deref(), payload);
    }

    // Deregister on disconnect.
    {
        let mut guard = rooms.lock().unwrap();
        if let Some(room) = guard.get_mut(&host_id) {
            match role {
                Role::Host => room.host = None,
                Role::Device => {
                    room.devices.remove(&device_key);
                }
            }
            if room.host.is_none() && room.devices.is_empty() {
                guard.remove(&host_id);
            }
        }
    }
    drop(tx);
    let _ = writer.await;
    Ok(())
}

/// Forward a `data` frame to its counterpart(s), preserving the opaque payload.
fn route_data(
    rooms: &Rooms,
    host_id: &str,
    from: Role,
    to: Option<&str>,
    payload: serde_json::Value,
) {
    // Collect target senders under the lock, send after releasing it.
    let targets: Vec<(Option<String>, Tx)> = {
        let guard = rooms.lock().unwrap();
        let Some(room) = guard.get(host_id) else {
            return;
        };
        match from {
            // device -> host
            Role::Device => room.host.iter().map(|tx| (None, tx.clone())).collect(),
            // host -> a specific device (or every device if unaddressed)
            Role::Host => match to {
                Some(dev) => room
                    .devices
                    .get(dev)
                    .map(|tx| vec![(None, tx.clone())])
                    .unwrap_or_default(),
                None => room
                    .devices
                    .values()
                    .map(|tx| (None, tx.clone()))
                    .collect(),
            },
        }
    };
    for (_, tx) in targets {
        send_frame(&tx, &RelayFrame::Data {
            to: None,
            payload: payload.clone(),
        });
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
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let config = RelayConfig {
            token: token.to_string(),
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

        // host -> device, addressed
        send(
            &mut host,
            serde_json::json!({"type":"data","to":"dev-1","payload":{"nonce":"n","ciphertext":"c"}}),
        )
        .await;
        let got = next_text(&mut device).await;
        assert_eq!(got["type"], "data");
        assert_eq!(got["payload"]["ciphertext"], "c");

        // device -> host
        send(
            &mut device,
            serde_json::json!({"type":"data","payload":{"nonce":"n2","ciphertext":"c2"}}),
        )
        .await;
        let got = next_text(&mut host).await;
        assert_eq!(got["payload"]["ciphertext"], "c2");
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
}
