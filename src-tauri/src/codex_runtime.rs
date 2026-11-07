//! Codex thread/turn runtime. Host commands and client presentation are wired
//! separately; all provider writes here pass through durable execution receipts.
use crate::codex_rpc::{Client, Options as RpcOptions, RpcError, RpcEvent, RpcId};
use crate::execution::queue::{QueueChange, QueueSnapshot};
use crate::execution::{self, ExecutionContext, ExecutionStore, TurnReceipt};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::task::JoinSet;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Error {
    Closed,
    Busy,
    Protocol(&'static str),
    Journal(String),
    Rpc(RpcError),
}
impl From<RpcError> for Error {
    fn from(value: RpcError) -> Self {
        Self::Rpc(value)
    }
}
impl Error {
    fn summary(&self) -> &'static str {
        match self {
            Self::Journal(_) => "execution journal failed",
            Self::Protocol(message) => message,
            Self::Busy => "runtime command queue is full",
            Self::Closed => "runtime closed",
            Self::Rpc(_) => "Codex connection failed; review delivery before continuing",
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub(crate) enum Sandbox {
    ReadOnly,
    WorkspaceWrite,
}
impl Sandbox {
    fn wire(self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
        }
    }
}
pub(crate) struct StartOptions {
    pub cwd: String,
    pub resume_id: Option<String>,
    pub model: Option<String>,
    pub sandbox: Sandbox,
    pub rpc: RpcOptions,
}
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Info {
    pub thread_id: String,
    pub provider_thread_id: String,
    pub run_id: String,
    pub model: String,
    pub cwd: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Decision {
    Accept,
    Decline,
    Cancel,
}
impl Decision {
    fn wire(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::Decline => "decline",
            Self::Cancel => "cancel",
        }
    }
}
#[derive(Debug, serde::Serialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Event {
    Ready {
        info: Info,
    },
    User {
        text: String,
        receipt: TurnReceipt,
    },
    TurnStarted {
        receipt: TurnReceipt,
        provider_turn_id: String,
    },
    Item {
        command_id: String,
        provider_turn_id: String,
        item: Value,
        completed: bool,
    },
    TextDelta {
        command_id: String,
        provider_turn_id: String,
        item_id: String,
        text: String,
    },
    Usage {
        command_id: String,
        provider_turn_id: String,
        usage: Value,
    },
    ApprovalRequested {
        approval_id: String,
        command_id: String,
        provider_turn_id: String,
        method: String,
        params: Value,
    },
    ApprovalResolved {
        approval_id: String,
        decision: Decision,
    },
    TurnCompleted {
        receipt: TurnReceipt,
        provider_turn_id: String,
        error: Option<Value>,
    },
    Queue {
        snapshot: QueueSnapshot,
    },
    Notice {
        method: String,
        params: Value,
    },
    Closed {
        reason: String,
    },
}
type Reply<T> = oneshot::Sender<Result<T, Error>>;
enum Control {
    Send {
        id: String,
        text: String,
        queue: bool,
        reply: Reply<TurnReceipt>,
    },
    Queue {
        reply: Reply<QueueSnapshot>,
    },
    Change {
        revision: i64,
        change: QueueChange,
        reply: Reply<QueueSnapshot>,
    },
    Interrupt {
        reply: Reply<()>,
    },
    Answer {
        id: String,
        decision: Decision,
        reply: Reply<()>,
    },
    Stop,
}
#[derive(Clone)]
pub(crate) struct Runtime {
    pub info: Info,
    pub execution: ExecutionContext,
    controls: mpsc::Sender<Control>,
    completion: watch::Receiver<bool>,
}
impl Runtime {
    pub async fn start(
        mut command: Command,
        store: Arc<ExecutionStore>,
        options: StartOptions,
    ) -> Result<(Self, mpsc::Receiver<Event>), Error> {
        let cwd = std::fs::canonicalize(&options.cwd)
            .map_err(|_| Error::Protocol("Codex project directory is unavailable"))?;
        if !cwd.is_dir() {
            return Err(Error::Protocol("Codex project path is not a directory"));
        }
        let cwd = cwd.to_string_lossy().into_owned();
        let resume = options
            .resume_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(String::from);
        let ctx_store = store.clone();
        let ctx_cwd = cwd.clone();
        let ctx_resume = resume.clone();
        let context =
            execution::io(move || ctx_store.context("codex", &ctx_cwd, ctx_resume.as_deref()))
                .await
                .map_err(Error::Journal)?;
        let lock = context.lock_provider_session().map_err(Error::Journal)?;
        command.current_dir(&cwd);
        let (client, mut incoming) = Client::connect(command, options.rpc).await?;
        let start=async {
            let mut params=json!({"cwd":cwd,"approvalPolicy":"on-request","sandbox":options.sandbox.wire()});
            if let Some(model)=options.model.as_deref().map(str::trim).filter(|model|!model.is_empty()) {params["model"]=json!(model);}
            let method=if let Some(id)=&resume {params["threadId"]=json!(id);params["excludeTurns"]=json!(true);"thread/resume"}else{"thread/start"};
            let request=client.request(method,Some(params));tokio::pin!(request);
            let response=loop {
                tokio::select! {
                    response=&mut request=>break response?,
                    event=incoming.recv()=>match event {
                        Some(RpcEvent::Notification {..})=>{},
                        Some(RpcEvent::Request {id,..})=>{client.respond(id,Err(RpcError::Remote {code:-32601,message:"Request unavailable during thread initialization".into(),data:None})).await?;},
                        _=>return Err(Error::Closed),
                    }
                }
            };
            let id=response["thread"]["id"].as_str().filter(|id|!id.is_empty()).ok_or(Error::Protocol("Codex returned no thread identity"))?.to_string();
            if resume.as_deref().is_some_and(|prior|prior!=id) {return Err(Error::Protocol("Codex changed the resumed thread identity"));}
            if response["thread"]["status"]["type"]=="active" {return Err(Error::Protocol("Codex thread is already active elsewhere"));}
            let response_cwd=response["cwd"].as_str().ok_or(Error::Protocol("Codex returned no project directory"))?;
            if std::fs::canonicalize(response_cwd).ok().as_deref()!=Some(std::path::Path::new(&cwd)) {return Err(Error::Protocol("Codex changed the project directory"));}
            let model=response["model"].as_str().ok_or(Error::Protocol("Codex returned no model identity"))?.to_string();
            let bind=context.clone();let bind_id=id.clone();execution::io(move||bind.bind_provider_session(&bind_id)).await.map_err(Error::Journal)?;
            Ok::<Info,Error>(Info {thread_id:context.thread_id.clone(),provider_thread_id:id,run_id:context.run_id.clone(),model,cwd})
        }.await;
        let info = match start {
            Ok(info) => info,
            Err(error) => {
                client.close().await;
                return Err(error);
            }
        };
        let (controls, receiver) = mpsc::channel(64);
        let (output, events) = mpsc::channel(128);
        let (completed, completion) = watch::channel(false);
        output
            .try_send(Event::Ready { info: info.clone() })
            .map_err(|_| Error::Closed)?;
        let state = State {
            info: info.clone(),
            context: context.clone(),
            client: client.clone(),
            output,
            active: None,
            early: VecDeque::new(),
            approvals: HashMap::new(),
            calls: JoinSet::new(),
        };
        tokio::spawn(async move {
            let mut state = state;
            let reason = state.run(receiver, incoming).await;
            state.calls.abort_all();
            while state.calls.join_next().await.is_some() {}
            client.close().await;
            let finish = state.context.clone();
            let status = if matches!(reason, Error::Closed) {
                "interrupted"
            } else {
                "uncertain"
            };
            let finalized = execution::io(move || {
                finish.finish(
                    status,
                    Some("Codex runtime ended before a terminal result; review before retrying"),
                )
            })
            .await;
            if let Some(mut active) = state.active.take() {
                if let Some(reply) = active.reply.take() {
                    let _ = reply.send(Err(reason.clone()));
                }
            }
            let message = if finalized.is_err() {
                "execution journal failed during Codex shutdown"
            } else {
                reason.summary()
            };
            let _ = state.output.try_send(Event::Closed {
                reason: message.into(),
            });
            drop(lock);
            let _ = completed.send(true);
        });
        Ok((
            Self {
                info,
                execution: context,
                controls,
                completion,
            },
            events,
        ))
    }
    fn control(&self, command: Control) -> Result<(), Error> {
        self.controls
            .try_send(command)
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => Error::Busy,
                mpsc::error::TrySendError::Closed(_) => Error::Closed,
            })
    }
    pub async fn send(&self, id: &str, text: &str) -> Result<TurnReceipt, Error> {
        self.submit(id, text, false).await
    }
    pub async fn enqueue(&self, id: &str, text: &str) -> Result<TurnReceipt, Error> {
        self.submit(id, text, true).await
    }
    async fn submit(&self, id: &str, text: &str, queue: bool) -> Result<TurnReceipt, Error> {
        let (reply, result) = oneshot::channel();
        self.control(Control::Send {
            id: id.into(),
            text: text.into(),
            queue,
            reply,
        })?;
        result.await.unwrap_or(Err(Error::Closed))
    }
    pub async fn queue(&self) -> Result<QueueSnapshot, Error> {
        let (reply, result) = oneshot::channel();
        self.control(Control::Queue { reply })?;
        result.await.unwrap_or(Err(Error::Closed))
    }
    pub async fn change_queue(
        &self,
        revision: i64,
        change: QueueChange,
    ) -> Result<QueueSnapshot, Error> {
        let (reply, result) = oneshot::channel();
        self.control(Control::Change {
            revision,
            change,
            reply,
        })?;
        result.await.unwrap_or(Err(Error::Closed))
    }
    pub async fn interrupt(&self) -> Result<(), Error> {
        let (reply, result) = oneshot::channel();
        self.control(Control::Interrupt { reply })?;
        result.await.unwrap_or(Err(Error::Closed))
    }
    pub async fn answer(&self, id: &str, decision: Decision) -> Result<(), Error> {
        let (reply, result) = oneshot::channel();
        self.control(Control::Answer {
            id: id.into(),
            decision,
            reply,
        })?;
        result.await.unwrap_or(Err(Error::Closed))
    }
    #[cfg(test)]
    pub fn provider_turn_id(&self, command_id: &str) -> Result<Option<String>, String> {
        self.execution.store.provider_turn_id(command_id)
    }
    pub async fn stop(&self) {
        let mut completion = self.completion.clone();
        let _ = tokio::time::timeout(Duration::from_secs(40), async {
            let _ = self.controls.send(Control::Stop).await;
            let _ = completion.wait_for(|done| *done).await;
        })
        .await;
    }
}
struct Active {
    command: String,
    provider_id: Option<String>,
    reply: Option<Reply<TurnReceipt>>,
    denied: bool,
    interrupt: bool,
    interrupt_reply: Option<Reply<()>>,
}
struct Approval {
    rpc_id: RpcId,
    turn_id: String,
}
enum Call {
    Start {
        command: String,
        result: Result<Value, RpcError>,
    },
    Interrupt {
        reply: Reply<()>,
        result: Result<Value, RpcError>,
    },
    Answer {
        id: String,
        turn_id: String,
        decision: Decision,
        reply: Reply<()>,
        result: Result<(), RpcError>,
    },
    Reject {
        result: Result<(), RpcError>,
    },
}
struct State {
    info: Info,
    context: ExecutionContext,
    client: Client,
    output: mpsc::Sender<Event>,
    active: Option<Active>,
    early: VecDeque<RpcEvent>,
    approvals: HashMap<String, Approval>,
    calls: JoinSet<Call>,
}
impl State {
    fn emit(&self, event: Event) -> Result<(), Error> {
        self.output
            .try_send(event)
            .map_err(|_| Error::Protocol("Codex event consumer fell behind or closed"))
    }
    async fn queue_event(&self) -> Result<QueueSnapshot, Error> {
        let context = self.context.clone();
        let snapshot = execution::io(move || context.queue_snapshot())
            .await
            .map_err(Error::Journal)?;
        self.emit(Event::Queue {
            snapshot: snapshot.clone(),
        })?;
        Ok(snapshot)
    }
    async fn hold(&self) -> Result<(), Error> {
        let context = self.context.clone();
        execution::io(move || context.pause_owned_queue())
            .await
            .map_err(Error::Journal)
    }
    fn launch(
        &mut self,
        id: String,
        text: String,
        receipt: TurnReceipt,
        reply: Option<Reply<TurnReceipt>>,
    ) -> Result<(), Error> {
        if self.active.is_some() {
            return Err(Error::Protocol("Codex runtime already has an active turn"));
        }
        self.emit(Event::User {
            text: text.clone(),
            receipt,
        })?;
        self.active = Some(Active {
            command: id.clone(),
            provider_id: None,
            reply,
            denied: false,
            interrupt: false,
            interrupt_reply: None,
        });
        let client = self.client.clone();
        let thread = self.info.provider_thread_id.clone();
        self.calls.spawn(async move {let result=client.request("turn/start",Some(json!({"threadId":thread,"clientUserMessageId":id,"input":[{"type":"text","text":text,"text_elements":[]}]}))).await;Call::Start {command:id,result}});
        Ok(())
    }
    async fn drain(&mut self) -> Result<(), Error> {
        if self.active.is_some() {
            return Ok(());
        }
        let context = self.context.clone();
        if let Some(next) = execution::io(move || context.claim_queued())
            .await
            .map_err(Error::Journal)?
        {
            self.launch(
                next.receipt.command_id.clone(),
                next.text,
                next.receipt,
                None,
            )?;
        }
        Ok(())
    }
    fn interrupt_rpc(&mut self, reply: Reply<()>) -> Result<(), Error> {
        let Some(active) = self.active.as_ref() else {
            let _ = reply.send(Ok(()));
            return Ok(());
        };
        let Some(turn) = active.provider_id.clone() else {
            return Err(Error::Protocol("interrupt has no bound provider turn"));
        };
        let thread = self.info.provider_thread_id.clone();
        let client = self.client.clone();
        self.calls.spawn(async move {
            let result = client
                .request(
                    "turn/interrupt",
                    Some(json!({"threadId":thread,"turnId":turn})),
                )
                .await;
            Call::Interrupt { reply, result }
        });
        Ok(())
    }
    async fn control(&mut self, control: Control) -> Result<bool, Error> {
        match control {
            Control::Stop => return Ok(false),
            Control::Queue { reply } => {
                let context = self.context.clone();
                let result = execution::io(move || context.queue_snapshot())
                    .await
                    .map_err(Error::Journal);
                let _ = reply.send(result);
            }
            Control::Send {
                id,
                text,
                queue,
                reply,
            } => {
                let context = self.context.clone();
                let command = id.clone();
                let body = text.clone();
                if queue {
                    match execution::io(move || context.enqueue(&command, &body)).await {
                        Ok(receipt) => {
                            let _ = reply.send(Ok(receipt));
                            self.drain().await?;
                            self.queue_event().await?;
                        }
                        Err(error) => {
                            let _ = reply.send(Err(Error::Journal(error)));
                        }
                    }
                } else {
                    match execution::io(move || context.begin(&command, &body)).await {
                        Ok(begun) if begun.dispatch => {
                            self.launch(id, text, begun.receipt, Some(reply))?
                        }
                        Ok(begun) => {
                            let _ = reply.send(Ok(begun.receipt));
                        }
                        Err(error) => {
                            let _ = reply.send(Err(Error::Journal(error)));
                        }
                    }
                }
            }
            Control::Change {
                revision,
                change,
                reply,
            } => {
                let context = self.context.clone();
                match execution::io(move || context.update_queue(revision, change)).await {
                    Ok(_) => {
                        self.drain().await?;
                        let result = self.queue_event().await;
                        let _ = reply.send(result);
                    }
                    Err(error) => {
                        let _ = reply.send(Err(Error::Journal(error)));
                    }
                }
            }
            Control::Interrupt { reply } => {
                self.hold().await?;
                if let Some(active) = self.active.as_mut() {
                    if active.interrupt {
                        let _ = reply.send(Err(Error::Busy));
                    } else {
                        active.interrupt = true;
                        if active.provider_id.is_some() {
                            self.interrupt_rpc(reply)?;
                        } else {
                            active.interrupt_reply = Some(reply);
                        }
                    }
                } else {
                    let _ = reply.send(Ok(()));
                }
                self.queue_event().await?;
            }
            Control::Answer {
                id,
                decision,
                reply,
            } => {
                if let Some(approval) = self.approvals.remove(&id) {
                    if self
                        .active
                        .as_ref()
                        .and_then(|active| active.provider_id.as_deref())
                        != Some(approval.turn_id.as_str())
                    {
                        let _ = reply
                            .send(Err(Error::Protocol("approval belongs to an inactive turn")));
                        return Ok(true);
                    }
                    if decision != Decision::Accept {
                        self.hold().await?;
                        if let Some(active) = self.active.as_mut() {
                            active.denied = true;
                        }
                    }
                    let client = self.client.clone();
                    self.calls.spawn(async move {
                        let result = client
                            .respond(approval.rpc_id, Ok(json!({"decision":decision.wire()})))
                            .await;
                        Call::Answer {
                            id,
                            turn_id: approval.turn_id,
                            decision,
                            reply,
                            result,
                        }
                    });
                } else {
                    let _ =
                        reply.send(Err(Error::Protocol("unknown or already answered approval")));
                }
            }
        }
        Ok(true)
    }
    async fn call(&mut self, call: Call) -> Result<(), Error> {
        match call {
            Call::Start { command, result } => {
                if self.active.as_ref().map(|active| active.command.as_str())
                    != Some(command.as_str())
                {
                    return Ok(());
                }
                let result = result?;
                let response_status = result["turn"]["status"]
                    .as_str()
                    .ok_or(Error::Protocol("Codex returned no turn status"))?;
                if !["inProgress", "completed", "failed", "interrupted"].contains(&response_status)
                {
                    return Err(Error::Protocol("Codex returned an invalid turn status"));
                }
                let id = result["turn"]["id"]
                    .as_str()
                    .filter(|id| !id.is_empty())
                    .ok_or(Error::Protocol("Codex returned no turn identity"))?
                    .to_string();
                let context = self.context.clone();
                let bind_command = command.clone();
                let bind_id = id.clone();
                let receipt =
                    execution::io(move || context.bind_provider_turn(&bind_command, &bind_id))
                        .await
                        .map_err(Error::Journal)?;
                if let Some(active) = self.active.as_mut() {
                    active.provider_id = Some(id.clone());
                    if let Some(reply) = active.reply.take() {
                        let _ = reply.send(Ok(receipt.clone()));
                    }
                }
                self.emit(Event::TurnStarted {
                    receipt,
                    provider_turn_id: id,
                })?;
                if let Some(reply) = self
                    .active
                    .as_mut()
                    .and_then(|active| active.interrupt_reply.take())
                {
                    self.interrupt_rpc(reply)?;
                }
                let early = std::mem::take(&mut self.early);
                for event in early {
                    self.incoming(event).await?;
                }
                if response_status != "inProgress"
                    && self
                        .active
                        .as_ref()
                        .is_some_and(|active| active.command == command)
                {
                    self.incoming(RpcEvent::Notification {
                        method: "turn/completed".into(),
                        params: Some(
                            json!({"threadId":self.info.provider_thread_id,"turn":result["turn"]}),
                        ),
                    })
                    .await?;
                }
            }
            Call::Interrupt { reply, result } => match result {
                Ok(_) => {
                    let _ = reply.send(Ok(()));
                }
                Err(error) => {
                    let _ = reply.send(Err(Error::Rpc(error.clone())));
                    return Err(Error::Rpc(error));
                }
            },
            Call::Answer {
                id,
                turn_id,
                decision,
                reply,
                result,
            } => match result {
                Ok(()) => {
                    if self
                        .active
                        .as_ref()
                        .and_then(|active| active.provider_id.as_deref())
                        == Some(turn_id.as_str())
                    {
                        self.emit(Event::ApprovalResolved {
                            approval_id: id,
                            decision,
                        })?;
                    }
                    let _ = reply.send(Ok(()));
                }
                Err(error) => {
                    let _ = reply.send(Err(Error::Rpc(error.clone())));
                    return Err(Error::Rpc(error));
                }
            },
            Call::Reject { result } => {
                result?;
            }
        }
        Ok(())
    }
    fn reject(&mut self, id: RpcId, message: &'static str) {
        let client = self.client.clone();
        self.calls.spawn(async move {
            Call::Reject {
                result: client
                    .respond(
                        id,
                        Err(RpcError::Remote {
                            code: -32601,
                            message: message.into(),
                            data: None,
                        }),
                    )
                    .await,
            }
        });
    }
    async fn incoming(&mut self, event: RpcEvent) -> Result<(), Error> {
        let (method, params, rpc_id) = match event {
            RpcEvent::Notification { method, params } => {
                (method, params.unwrap_or(Value::Null), None)
            }
            RpcEvent::Request { id, method, params } => {
                (method, params.unwrap_or(Value::Null), Some(id))
            }
            RpcEvent::Closed(_) => return Err(Error::Rpc(RpcError::Closed)),
        };
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.provider_id.is_none())
        {
            if self.early.len() >= 64 {
                return Err(Error::Protocol(
                    "too many Codex events before turn acknowledgement",
                ));
            }
            self.early.push_back(match rpc_id {
                Some(id) => RpcEvent::Request {
                    id,
                    method,
                    params: Some(params),
                },
                None => RpcEvent::Notification {
                    method,
                    params: Some(params),
                },
            });
            return Ok(());
        }
        let matching_thread =
            params["threadId"].as_str() == Some(self.info.provider_thread_id.as_str());
        let provider_id = if method == "turn/completed" || method == "turn/started" {
            params["turn"]["id"].as_str()
        } else {
            params["turnId"].as_str()
        };
        let matches = matching_thread
            && self.active.as_ref().is_some_and(|active| {
                active.provider_id.as_deref() == provider_id && provider_id.is_some()
            });
        if let Some(rpc_id) = rpc_id {
            if !matches {
                self.reject(rpc_id, "Approval is not for this active thread and turn");
                return Ok(());
            }
            let supported = [
                "item/commandExecution/requestApproval",
                "item/fileChange/requestApproval",
            ]
            .contains(&method.as_str())
                && (method != "item/fileChange/requestApproval" || params["grantRoot"].is_null());
            if !supported {
                self.hold().await?;
                if let Some(active) = self.active.as_mut() {
                    active.denied = true;
                }
                self.reject(rpc_id, "Approval type is not supported by this adapter");
                return Ok(());
            }
            if self.approvals.len() >= 64 {
                return Err(Error::Protocol("too many outstanding Codex approvals"));
            }
            let id = execution::new_id("approval").map_err(Error::Journal)?;
            let active = self.active.as_ref().ok_or(Error::Closed)?;
            let turn_id = provider_id.ok_or(Error::Closed)?.to_string();
            self.emit(Event::ApprovalRequested {
                approval_id: id.clone(),
                command_id: active.command.clone(),
                provider_turn_id: turn_id.clone(),
                method,
                params,
            })?;
            self.approvals.insert(id, Approval { rpc_id, turn_id });
            return Ok(());
        }
        if method == "thread/closed" && matching_thread {
            return Err(Error::Protocol("Codex thread closed"));
        }
        if !matches {
            return Ok(());
        }
        let active = self.active.as_ref().ok_or(Error::Closed)?;
        let command = active.command.clone();
        let turn = provider_id.ok_or(Error::Closed)?.to_string();
        match method.as_str() {
            "turn/completed" => {
                let status = match params["turn"]["status"].as_str() {
                    Some("completed") => "succeeded",
                    Some("failed") => "failed",
                    Some("interrupted") => "interrupted",
                    _ => return Err(Error::Protocol("invalid Codex terminal turn status")),
                };
                let hold = status != "succeeded" || active.denied || active.interrupt;
                let detail = if active.denied {
                    Some("Provider approval or input was denied or unsupported; review queued work")
                } else if active.interrupt {
                    Some("Interrupt requested; queued work remains held")
                } else {
                    None
                };
                let context = self.context.clone();
                let id = turn.clone();
                let receipt = execution::io(move || {
                    context.finish_provider_turn(&command, &id, status, detail, hold)
                })
                .await
                .map_err(Error::Journal)?;
                self.active = None;
                self.approvals.clear();
                if let Some(receipt) = receipt {
                    self.emit(Event::TurnCompleted {
                        receipt,
                        provider_turn_id: turn,
                        error: params["turn"]
                            .get("error")
                            .filter(|error| !error.is_null())
                            .cloned(),
                    })?;
                }
                self.drain().await?;
                self.queue_event().await?;
            }
            "item/agentMessage/delta" => {
                let item = params["itemId"]
                    .as_str()
                    .ok_or(Error::Protocol("text delta has no item identity"))?
                    .to_string();
                let text = params["delta"]
                    .as_str()
                    .ok_or(Error::Protocol("text delta has no text"))?
                    .to_string();
                self.emit(Event::TextDelta {
                    command_id: command,
                    provider_turn_id: turn,
                    item_id: item,
                    text,
                })?;
            }
            "item/started" | "item/completed" => {
                if !params["item"].is_object() {
                    return Err(Error::Protocol("Codex item payload is invalid"));
                }
                self.emit(Event::Item {
                    command_id: command,
                    provider_turn_id: turn,
                    item: params["item"].clone(),
                    completed: method == "item/completed",
                })?;
            }
            "thread/tokenUsage/updated" => self.emit(Event::Usage {
                command_id: command,
                provider_turn_id: turn,
                usage: params["tokenUsage"].clone(),
            })?,
            "turn/started" => {}
            _ => self.emit(Event::Notice { method, params })?,
        }
        Ok(())
    }
    async fn run(
        &mut self,
        mut controls: mpsc::Receiver<Control>,
        mut incoming: mpsc::Receiver<RpcEvent>,
    ) -> Error {
        loop {
            let result = tokio::select! {
                _=self.output.closed()=>return Error::Closed,
                command=controls.recv()=>match command {Some(command)=>self.control(command).await,None=>return Error::Closed},
                event=incoming.recv()=>match event {Some(event)=>self.incoming(event).await.map(|_|true),None=>return Error::Rpc(RpcError::Closed)},
                call=self.calls.join_next(),if !self.calls.is_empty()=>match call {Some(Ok(call))=>self.call(call).await.map(|_|true),_=>return Error::Closed},
            };
            match result {
                Ok(true) => {}
                Ok(false) => return Error::Closed,
                Err(error) => return error,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    struct Fixture {
        root: PathBuf,
        store: Arc<ExecutionStore>,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(execution::new_id("codex_runtime_test").unwrap());
            let store = Arc::new(ExecutionStore::open(&root.join("journal")).unwrap());
            Self { root, store }
        }
        async fn start(
            &self,
            resume: Option<&str>,
            scenario: &str,
        ) -> Result<(Runtime, mpsc::Receiver<Event>), Error> {
            let mut command = Command::new("python3");
            command
                .arg("-u")
                .arg(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/codex_runtime.py"
                ))
                .arg(self.root.join("journal/state.sqlite3"))
                .arg(self.root.join("wire.jsonl"))
                .arg(scenario);
            Runtime::start(
                command,
                self.store.clone(),
                StartOptions {
                    cwd: self.root.to_string_lossy().into_owned(),
                    resume_id: resume.map(String::from),
                    model: Some("fixture-model".into()),
                    sandbox: Sandbox::WorkspaceWrite,
                    rpc: RpcOptions {
                        request_timeout: Duration::from_secs(2),
                        max_frame_bytes: 65536,
                        capacity: 64,
                    },
                },
            )
            .await
        }
        fn records(&self) -> Vec<Value> {
            std::fs::read_to_string(self.root.join("wire.jsonl"))
                .unwrap_or_default()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    async fn completed(events: &mut mpsc::Receiver<Event>) -> TurnReceipt {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match events.recv().await {
                    Some(Event::TurnCompleted { receipt, .. }) => return receipt,
                    Some(Event::Closed { reason }) => panic!("unexpected close: {reason}"),
                    Some(_) => {}
                    None => panic!("event stream closed"),
                }
            }
        })
        .await
        .unwrap()
    }
    async fn approval(events: &mut mpsc::Receiver<Event>) -> String {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match events.recv().await {
                    Some(Event::ApprovalRequested { approval_id, .. }) => return approval_id,
                    Some(Event::Closed { reason }) => panic!("unexpected close: {reason}"),
                    Some(_) => {}
                    None => panic!("event stream closed"),
                }
            }
        })
        .await
        .unwrap()
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn create_stream_and_complete_bind_durable_ids_before_input_without_duplicate_sends() {
        let f = Fixture::new();
        let (runtime, mut events) = f.start(None, "normal").await.unwrap();
        assert_eq!(runtime.info.provider_thread_id, "fixture-codex-thread");
        assert_eq!(runtime.info.thread_id, runtime.execution.thread_id);
        assert!(matches!(events.recv().await.unwrap(), Event::Ready { .. }));
        let receipt = runtime.send("command-a", "complete").await.unwrap();
        assert_eq!(receipt.status, "running");
        let mut kinds = Vec::new();
        let final_receipt = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match events.recv().await.unwrap() {
                    Event::User { .. } => kinds.push("user"),
                    Event::TurnStarted { .. } => kinds.push("start"),
                    Event::TextDelta { .. } => kinds.push("text"),
                    Event::Usage { .. } => kinds.push("usage"),
                    Event::TurnCompleted { receipt, .. } => break receipt,
                    _ => {}
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(final_receipt.status, "succeeded");
        assert_eq!(&kinds[..3], &["user", "start", "text"]);
        assert!(kinds.contains(&"usage"));
        assert_eq!(
            runtime.provider_turn_id("command-a").unwrap().as_deref(),
            Some("provider-turn-1")
        );
        assert_eq!(
            runtime.send("command-a", "complete").await.unwrap().status,
            "succeeded"
        );
        assert!(runtime
            .send("command-a", "different original")
            .await
            .is_err());
        runtime.stop().await;
        assert_eq!(
            f.records()
                .iter()
                .filter(|record| record["phase"] == "turn/start")
                .count(),
            1
        );
        assert_eq!(
            f.records()
                .iter()
                .find(|record| record["phase"] == "turn/start")
                .unwrap()["statusBeforeInput"],
            "dispatching"
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn queue_order_stop_and_explicit_resume_share_the_execution_store() {
        let f = Fixture::new();
        let (runtime, mut events) = f.start(None, "normal").await.unwrap();
        runtime.send("active", "hold").await.unwrap();
        runtime.enqueue("a", "queued-one").await.unwrap();
        runtime.enqueue("b", "queued-two").await.unwrap();
        let queue = runtime.queue().await.unwrap();
        runtime
            .change_queue(
                queue.revision,
                QueueChange::Reorder {
                    command_ids: vec!["b".into(), "a".into()],
                },
            )
            .await
            .unwrap();
        assert!(runtime
            .change_queue(
                queue.revision,
                QueueChange::Cancel {
                    command_id: "b".into()
                }
            )
            .await
            .is_err());
        runtime.interrupt().await.unwrap();
        assert_eq!(completed(&mut events).await.status, "interrupted");
        let held = runtime.queue().await.unwrap();
        assert!(held.paused);
        assert_eq!(held.items.len(), 2);
        runtime
            .change_queue(held.revision, QueueChange::Resume)
            .await
            .unwrap();
        assert_eq!(completed(&mut events).await.command_id, "b");
        assert_eq!(completed(&mut events).await.command_id, "a");
        runtime.stop().await;
        let started: Vec<_> = f
            .records()
            .into_iter()
            .filter(|record| record["phase"] == "turn/start")
            .map(|record| record["commandId"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(started, vec!["active", "b", "a"]);
        assert!(f
            .records()
            .iter()
            .find(|record| record["phase"] == "interrupt")
            .unwrap()["heldBeforeInput"]
            .as_bool()
            .unwrap());
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn declined_tool_approval_holds_followups_even_after_a_successful_result() {
        let f = Fixture::new();
        let (runtime, mut events) = f.start(None, "normal").await.unwrap();
        runtime.send("request", "approval").await.unwrap();
        runtime.enqueue("later", "queued-one").await.unwrap();
        let id = approval(&mut events).await;
        runtime.answer(&id, Decision::Decline).await.unwrap();
        let receipt = completed(&mut events).await;
        assert_eq!(receipt.status, "succeeded");
        assert!(receipt.detail.unwrap().contains("denied"));
        assert!(runtime.queue().await.unwrap().paused);
        assert!(runtime.answer(&id, Decision::Accept).await.is_err());
        runtime.stop().await;
        assert_eq!(
            f.records()
                .iter()
                .filter(|record| record["phase"] == "approval-answer")
                .count(),
            1
        );
        assert_eq!(
            f.records()
                .iter()
                .find(|record| record["phase"] == "approval-answer")
                .unwrap()["decision"],
            "decline"
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn file_approvals_accept_only_an_explicit_one_time_answer_and_unknown_requests_are_rejected(
    ) {
        let f = Fixture::new();
        let (runtime, mut events) = f.start(None, "normal").await.unwrap();
        runtime.send("request", "file-approval").await.unwrap();
        let id = approval(&mut events).await;
        runtime.answer(&id, Decision::Accept).await.unwrap();
        assert_eq!(completed(&mut events).await.status, "succeeded");
        runtime.send("unsupported", "unsupported").await.unwrap();
        assert_eq!(completed(&mut events).await.status, "succeeded");
        runtime.stop().await;
        assert!(f
            .records()
            .iter()
            .any(|record| record["phase"] == "approval-answer" && record["decision"] == "accept"));
        assert!(f
            .records()
            .iter()
            .any(|record| record["phase"] == "approval-answer" && record["error"] == -32601));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn lost_turn_acknowledgement_is_uncertain_and_a_resumed_retry_does_not_start_another_turn(
    ) {
        let f = Fixture::new();
        let (runtime, _events) = f.start(None, "normal").await.unwrap();
        assert!(runtime.send("uncertain", "lost-ack").await.is_err());
        runtime.stop().await;
        assert_eq!(f.store.receipt("uncertain").unwrap().status, "uncertain");
        let (resumed, _events) = f
            .start(Some("fixture-codex-thread"), "normal")
            .await
            .unwrap();
        assert_eq!(
            resumed.send("uncertain", "lost-ack").await.unwrap().status,
            "uncertain"
        );
        resumed.stop().await;
        assert_eq!(
            f.records()
                .iter()
                .filter(|record| record["phase"] == "turn/start")
                .count(),
            1
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn idle_thread_ownership_and_resume_identity_are_checked_before_sending() {
        let f = Fixture::new();
        let (runtime, _events) = f.start(None, "normal").await.unwrap();
        assert!(
            matches!(f.start(Some("fixture-codex-thread"),"normal").await,Err(Error::Journal(message)) if message.contains("already"))
        );
        runtime.stop().await;
        assert!(matches!(
            f.start(Some("fixture-codex-thread"), "bad-resume").await,
            Err(Error::Protocol(_))
        ));
        assert!(f
            .records()
            .iter()
            .all(|record| record["phase"] != "turn/start"));
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn completion_before_acknowledgement_is_not_regressed_by_the_late_ack() {
        let f = Fixture::new();
        let (runtime, mut events) = f.start(None, "normal").await.unwrap();
        runtime.send("early", "early-complete").await.unwrap();
        assert_eq!(completed(&mut events).await.status, "succeeded");
        runtime.send("later", "hold").await.unwrap();
        // Old buffered events cannot finish the newly started command.
        assert_eq!(f.store.receipt("later").unwrap().status, "running");
        runtime.stop().await;
        assert_eq!(f.store.receipt("early").unwrap().status, "succeeded");
        assert_eq!(f.store.receipt("later").unwrap().status, "interrupted");
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn resuming_a_stopped_runtime_keeps_queued_work_held_until_explicit_resume() {
        let f = Fixture::new();
        let (runtime, _events) = f.start(None, "normal").await.unwrap();
        runtime.send("active", "hold").await.unwrap();
        runtime.enqueue("queued", "queued-one").await.unwrap();
        runtime.stop().await;
        let (resumed, mut events) = f
            .start(Some("fixture-codex-thread"), "normal")
            .await
            .unwrap();
        let queue = resumed.queue().await.unwrap();
        assert!(queue.paused);
        assert_eq!(queue.items.len(), 1);
        assert_eq!(
            f.records()
                .iter()
                .filter(|record| record["phase"] == "turn/start")
                .count(),
            1
        );
        resumed
            .change_queue(queue.revision, QueueChange::Resume)
            .await
            .unwrap();
        assert_eq!(completed(&mut events).await.command_id, "queued");
        resumed.stop().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn terminal_start_response_is_recorded_even_without_a_separate_completion_notification() {
        let f = Fixture::new();
        let (runtime, mut events) = f.start(None, "normal").await.unwrap();
        runtime
            .send("terminal-response", "terminal-response")
            .await
            .unwrap();
        assert_eq!(completed(&mut events).await.status, "succeeded");
        runtime.stop().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn failed_provider_results_preserve_error_details_and_hold_pending_work() {
        let f = Fixture::new();
        let (runtime, mut events) = f.start(None, "normal").await.unwrap();
        runtime.send("failed", "fail-after-approval").await.unwrap();
        runtime.enqueue("later", "queued-one").await.unwrap();
        let id = approval(&mut events).await;
        runtime.answer(&id, Decision::Accept).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(Event::TurnCompleted { receipt, error, .. }) = events.recv().await {
                    assert_eq!(receipt.status, "failed");
                    assert_eq!(error.unwrap()["message"], "fixture failure");
                    break;
                }
            }
        })
        .await
        .unwrap();
        let queue = runtime.queue().await.unwrap();
        assert!(queue.paused);
        assert_eq!(queue.items.len(), 1);
        runtime.stop().await;
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn native_ui_standin_uses_real_receipts_approvals_interrupts_and_persisted_history() {
        let f = Fixture::new();
        let command = || {
            let mut command = Command::new("python3");
            command
                .arg("-u")
                .arg(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/tests/fixtures/codex_ui.py"
                ))
                .env("BLACKCRAB_QA_STATE", f.root.join("fixture"))
                .env("BLACKCRAB_QA_JOURNAL", f.root.join("journal/state.sqlite3"));
            command
        };
        let (runtime, mut events) = Runtime::start(
            command(),
            f.store.clone(),
            StartOptions {
                cwd: f.root.to_string_lossy().into_owned(),
                resume_id: None,
                model: None,
                sandbox: Sandbox::ReadOnly,
                rpc: RpcOptions {
                    request_timeout: Duration::from_secs(2),
                    ..RpcOptions::default()
                },
            },
        )
        .await
        .unwrap();
        let native = runtime.info.provider_thread_id.clone();
        runtime.send("ui-complete", "complete").await.unwrap();
        assert_eq!(completed(&mut events).await.status, "succeeded");
        runtime.send("ui-hold", "hold").await.unwrap();
        runtime.interrupt().await.unwrap();
        assert_eq!(completed(&mut events).await.status, "interrupted");
        runtime.send("ui-approval", "approval").await.unwrap();
        let id = approval(&mut events).await;
        runtime.answer(&id, Decision::Decline).await.unwrap();
        let denied = completed(&mut events).await;
        assert_eq!(denied.status, "succeeded");
        assert!(denied.detail.unwrap().contains("denied"));
        assert!(runtime.queue().await.unwrap().paused);
        runtime.stop().await;
        let (client, _events) = Client::connect(command(), RpcOptions::default())
            .await
            .unwrap();
        let history = client
            .request(
                "thread/turns/list",
                Some(json!({"threadId":native,"itemsView":"full","limit":20})),
            )
            .await
            .unwrap();
        assert_eq!(history["data"].as_array().unwrap().len(), 3);
        let catalog = client
            .request("model/list", Some(json!({"limit":50})))
            .await
            .unwrap();
        assert_eq!(catalog["data"][0]["model"], "native-qa");
        client.close().await;
        let wire = std::fs::read_to_string(f.root.join("fixture/wire.jsonl")).unwrap();
        let inputs: Vec<Value> = wire
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .filter(|row| row["phase"] == "input-recorded")
            .collect();
        assert_eq!(inputs.len(), 3);
        assert!(inputs
            .iter()
            .all(|row| row["statusBeforeInput"] == "dispatching"));
    }
}
