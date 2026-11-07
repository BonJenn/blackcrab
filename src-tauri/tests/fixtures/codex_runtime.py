"""Local Codex lifecycle fixture. Reads only its temporary test journal/log."""
import json
import os
import sqlite3
import sys

journal, log_path, scenario = sys.argv[1:]
thread_id = "fixture-codex-thread"
active = None
initialized = False

def send(value):
    print(json.dumps(value), flush=True)

def log(value):
    with open(log_path, "a") as output:
        output.write(json.dumps(value) + "\n")

def records():
    try:
        with open(log_path) as source:
            return [json.loads(line) for line in source]
    except FileNotFoundError:
        return []

def event(method, **params):
    send({"method": method, "params": {"threadId": thread_id, "turnId": active, **params}})

def finish(status="completed"):
    event("item/completed", item={"id": "assistant-" + active, "type": "agentMessage", "text": "fixture finished"})
    event("thread/tokenUsage/updated", tokenUsage={"total": {"inputTokens": 10, "outputTokens": 4}, "last": {"inputTokens": 10, "outputTokens": 4}, "modelContextWindow": 1000})
    event("turn/completed", turn={"id": active, "status": status, "items": [], "error": {"message": "fixture failure"} if status == "failed" else None})
    # A duplicate completion must not finish a later queued turn.
    event("turn/completed", turn={"id": active, "status": status, "items": [], "error": {"message": "fixture failure"} if status == "failed" else None})

for line in sys.stdin:
    message = json.loads(line)
    method, params = message.get("method"), message.get("params", {})
    if method == "initialize":
        send({"id": message["id"], "result": {"userAgent": "runtime fixture"}})
        continue
    if method == "initialized":
        initialized = True
        continue
    assert initialized
    if method in ("thread/start", "thread/resume"):
        assert params["approvalPolicy"] == "on-request"
        thread_id = params.get("threadId", thread_id)
        if scenario == "bad-resume":
            thread_id = "wrong-resumed-thread"
        log({"phase": method})
        event("thread/started", thread={"id": thread_id})
        send({"id": message["id"], "result": {"thread": {"id": thread_id, "status": {"type": "idle"}}, "model": params.get("model", "fixture-model"), "cwd": os.getcwd()}})
    elif method == "turn/start":
        assert params["threadId"] == thread_id
        command = params["clientUserMessageId"]
        with sqlite3.connect(journal) as db:
            row = db.execute("SELECT status FROM turns WHERE command_id=?", [command]).fetchone()
        assert row == ("dispatching",), "provider input preceded its durable receipt"
        active = "provider-turn-" + str(1 + sum(record.get("phase") == "turn/start" for record in records()))
        body = params["input"][0]["text"]
        log({"phase": "turn/start", "commandId": command, "providerTurnId": active, "statusBeforeInput": row[0]})
        event("turn/started", turn={"id": active, "status": "inProgress", "items": []})
        event("item/agentMessage/delta", itemId="assistant-" + active, delta="early text")
        if body == "lost-ack":
            continue
        if body in ("approval", "file-approval", "unsupported", "fail-after-approval"):
            approval_method = {"approval": "item/commandExecution/requestApproval", "fail-after-approval": "item/commandExecution/requestApproval", "file-approval": "item/fileChange/requestApproval", "unsupported": "tool/requestUserInput"}[body]
            send({"id": "approval-" + active, "method": approval_method, "params": {"threadId": thread_id, "turnId": active, "itemId": "tool-" + active, "command": "fixture only"}})
        if body == "early-complete":
            finish()
            event("item/agentMessage/delta", itemId="late-old", delta="old turn")
        send({"id": message["id"], "result": {"turn": {"id": active, "status": "completed" if body == "terminal-response" else "inProgress", "items": []}}})
        # Ignore events for another thread and for an earlier turn on this thread.
        send({"method": "turn/completed", "params": {"threadId": "foreign-thread", "turn": {"id": active, "status": "completed"}}})
        if active != "provider-turn-1":
            event("turn/completed", turn={"id": "provider-turn-1", "status": "completed"})
        if body in ("complete", "queued-one", "queued-two"):
            finish()
    elif method == "turn/interrupt":
        assert params["turnId"] == active
        with sqlite3.connect(journal) as db:
            held = db.execute("SELECT paused FROM queue_lanes").fetchone()
        log({"phase": "interrupt", "heldBeforeInput": held is None or held[0] == 1})
        finish("interrupted")
        send({"id": message["id"], "result": {}})
    elif method is None:
        log({"phase": "approval-answer", "id": message["id"], "decision": message.get("result", {}).get("decision"), "error": message.get("error", {}).get("code")})
        if "result" in message:
            assert message["result"]["decision"] in ("accept", "decline", "cancel")
        finish("failed" if body == "fail-after-approval" else "interrupted" if message.get("result", {}).get("decision") == "cancel" else "completed")
    else:
        send({"id": message["id"], "error": {"code": -32601, "message": "fixture method unavailable"}})
