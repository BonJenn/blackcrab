//! Desktop relay client (the "host" side).
//!
//! Connects out to a relay (`RELAY_URL`), claims its room with `RELAY_TOKEN`,
//! and bridges the relay to the same in-process machinery the LAN transport
//! uses: decrypted device actions are fed to the `RemoteCommand` channel, and
//! snapshot/broadcast events are encrypted per-device and pushed back. Every
//! frame is end-to-end encrypted with the device's pairing key, so the relay
//! only ever moves ciphertext.
//!
//! Disabled unless both `RELAY_URL` and `RELAY_TOKEN` are set; the LAN path is
//! unaffected.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tokio::sync::mpsc::UnboundedSender;
use tokio::time::interval;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::crypto::{self, SealedFrame};
use crate::transport::RemoteCommand;

const PROTOCOL_VERSION: u16 = 1;
const PUSH_INTERVAL: Duration = Duration::from_secs(15);
const BACKOFF_SECS: [u64; 5] = [1, 2, 5, 15, 30];

/// Looks up the base64 E2E key for a paired device id.
pub(crate) type KeyLookup = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;
/// Produces the current host->mobile event bodies (protocol shape).
pub(crate) type EventSnapshot = Arc<dyn Fn() -> Vec<serde_json::Value> + Send + Sync>;

pub(crate) struct RelayClient {
    pub url: String,
    pub token: String,
    pub host_id: String,
    pub commands: UnboundedSender<RemoteCommand>,
    pub key_for_device: KeyLookup,
    pub events: EventSnapshot,
    pub broadcast: broadcast::Sender<serde_json::Value>,
}

