"""Read-only app-server fixture. No model service, credentials or user files."""
import json
import os
import sys
import threading

case, log = sys.argv[1:3]
initialized = False

def send(value):
    print(json.dumps(value), flush=True)

for line in sys.stdin:
    request = json.loads(line)
    with open(log, "a") as out:
        out.write(json.dumps({"pid": os.getpid(), "request": request}) + "\n")
    method = request.get("method")
    if method == "initialize":
        send({"id": request["id"], "result": {"userAgent": "fixture"}})
        continue
    if method == "initialized":
        initialized = True
        continue
    assert initialized
    if method is None:
        assert request["error"]["code"] == -32601
        continue
    assert method in ["account/read", "model/list", "thread/list", "thread/read", "thread/turns/list", "thread/items/list"], "mutating RPC"
    params = request["params"]
    if case == "hang":
        threading.Event().wait()
    if case == "interactive":
        send({"id": 900, "method": "account/chatgptAuthTokens/refresh", "params": {"reason": "expired"}})
        continue
    if case == "unsupported":
        send({"id": request["id"], "error": {"code": -32601, "message": "SECRET fixture diagnostic"}})
        continue
    if method == "account/read":
        assert params == {"refreshToken": False}
        result = {"account": {"type": "chatgpt", "email": "fixture@example.test", "planType": "plus", "workspaceName": "fixture", "accessToken": "SECRET"}, "requiresOpenaiAuth": True, "refreshToken": "SECRET"}
    elif method == "model/list":
        assert params["includeHidden"] is False
        model = {"id": "dynamic-id", "model": "dynamic-model", "displayName": "Fixture", "description": "Fixture", "hidden": False, "isDefault": True, "defaultReasoningEffort": "future-effort", "supportedReasoningEfforts": [{"reasoningEffort": "future-effort", "description": "Fixture"}], "privateField": "SECRET"}
        result = {"data": [model], "nextCursor": "opaque:next" if params["cursor"] is None else None}
    elif method == "thread/list":
        assert params["useStateDbOnly"] is True
        assert params["modelProviders"] == []
        assert "appServer" in params["sourceKinds"]
        result = {"data": [{"id": "thread-fixture", "preview": "fixture prompt", "cwd": "/fixture", "createdAt": 123, "updatedAt": 456, "modelProvider": "custom-provider", "status": {"type": "notLoaded"}, "historyMode": "paginated", "path": "SECRET", "turns": [{"text": "not requested"}]}], "nextCursor": None}
    elif method == "thread/read":
        assert params["includeTurns"] is False
        result = {"thread": {"id": "wrong" if case == "wrong-thread" else params["threadId"], "preview": "fixture", "cwd": "/fixture", "createdAt": 123, "updatedAt": 456, "modelProvider": "custom-provider", "status": {"type": "notLoaded"}}}
    elif method == "thread/turns/list":
        assert params["itemsView"] in ["notLoaded", "summary", "full"]
        result = {"data": [{"id": "turn-fixture", "status": "completed", "itemsView": params["itemsView"], "items": [{"type": "agentMessage", "id": "item-fixture", "text": "history"}]}], "nextCursor": None}
    else:
        result = {"data": [{"turnId": "wrong" if case == "wrong-turn" else "turn-fixture", "item": {"type": "futureItem", "id": "item-fixture", "text": "untrusted history text"}, "startedAtMs": 1234}], "nextCursor": None}
    if case == "bad-shape":
        result = {"data": "not an array", "message": "SECRET"}
    if case == "too-many":
        result["data"] *= 2
    send({"method": "account/updated", "params": {"ignored": True}})
    send({"id": request["id"], "result": result})
