#!/usr/bin/env python3
"""Build/run the isolated host prototype; no UI, CLI credentials or model calls."""
import argparse
import json
import os
from pathlib import Path
import selectors
import signal
import socket
import subprocess
import tempfile
import time
import tomllib

crate = Path(__file__).resolve().parent
repo = crate.parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--binary", type=Path, default=crate / "target/debug/blackcrab-host-core-prototype")
args = parser.parse_args()
root = Path(tempfile.mkdtemp(prefix="blackcrab-host-probe-"))
# Fresh private root is the only data location this experiment uses.
(root / ".blackcrab-host-probe").write_text("isolated fixture experiment\n")
fixture = repo / "src-tauri/tests/fixtures/codex_ui.py"
unmarked = root / "unmarked"
unmarked.mkdir(mode=0o700)
rejected = subprocess.run([str(args.binary.resolve()), "serve", str(unmarked), str(fixture)], capture_output=True, text=True, timeout=10)
assert rejected.returncode != 0 and not (unmarked / "journal").exists(), "unmarked data root was modified"
log = (root / "host.stderr").open("w")
host = subprocess.Popen([str(args.binary.resolve()), "serve", str(root), str(fixture)], stdout=subprocess.PIPE, stderr=log, text=True, start_new_session=True)

def rpc(command):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(10)
        client.connect(str(root / "control.sock"))
        client.sendall((json.dumps(command) + "\n").encode())
        with client.makefile("r") as reader:
            return json.loads(reader.readline())

def terminal():
    until = time.monotonic() + 5
    while time.monotonic() < until:
        receipt = rpc({"type": "receipt", "id": "probe-command"})["receipt"]
        if receipt["status"] == "interrupted":
            return receipt
        time.sleep(0.02)
    raise AssertionError("terminal receipt missing")

try:
    with selectors.DefaultSelector() as selector:
        selector.register(host.stdout, selectors.EVENT_READ)
        assert selector.select(10), "host readiness timed out"
        ready = json.loads(host.stdout.readline())
    assert ready["ready"] and ready["pid"] == host.pid
    submitted = rpc({"type": "send", "id": "probe-command", "text": "hold"})
    assert submitted["ok"] and submitted["receipt"]["status"] == "running", submitted
    # Each rpc owns/closes a distinct socket. No UI/client connection remains here.
    assert host.poll() is None
    reconnected = rpc({"type": "receipt", "id": "probe-command"})
    assert reconnected["ok"] and reconnected["receipt"] == submitted["receipt"]
    contender = subprocess.run([str(args.binary.resolve()), "contend", str(root), ready["providerThread"]], text=True, capture_output=True, timeout=10)
    assert contender.returncode == 0, contender.stderr
    protection = json.loads(contender.stdout)
    assert protection["providerSessionExcluded"] and protection["receipt"]["status"] == "running", protection
    assert rpc({"type": "interrupt"})["ok"]
    receipt = terminal()
    assert rpc({"type": "stop"})["ok"]
    host.wait(timeout=10)
    assert host.returncode == 0, (root / "host.stderr").read_text()
    records = [json.loads(line) for line in (root / "fixture/wire.jsonl").read_text().splitlines()]
    inputs = [row for row in records if row.get("phase") == "input-recorded"]
    assert len(inputs) == 1 and inputs[0]["statusBeforeInput"] == "dispatching", inputs
    assert not any(row.get("phase") == "fixture-error" for row in records), records
    # The runtime stop waits for its owned provider subprocess to be reaped.
    for pid in {row["pid"] for row in records}:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            pass
        else:
            raise AssertionError(f"fixture child {pid} remains after stop")
    assert not (root / "control.sock").exists()
    packages = tomllib.loads((crate / "Cargo.lock").read_text())["package"]
    tauri_packages = [package["name"] for package in packages if package["name"].startswith("tauri")]
    assert not tauri_packages, tauri_packages
    print(json.dumps({"ok": True, "tauriPackages": len(tauri_packages), "clientDisconnectPreservedRunningTurn": True,
                      "secondHostProviderSessionExcluded": True, "unmarkedRootRejectedBeforeJournal": True, "liveReceiptNotRecoveredBySecondHost": True,
                      "providerInputs": len(inputs), "terminalStatus": receipt["status"],
                      "ownedProviderReaped": True, "binaryBytes": args.binary.stat().st_size,
                      "artifacts": str(root)}, indent=2))
finally:
    if host.poll() is None:
        try:
            rpc({"type": "stop"})
            host.wait(timeout=10)
        except Exception:
            # The process group contains only this test host and its fixture child.
            os.killpg(host.pid, signal.SIGTERM)
            try:
                host.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(host.pid, signal.SIGKILL)
                host.wait(timeout=5)
    log.close()