impl RelayClient {
    /// Connect-and-bridge forever, reconnecting with bounded backoff.
    pub async fn run(self) {
        let mut attempt = 0usize;
        loop {
            if let Err(e) = self.connect_once().await {
                eprintln!("relay client: {e}");
            }
            let delay = BACKOFF_SECS[attempt.min(BACKOFF_SECS.len() - 1)];
            attempt = attempt.saturating_add(1);
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
    }

    async fn connect_once(&self) -> Result<(), String> {
        let (ws, _) = tokio_tungstenite::connect_async(&self.url)
            .await
            .map_err(|e| format!("connect {}: {e}", self.url))?;
        let (mut sink, mut read) = ws.split();

        // Claim our room.
        send_json(
            &mut sink,
            serde_json::json!({
                "type": "hello",
                "role": "host",
                "hostId": self.host_id,
                "token": self.token,
            }),
        )
        .await?;

        let mut devices: HashSet<String> = HashSet::new();
        let mut pushes = self.broadcast.subscribe();
        let mut heartbeat = interval(PUSH_INTERVAL);
        heartbeat.tick().await; // skip the immediate tick

        loop {
            tokio::select! {
                incoming = read.next() => {
                    match incoming {
                        Some(Ok(WsMessage::Text(t))) => {
                            self.handle_frame(&t, &mut devices, &mut sink).await?;
                        }
                        Some(Ok(WsMessage::Close(_))) | None => break,
                        Some(Ok(_)) => {}
                        Some(Err(e)) => return Err(format!("ws read: {e}")),
                    }
                }
                pushed = pushes.recv() => {
                    if let Ok(body) = pushed {
                        self.push_event(&devices, &body, &mut sink).await?;
                    }
                }
                _ = heartbeat.tick() => {
                    for body in (self.events)() {
                        self.push_event(&devices, &body, &mut sink).await?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Handle one cleartext relay frame.
    async fn handle_frame<S>(
        &self,
        text: &str,
        devices: &mut HashSet<String>,
        sink: &mut S,
    ) -> Result<(), String>
    where
        S: SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(text) else {
            return Ok(());
        };
        match frame.get("type").and_then(|t| t.as_str()) {
            Some("hello_error") => {
                return Err(format!(
                    "relay rejected host: {}",
                    frame.get("reason").and_then(|r| r.as_str()).unwrap_or("")
                ));
            }
            Some("presence") => {
                let Some(device_id) = frame.get("deviceId").and_then(|d| d.as_str()) else {
                    return Ok(());
                };
                match frame.get("event").and_then(|e| e.as_str()) {
                    Some("joined") => {
                        devices.insert(device_id.to_string());
                        // Catch this device up immediately with the snapshot.
                        for body in (self.events)() {
                            self.push_event_to(device_id, &body, sink).await?;
                        }
                    }
                    Some("left") => {
                        devices.remove(device_id);
                    }
                    _ => {}
                }
            }
            Some("data") => {
                let from = frame.get("from").and_then(|f| f.as_str());
                let Some(from) = from else { return Ok(()) };
                let Some(key) = (self.key_for_device)(from) else {
                    return Ok(()); // unknown device — drop
                };
                let Ok(sealed) = serde_json::from_value::<SealedFrame>(
                    frame.get("payload").cloned().unwrap_or(serde_json::Value::Null),
                ) else {
                    return Ok(());
                };
                if let Some(plaintext) = crypto::open(&key, &sealed) {
                    if let Some(command) = command_from_envelope(&plaintext) {
                        let _ = self.commands.send(command);
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn push_event<S>(
        &self,
        devices: &HashSet<String>,
        body: &serde_json::Value,
        sink: &mut S,
    ) -> Result<(), String>
    where
        S: SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    {
        for device_id in devices {
            self.push_event_to(device_id, body, sink).await?;
        }
        Ok(())
    }

    async fn push_event_to<S>(
        &self,
        device_id: &str,
        body: &serde_json::Value,
        sink: &mut S,
    ) -> Result<(), String>
    where
        S: SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    {
        let Some(key) = (self.key_for_device)(device_id) else {
            return Ok(());
        };
        let envelope = serde_json::json!({ "v": PROTOCOL_VERSION, "msg": body }).to_string();
        let Some(sealed) = crypto::seal(&key, &envelope) else {
            return Ok(());
        };
        send_json(
            sink,
            serde_json::json!({
                "type": "data",
                "to": device_id,
                "payload": sealed,
            }),
        )
        .await
    }
}

/// Decode a decrypted protocol envelope into a `RemoteCommand`, if it carries a
/// supported action. Mirrors the action decode in `transport.rs`, but from JSON
/// (the LAN path uses the typed wire enum).
fn command_from_envelope(plaintext: &str) -> Option<RemoteCommand> {
    let value: serde_json::Value = serde_json::from_str(plaintext).ok()?;
    let msg = value.get("msg")?;
    let session = || msg.get("sessionId").and_then(|s| s.as_str()).map(String::from);
    let approval = || msg.get("approvalId").and_then(|s| s.as_str()).map(String::from);
    match msg.get("type").and_then(|t| t.as_str())? {
        "send_message" => Some(RemoteCommand::SendMessage {
            session_id: session()?,
            body: msg.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string(),
        }),
        "stop_session" => Some(RemoteCommand::StopSession {
            session_id: session()?,
        }),
        "approve" => Some(RemoteCommand::Approve {
            approval_id: approval()?,
        }),
        "deny" => Some(RemoteCommand::Deny {
            approval_id: approval()?,
            reason: msg.get("reason").and_then(|r| r.as_str()).map(String::from),
        }),
        "focus_session" => Some(RemoteCommand::FocusSession {
            session_id: session()?,
        }),
        "set_read_cursor" => Some(RemoteCommand::SetReadCursor {
            session_id: session()?,
            last_read_message_id: msg
                .get("lastReadMessageId")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            read_at_ms: msg.get("readAtMs").and_then(|n| n.as_i64()).unwrap_or(0),
        }),
        _ => None,
    }
}

async fn send_json<S>(sink: &mut S, value: serde_json::Value) -> Result<(), String>
where
    S: SinkExt<WsMessage, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    sink.send(WsMessage::Text(value.to_string().into()))
        .await
        .map_err(|e| format!("ws send: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    use futures_util::SinkExt;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;
    use tokio::time::{timeout, Duration};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    fn test_key() -> String {
        B64.encode((1u8..=32).collect::<Vec<u8>>())
    }

    #[test]
    fn decodes_set_read_cursor_action() {
        let plaintext = serde_json::json!({
            "v": 1,
            "msg": {
                "type": "set_read_cursor",
                "hostId": "h1",
                "sessionId": "s1",
                "lastReadMessageId": "msg-7",
                "readAtMs": 1_700_000_000_000_i64,
            }
        })
        .to_string();
        assert_eq!(
            command_from_envelope(&plaintext),
            Some(RemoteCommand::SetReadCursor {
                session_id: "s1".into(),
                last_read_message_id: "msg-7".into(),
                read_at_ms: 1_700_000_000_000,
            })
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn host_bridges_actions_and_events_over_relay() {
        // Real relay.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            blackcrab_relay::serve(
                listener,
                blackcrab_relay::RelayConfig {
                    token: "tok".into(),
                },
            )
            .await
        });

        let key = test_key();
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<RemoteCommand>();
        let (bcast_tx, _bcast_rx) = broadcast::channel::<serde_json::Value>(16);
        let key_for = {
            let key = key.clone();
            Arc::new(move |dev: &str| if dev == "dev-1" { Some(key.clone()) } else { None })
                as KeyLookup
        };
        let events: EventSnapshot = Arc::new(|| {
            vec![serde_json::json!({"type":"sessions","hostId":"h1","sessions":[]})]
        });

        let client = RelayClient {
            url: format!("ws://127.0.0.1:{port}/"),
            token: "tok".into(),
            host_id: "h1".into(),
            commands: cmd_tx,
            key_for_device: key_for,
            events,
            broadcast: bcast_tx.clone(),
        };
        tokio::spawn(client.run());

        // Simulated device.
        let url = format!("ws://127.0.0.1:{port}/");
        let (mut dev, _) = tokio_tungstenite::connect_async(url.into_client_request().unwrap())
            .await
            .unwrap();
        dev.send(WsMessage::Text(
            serde_json::json!({"type":"hello","role":"device","hostId":"h1","deviceId":"dev-1"})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();

        // Drain until we get the snapshot the host pushes on join. This also
        // confirms the host connected and learned about us.
        let snapshot = timeout(Duration::from_secs(5), async {
            loop {
                if let WsMessage::Text(t) = dev.next().await.unwrap().unwrap() {
                    let v: serde_json::Value = serde_json::from_str(&t).unwrap();
                    if v["type"] == "data" {
                        return v;
                    }
                }
            }
        })
        .await
        .expect("snapshot frame");
        let sealed: SealedFrame = serde_json::from_value(snapshot["payload"].clone()).unwrap();
        let opened = crypto::open(&key, &sealed).unwrap();
        let env: serde_json::Value = serde_json::from_str(&opened).unwrap();
        assert_eq!(env["msg"]["type"], "sessions");

        // Device sends a sealed action; it should reach the command channel.
        let action = serde_json::json!({
            "v": 1,
            "msg": {"type":"send_message","hostId":"h1","sessionId":"s1","body":"hi"}
        })
        .to_string();
        let sealed_action = crypto::seal(&key, &action).unwrap();
        dev.send(WsMessage::Text(
            serde_json::json!({"type":"data","payload": sealed_action})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();

        let command = timeout(Duration::from_secs(5), cmd_rx.recv())
            .await
            .expect("command arrives")
            .expect("channel open");
        assert_eq!(
            command,
            RemoteCommand::SendMessage {
                session_id: "s1".into(),
                body: "hi".into(),
            }
        );

        // A broadcast event should reach the device, decryptable.
        bcast_tx
            .send(serde_json::json!({"type":"approval_requested","approval":{"id":"a1"}}))
            .unwrap();
        let pushed = timeout(Duration::from_secs(5), async {
            loop {
                if let WsMessage::Text(t) = dev.next().await.unwrap().unwrap() {
                    let v: serde_json::Value = serde_json::from_str(&t).unwrap();
                    if v["type"] == "data" {
                        let sealed: SealedFrame =
                            serde_json::from_value(v["payload"].clone()).unwrap();
                        let opened = crypto::open(&key, &sealed).unwrap();
                        let env: serde_json::Value = serde_json::from_str(&opened).unwrap();
                        if env["msg"]["type"] == "approval_requested" {
                            return env;
                        }
                    }
                }
            }
        })
        .await
        .expect("broadcast frame");
        assert_eq!(pushed["msg"]["approval"]["id"], "a1");
    }
}
