//! Private Codex app-server JSONL transport. Provider/session wiring follows
//! separately; this module does not advertise a runnable Codex provider yet.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{timeout, Instant};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) enum RpcId {
    String(String),
    Number(serde_json::Number),
}
impl RpcId {
    fn parse(value: &Value) -> Result<Self, RpcError> {
        match value {
            Value::String(id) => Ok(Self::String(id.clone())),
            Value::Number(id) if id.is_i64() || id.is_u64() => Ok(Self::Number(id.clone())),
            _ => Err(RpcError::Protocol("invalid RPC identifier")),
        }
    }
    fn value(&self) -> Value {
        match self {
            Self::String(id) => json!(id),
            Self::Number(id) => json!(id),
        }
    }
}
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum RpcError {
    Busy,
    Closed,
    Timeout,
    Transport(&'static str),
    Protocol(&'static str),
    Remote {
        code: i64,
        message: String,
        data: Option<Value>,
    },
}
#[derive(Debug, PartialEq)]
pub(crate) enum RpcEvent {
    Notification {
        method: String,
        params: Option<Value>,
    },
    Request {
        id: RpcId,
        method: String,
        params: Option<Value>,
    },
    Closed(RpcError),
}
enum Incoming {
    Event(RpcEvent),
    Response {
        id: RpcId,
        result: Result<Value, RpcError>,
    },
}
fn decode(line: &[u8]) -> Result<Incoming, RpcError> {
    let value: Value =
        serde_json::from_slice(line).map_err(|_| RpcError::Protocol("invalid JSONL message"))?;
    let object = value
        .as_object()
        .ok_or(RpcError::Protocol("RPC message is not an object"))?;
    if object
        .get("jsonrpc")
        .is_some_and(|version| version != "2.0")
    {
        return Err(RpcError::Protocol("unsupported RPC version"));
    }
    if let Some(method) = object.get("method") {
        let method = method
            .as_str()
            .filter(|method| !method.is_empty())
            .ok_or(RpcError::Protocol("invalid RPC method"))?
            .to_string();
        if object.contains_key("result") || object.contains_key("error") {
            return Err(RpcError::Protocol("ambiguous RPC message"));
        }
        let params = object.get("params").cloned();
        return Ok(Incoming::Event(match object.get("id") {
            Some(id) => RpcEvent::Request {
                id: RpcId::parse(id)?,
                method,
                params,
            },
            None => RpcEvent::Notification { method, params },
        }));
    }
    let id = RpcId::parse(
        object
            .get("id")
            .ok_or(RpcError::Protocol("response has no identifier"))?,
    )?;
    let result = match (object.get("result"), object.get("error")) {
        (Some(result), None) => Ok(result.clone()),
        (None, Some(error)) => Err(RpcError::Remote {
            code: error
                .get("code")
                .and_then(Value::as_i64)
                .ok_or(RpcError::Protocol("invalid RPC error code"))?,
            message: error
                .get("message")
                .and_then(Value::as_str)
                .ok_or(RpcError::Protocol("invalid RPC error message"))?
                .into(),
            data: error.get("data").cloned(),
        }),
        _ => return Err(RpcError::Protocol("response must have one result or error")),
    };
    Ok(Incoming::Response { id, result })
}

/// Bound before allocating/decoding a complete frame, including unterminated data.
async fn read_frame(
    reader: &mut (impl AsyncBufRead + Unpin),
    max: usize,
) -> Result<Option<Vec<u8>>, RpcError> {
    let mut frame = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|_| RpcError::Transport("provider stdout read failed"))?;
        if available.is_empty() {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err(RpcError::Protocol("unterminated JSONL frame"))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let count = newline.unwrap_or(available.len());
        if frame.len().saturating_add(count) > max {
            return Err(RpcError::Protocol("RPC frame exceeds limit"));
        }
        frame.extend_from_slice(&available[..count]);
        reader.consume(count + usize::from(newline.is_some()));
        if newline.is_some() {
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            if frame.is_empty() {
                continue;
            }
            return Ok(Some(frame));
        }
    }
}
fn wire(value: Value, max: usize) -> Result<Vec<u8>, RpcError> {
    let mut bytes =
        serde_json::to_vec(&value).map_err(|_| RpcError::Protocol("RPC encoding failed"))?;
    if bytes.len() > max {
        return Err(RpcError::Protocol("RPC frame exceeds limit"));
    }
    bytes.push(b'\n');
    Ok(bytes)
}
#[derive(Clone, Copy)]
pub(crate) struct Options {
    pub request_timeout: Duration,
    pub max_frame_bytes: usize,
    pub capacity: usize,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            request_timeout: Duration::from_secs(30),
            max_frame_bytes: 8 * 1024 * 1024,
            capacity: 64,
        }
    }
}
type Reply = oneshot::Sender<Result<Value, RpcError>>;
enum ClientCommand {
    Request {
        method: String,
        params: Option<Value>,
        deadline: Instant,
        reply: Reply,
    },
    Notify {
        method: String,
        params: Option<Value>,
        reply: Reply,
    },
    Respond {
        id: RpcId,
        result: Result<Value, RpcError>,
        reply: Reply,
    },
    Close,
}
struct Write {
    bytes: Vec<u8>,
    reply: Option<Reply>,
}
struct Pending {
    deadline: Instant,
    reply: Reply,
}
#[derive(Clone)]
pub(crate) struct Client {
    commands: mpsc::Sender<ClientCommand>,
    options: Options,
    #[cfg(test)]
    stderr_bytes: Arc<AtomicU64>,
    completion: watch::Receiver<bool>,
}
impl Client {
    /// The caller supplies executable, cwd and environment. No shell, network
    /// listener, auth override, login or automatic process reconnect is added.
    pub async fn connect(
        mut command: Command,
        options: Options,
    ) -> Result<(Self, mpsc::Receiver<RpcEvent>), RpcError> {
        if options.capacity == 0
            || options.capacity > 1024
            || options.max_frame_bytes == 0
            || options.request_timeout.is_zero()
        {
            return Err(RpcError::Protocol("invalid transport limits"));
        }
        command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| RpcError::Transport("could not start Codex app-server"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or(RpcError::Transport("provider stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or(RpcError::Transport("provider stdout unavailable"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or(RpcError::Transport("provider stderr unavailable"))?;
        let (commands, receiver) = mpsc::channel(options.capacity);
        let (events, event_rx) = mpsc::channel(options.capacity);
        let (writer, write_rx) = mpsc::channel(options.capacity);
        let (failed, failure) = oneshot::channel();
        let (completed, completion) = watch::channel(false);
        let stderr_bytes = Arc::new(AtomicU64::new(0));
        let count = stderr_bytes.clone();
        let stderr_task = tokio::spawn(async move {
            let mut buffer = [0u8; 4096];
            while let Ok(count_read) = stderr.read(&mut buffer).await {
                if count_read == 0 {
                    break;
                }
                count.fetch_add(count_read as u64, Ordering::Relaxed);
            }
        });
        let writer_task =
            tokio::spawn(write_loop(stdin, write_rx, failed, options.request_timeout));
        tokio::spawn(async move {
            let reason = run(
                receiver,
                writer,
                events.clone(),
                BufReader::new(stdout),
                failure,
                options,
            )
            .await;
            writer_task.abort();
            let _ = writer_task.await;
            let _ = child.start_kill();
            let _ = timeout(Duration::from_secs(2), child.wait()).await;
            stderr_task.abort();
            let _ = stderr_task.await;
            let _ = completed.send(true);
            let _ = events.try_send(RpcEvent::Closed(reason));
        });
        let client = Self {
            commands,
            options,
            #[cfg(test)]
            stderr_bytes,
            completion,
        };
        let handshake=async {
            let result=client.request_internal("initialize",Some(json!({"clientInfo":{"name":"blackcrab","title":"Blackcrab","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":false}}))).await?;
            if result.get("userAgent").and_then(Value::as_str).is_none() { return Err(RpcError::Protocol("invalid initialize result")); }
            client.notify_internal("initialized",None).await?;
            Ok::<(),RpcError>(())
        }.await;
        if let Err(error) = handshake {
            client.close().await;
            return Err(error);
        }
        Ok((client, event_rx))
    }
    fn send(&self, command: ClientCommand) -> Result<(), RpcError> {
        self.commands
            .try_send(command)
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => RpcError::Busy,
                mpsc::error::TrySendError::Closed(_) => RpcError::Closed,
            })
    }
    async fn request_internal(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, RpcError> {
        let (reply, result) = oneshot::channel();
        self.send(ClientCommand::Request {
            method: method.into(),
            params,
            deadline: Instant::now() + self.options.request_timeout,
            reply,
        })?;
        result.await.unwrap_or(Err(RpcError::Closed))
    }
    pub async fn request(&self, method: &str, params: Option<Value>) -> Result<Value, RpcError> {
        check_method(method)?;
        self.request_internal(method, params).await
    }
    async fn notify_internal(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, RpcError> {
        let (reply, result) = oneshot::channel();
        self.send(ClientCommand::Notify {
            method: method.into(),
            params,
            reply,
        })?;
        result.await.unwrap_or(Err(RpcError::Closed))
    }
    #[cfg(test)]
    pub async fn notify(&self, method: &str, params: Option<Value>) -> Result<(), RpcError> {
        check_method(method)?;
        self.notify_internal(method, params).await.map(|_| ())
    }
    pub async fn respond(
        &self,
        id: RpcId,
        result: Result<Value, RpcError>,
    ) -> Result<(), RpcError> {
        let (reply, ack) = oneshot::channel();
        self.send(ClientCommand::Respond { id, result, reply })?;
        ack.await.unwrap_or(Err(RpcError::Closed)).map(|_| ())
    }
    #[cfg(test)]
    pub fn stderr_bytes(&self) -> u64 {
        self.stderr_bytes.load(Ordering::Relaxed)
    }
    pub async fn close(&self) {
        let mut completion = self.completion.clone();
        let _ = timeout(
            self.options.request_timeout + Duration::from_secs(3),
            async {
                let _ = self.commands.send(ClientCommand::Close).await;
                let _ = completion.wait_for(|closed| *closed).await;
            },
        )
        .await;
    }
}
fn check_method(method: &str) -> Result<(), RpcError> {
    if method.is_empty() || ["initialize", "initialized"].contains(&method) {
        Err(RpcError::Protocol("reserved or empty RPC method"))
    } else {
        Ok(())
    }
}
async fn write_loop(
    mut stdin: ChildStdin,
    mut writes: mpsc::Receiver<Write>,
    failure: oneshot::Sender<RpcError>,
    duration: Duration,
) {
    while let Some(write) = writes.recv().await {
        let result = timeout(duration, async {
            stdin.write_all(&write.bytes).await?;
            stdin.flush().await
        })
        .await;
        let error = match result {
            Ok(Ok(())) => None,
            Ok(Err(_)) => Some(RpcError::Transport("provider stdin write failed")),
            Err(_) => Some(RpcError::Timeout),
        };
        if let Some(error) = error {
            if let Some(reply) = write.reply {
                let _ = reply.send(Err(error.clone()));
            }
            let _ = failure.send(error);
            return;
        }
        if let Some(reply) = write.reply {
            let _ = reply.send(Ok(Value::Null));
        }
    }
}
async fn run(
    mut commands: mpsc::Receiver<ClientCommand>,
    writer: mpsc::Sender<Write>,
    events: mpsc::Sender<RpcEvent>,
    mut reader: impl AsyncBufRead + Unpin,
    mut failure: oneshot::Receiver<RpcError>,
    options: Options,
) -> RpcError {
    let mut next = 0u64;
    let mut pending: HashMap<RpcId, Pending> = HashMap::new();
    let mut server_requests = HashSet::new();
    // Keep one frame future alive while selecting commands: cancelling a
    // partially consumed JSONL read would discard its prefix.
    let reason = {
        let mut reading = Box::pin(read_frame(&mut reader, options.max_frame_bytes));
        loop {
            let deadline = pending
                .values()
                .map(|value| value.deadline)
                .min()
                .unwrap_or_else(|| Instant::now() + Duration::from_secs(86400));
            tokio::select! {
                _=events.closed()=>break RpcError::Closed,
                error=&mut failure => break error.unwrap_or(RpcError::Closed),
                _=tokio::time::sleep_until(deadline),if !pending.is_empty()=>break RpcError::Timeout,
                frame=&mut reading=> {
                    let message=match frame {Ok(Some(frame))=>match decode(&frame){Ok(message)=>message,Err(error)=>break error},Ok(None)=>break RpcError::Closed,Err(error)=>break error};
                    // End the completed read's borrow before starting another.
                    drop(reading);
                    reading=Box::pin(read_frame(&mut reader,options.max_frame_bytes));
                    match message {
                        Incoming::Response {id,result}=>{if let Some(request)=pending.remove(&id){let _=request.reply.send(result);}},
                        Incoming::Event(event)=>{
                            if let RpcEvent::Request {id,..}=&event {
                                if server_requests.len()>=options.capacity || !server_requests.insert(id.clone()) {break RpcError::Protocol("too many or duplicate server requests");}
                            }
                            if events.try_send(event).is_err() {break RpcError::Protocol("RPC event consumer fell behind or closed");}
                        },
                    }
                },
                command=commands.recv()=> {
                    let Some(command)=command else {break RpcError::Closed;};
                    match command {
                        ClientCommand::Request {method,params,deadline,reply}=>{
                            if deadline<=Instant::now() {let _=reply.send(Err(RpcError::Timeout));continue;}
                            if pending.len()>=options.capacity {let _=reply.send(Err(RpcError::Busy));continue;}
                            let Some(id)=next.checked_add(1) else {let _=reply.send(Err(RpcError::Closed));break RpcError::Closed;};next=id;
                            let mut message=json!({"id":id,"method":method});if let Some(params)=params{message["params"]=params;}
                            let bytes=match wire(message,options.max_frame_bytes){Ok(bytes)=>bytes,Err(error)=>{let _=reply.send(Err(error));continue;}};
                            match writer.try_send(Write {bytes,reply:None}) {
                                Ok(())=>{pending.insert(RpcId::Number(id.into()),Pending {deadline,reply});},
                                Err(_)=>{let _=reply.send(Err(RpcError::Busy));},
                            }
                        },
                        ClientCommand::Notify {method,params,reply}=>{
                            let mut message=json!({"method":method});if let Some(params)=params{message["params"]=params;}
                            match wire(message,options.max_frame_bytes) {
                                Ok(bytes)=>{if let Err(error)=writer.try_send(Write {bytes,reply:Some(reply)}){if let Some(reply)=error.into_inner().reply{let _=reply.send(Err(RpcError::Busy));}}},
                                Err(error)=>{let _=reply.send(Err(error));},
                            }
                        },
                        ClientCommand::Respond {id,result,reply}=>{
                            if !server_requests.contains(&id) {let _=reply.send(Err(RpcError::Protocol("unknown server request")));continue;}
                            let message=match result {
                                Ok(result)=>json!({"id":id.value(),"result":result}),
                                Err(RpcError::Remote {code,message,data})=>{let mut error=json!({"code":code,"message":message});if let Some(data)=data{error["data"]=data;}json!({"id":id.value(),"error":error})},
                                Err(_)=>{let _=reply.send(Err(RpcError::Protocol("server replies require a result or RPC error")));continue;},
                            };
                            match wire(message,options.max_frame_bytes) {
                                Ok(bytes)=>match writer.try_send(Write {bytes,reply:Some(reply)}) {
                                    Ok(())=>{server_requests.remove(&id);},
                                    Err(error)=>{if let Some(reply)=error.into_inner().reply{let _=reply.send(Err(RpcError::Busy));}},
                                },
                                Err(error)=>{let _=reply.send(Err(error));},
                            }
                        },
                        ClientCommand::Close=>break RpcError::Closed,
                    }
                },
            }
        }
    };
    for (_, request) in pending {
        let _ = request.reply.send(Err(reason.clone()));
    }
    reason
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn partial_frame_reader_keeps_its_prefix_when_another_branch_runs() {
        let (mut writer, reader) = tokio::io::duplex(32);
        writer.write_all(br#"{"method":"fixture"#).await.unwrap();
        let mut reader = BufReader::new(reader);
        let mut frame = Box::pin(read_frame(&mut reader, 128));
        tokio::select! {
            biased;
            _=&mut frame=>panic!("partial frame completed too soon"),
            _=std::future::ready(())=>{},
        }
        writer.write_all(br#"/ready"}"#).await.unwrap();
        writer.write_all(b"\n").await.unwrap();
        let bytes = frame.await.unwrap().unwrap();
        assert!(
            matches!(decode(&bytes).unwrap(),Incoming::Event(RpcEvent::Notification {method,..}) if method=="fixture/ready")
        );
    }

    #[test]
    fn framing_rejects_ambiguous_and_invalid_messages_without_echoing_payloads() {
        for value in [
            json!([]),
            json!({"id":null,"result":null}),
            json!({"id":1.5,"result":null}),
            json!({"id":1,"result":null,"error":{}}),
            json!({"method":"secret","result":null}),
            json!({"id":1,"error":{"code":"bad","message":"secret"}}),
            json!({"jsonrpc":"1.0","method":"test"}),
        ] {
            let error = decode(&serde_json::to_vec(&value).unwrap()).err().unwrap();
            assert!(!format!("{error:?}").contains("secret"));
        }
        assert!(matches!(
            decode(br#"{"id":"s","result":null}"#).unwrap(),
            Incoming::Response {
                id: RpcId::String(_),
                result: Ok(Value::Null)
            }
        ));
        assert!(
            wire(json!({"body":"line\nsecond"}), 100)
                .unwrap()
                .iter()
                .filter(|byte| **byte == b'\n')
                .count()
                == 1
        );
    }

    fn command(case: &str) -> Command {
        let mut command = Command::new("python3");
        command
            .arg("-u")
            .arg(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/codex_rpc.py"
            ))
            .arg(case);
        command
    }
    fn options() -> Options {
        Options {
            request_timeout: Duration::from_secs(2),
            max_frame_bytes: 2048,
            capacity: 8,
        }
    }
    async fn connect() -> (Client, mpsc::Receiver<RpcEvent>) {
        Client::connect(command("normal"), options()).await.unwrap()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn initialization_precedes_work_and_responses_correlate_out_of_order() {
        let (client, _events) = connect().await;
        let (a, b) = tokio::join!(
            client.request("fixture/reverse", Some(json!({"value":"a"}))),
            client.request("fixture/reverse", Some(json!({"value":"b"})))
        );
        assert_eq!(a.unwrap(), json!({"value":"a"}));
        assert_eq!(b.unwrap(), json!({"value":"b"}));
        assert!(client.request("initialize", None).await.is_err());
        assert!(client.notify("initialized", None).await.is_err());
        client.close().await;
        assert_eq!(
            client.request("fixture/echo", None).await,
            Err(RpcError::Closed)
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn server_requests_and_client_replies_with_the_same_id_stay_separate() {
        let (client, mut events) = connect().await;
        assert_eq!(
            client.request("fixture/interleave", None).await.unwrap(),
            json!({"accepted":true})
        );
        let event = events.recv().await.unwrap();
        let RpcEvent::Request { id, method, .. } = event else {
            panic!("expected server approval request")
        };
        assert_eq!(method, "item/commandExecution/requestApproval");
        assert!(
            matches!(events.recv().await.unwrap(),RpcEvent::Notification {method,..} if method=="item/agentMessage/delta")
        );
        client
            .respond(
                id.clone(),
                Err(RpcError::Remote {
                    code: -32601,
                    message: "Not supported by fixture consumer".into(),
                    data: None,
                }),
            )
            .await
            .unwrap();
        let RpcEvent::Notification {
            params: Some(value),
            ..
        } = events.recv().await.unwrap()
        else {
            panic!("expected response observation")
        };
        assert_eq!(value["error"]["code"], -32601);
        assert!(client
            .respond(id, Ok(json!({"decision":"accept"})))
            .await
            .is_err());
        client.close().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn partial_frames_survive_command_arrivals_and_remote_errors_do_not_close_the_connection()
    {
        let (client, mut events) = connect().await;
        let partial = client.request("fixture/partial", None);
        // Concurrent calls are queued in deterministic join order.
        let (first, last) = tokio::join!(partial, client.request("fixture/finish_partial", None));
        assert_eq!(first.unwrap(), json!("original"));
        assert_eq!(last.unwrap(), json!("finished"));
        assert!(
            matches!(events.recv().await.unwrap(),RpcEvent::Notification {params:Some(value),..} if value["intact"]==true)
        );
        let error = client.request("fixture/error", None).await.unwrap_err();
        assert!(matches!(error, RpcError::Remote { code: -32602, .. }));
        assert_eq!(
            client
                .request("fixture/echo", Some(json!("still alive")))
                .await
                .unwrap(),
            json!("still alive")
        );
        client.close().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn malformed_unterminated_and_oversized_frames_close_pending_work() {
        for method in [
            "fixture/malformed",
            "fixture/exit",
            "fixture/oversize",
            "fixture/duplicate_request",
        ] {
            let (client, _events) = connect().await;
            assert!(matches!(
                client.request(method, None).await,
                Err(RpcError::Protocol(_))
            ));
            client.close().await;
            assert_eq!(
                client.request("fixture/echo", None).await,
                Err(RpcError::Closed)
            );
        }
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn stderr_is_drained_without_retaining_sensitive_diagnostics() {
        let (client, _events) = connect().await;
        assert_eq!(
            client.request("fixture/noise", None).await.unwrap(),
            json!("drained")
        );
        assert!(client.stderr_bytes() > 4096);
        client.close().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn event_overflow_fails_closed_instead_of_dropping_approval_events() {
        let (client, _events) = connect().await;
        assert!(matches!(
            client.request("fixture/flood", None).await,
            Err(RpcError::Protocol(_))
        ));
        client.close().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_closes_the_connection_without_replaying_work_and_reaps_the_process() {
        let (client, _events) = connect().await;
        let pid = client
            .request("fixture/pid", None)
            .await
            .unwrap()
            .as_i64()
            .unwrap();
        assert_eq!(
            client.request("fixture/hold", None).await,
            Err(RpcError::Timeout)
        );
        client.close().await;
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn failed_initialization_does_not_expose_a_usable_client() {
        assert!(matches!(
            Client::connect(command("bad_handshake"), options()).await,
            Err(RpcError::Remote { code: -32000, .. })
        ));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn blocked_stdin_does_not_block_timeout_or_process_cleanup() {
        let mut limits = options();
        limits.max_frame_bytes = 2 * 1024 * 1024;
        let (client, _events) = Client::connect(command("blocked_stdin"), limits)
            .await
            .unwrap();
        assert_eq!(
            client
                .request("fixture/hold", Some(json!({"body":"x".repeat(1024*1024)})))
                .await,
            Err(RpcError::Timeout)
        );
        client.close().await;
        assert!(*client.completion.borrow());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_the_last_client_reaps_its_process() {
        let (client, _events) = connect().await;
        let pid = client
            .request("fixture/pid", None)
            .await
            .unwrap()
            .as_i64()
            .unwrap();
        let mut completion = client.completion.clone();
        drop(client);
        timeout(
            Duration::from_secs(3),
            completion.wait_for(|closed| *closed),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(unsafe { libc::kill(pid as i32, 0) }, -1);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn pending_request_capacity_rejects_new_work_without_stopping_existing_work() {
        let mut limits = options();
        limits.capacity = 1;
        let (client, mut events) = Client::connect(command("normal"), limits).await.unwrap();
        let cloned = client.clone();
        let pending = tokio::spawn(async move { cloned.request("fixture/hold", None).await });
        assert!(
            matches!(events.recv().await.unwrap(),RpcEvent::Notification {method,..} if method=="fixture/holding")
        );
        assert_eq!(
            client.request("fixture/echo", None).await,
            Err(RpcError::Busy)
        );
        client.close().await;
        assert_eq!(pending.await.unwrap(), Err(RpcError::Closed));
    }
    #[tokio::test]
    #[ignore = "opt-in installed CLI initialization only; no thread or model turn"]
    async fn installed_cli_initialization_smoke() {
        let mut command = Command::new("codex");
        command.args(["app-server", "--listen", "stdio://"]);
        let (client, _events) = Client::connect(command, Options::default()).await.unwrap();
        client.close().await;
    }
}
