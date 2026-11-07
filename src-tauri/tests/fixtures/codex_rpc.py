"""Deterministic app-server stand-in. Never launches a model or reads credentials."""
import json
import os
import sys
import threading

case = sys.argv[1]
initialized = False
waiting = []

def send(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)

for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    if method == "initialize":
        assert message["params"]["clientInfo"]["name"] == "blackcrab"
        assert message["params"]["capabilities"]["experimentalApi"] is False
        if case == "bad_handshake":
            send({"id": message["id"], "error": {"code": -32000, "message": "fixture refused"}})
        else:
            send({"id": message["id"], "result": {"userAgent": "fixture", "platformFamily": "unix", "platformOs": "fixture"}})
        continue
    if method == "initialized":
        initialized = True
        if case == "blocked_stdin":
            threading.Event().wait()
        continue
    assert initialized, "client sent work before initialized"
    if not method:
        send({"method": "fixture/response", "params": message})
        continue
    if method == "fixture/pid":
        send({"id": message["id"], "result": os.getpid()})
    elif method == "fixture/reverse":
        waiting.append(message)
        if len(waiting) == 2:
            for value in reversed(waiting):
                send({"id": value["id"], "result": value["params"]})
            waiting = []
    elif method == "fixture/interleave":
        send({"id": 999, "result": "unrelated reply"})
        send({"id": message["id"], "method": "item/commandExecution/requestApproval", "params": {"command": "fixture only"}})
        send({"method": "item/agentMessage/delta", "params": {"delta": "one\ntwo"}})
        send({"id": message["id"], "result": {"accepted": True}})
    elif method == "fixture/error":
        send({"id": message["id"], "error": {"code": -32602, "message": "fixture error", "data": {"field": "sample"}}})
    elif method == "fixture/partial":
        sys.stdout.write('{"method":"fixture/partial",')
        sys.stdout.flush()
        waiting.append(message)
    elif method == "fixture/finish_partial":
        sys.stdout.write('"params":{"intact":true}}\n')
        sys.stdout.flush()
        send({"id": waiting.pop()["id"], "result": "original"})
        send({"id": message["id"], "result": "finished"})
    elif method == "fixture/oversize":
        sys.stdout.write("x" * 4096)
        sys.stdout.flush()
    elif method == "fixture/malformed":
        print('{"id":', flush=True)
    elif method == "fixture/exit":
        sys.stdout.write('{"id":')
        sys.stdout.flush()
        sys.exit(0)
    elif method == "fixture/noise":
        sys.stderr.write("diagnostic secret must not be retained\n" * 20000)
        sys.stderr.flush()
        send({"id": message["id"], "result": "drained"})
    elif method == "fixture/flood":
        for index in range(100):
            send({"method": "fixture/event", "params": {"index": index}})
    elif method == "fixture/duplicate_request":
        for _ in range(2):
            send({"id": "server-request", "method": "fixture/approval"})
    elif method == "fixture/hold":
        send({"method": "fixture/holding"})
    else:
        send({"id": message["id"], "result": message.get("params")})
