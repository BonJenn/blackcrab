#!/usr/bin/env python3
"""Exercise the normal installed Root UI and Electron handoff in disposable CI.

No native IPC invocation, test-only Root feature, provider prompt, or existing OS
account is used. WebDriver reads rendered startup status; xdotool sends normal Quit.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request

NAME, UID = "blackcrab-desktop-qa", 1998
QA_HOME = Path("/home") / NAME
# The public 0.4.4 package and the service runtime it installs. The upgrade
# check installs it first, opens it once, then installs the candidate over it.
RELEASED = {"version": "0.4.4", "sha256": "3109e99cbe53ea5ab2f198d9dbc18b06f411b4b1921eeb0354a08ee326e5e6b5",
            "manifest": "491d73ac66be7a27338adace318d7dd41f3c107b5e4ec3be68b7e1de7a791775"}


def service_record(owner):
    """What must survive an upgrade, and what must change: digests and names only."""
    configuration = json.loads((owner / "configuration.json").read_text())
    binding = json.loads((owner / "native-issuer-binding.json").read_text())
    layout = json.loads((owner / "host/runtime/versions/0.1.7/.blackcrab-service-layout.json").read_text())
    database = owner / "host/userdata/statev2.sqlite"
    return {"manifest": configuration["manifestDigest"], "bindingManifest": binding["manifestSha256"],
            "layoutManifest": layout["manifestSha256"], "generation": binding["generation"],
            "environment": digest(owner / "host/userdata/environment-id"),
            "secret": hashlib.sha256(configuration["bootstrapSecret"].encode()).hexdigest(),
            "database": database.is_file() and database.stat().st_size > 0}


def check_upgrade(owner, seed):
    now = service_record(owner)
    old = seed["manifest"]
    if old != RELEASED["manifest"] or seed["bindingManifest"] != old or seed["layoutManifest"] != old:
        raise RuntimeError("The released package did not install the service runtime this check expects")
    if len({now["manifest"], now["bindingManifest"], now["layoutManifest"]}) != 1:
        raise RuntimeError("The service runtime was not replaced consistently")
    for key in ("generation", "environment", "secret"):
        if now[key] != seed[key]:
            raise RuntimeError("The upgrade changed the service's " + key)
    if not seed["database"] or not now["database"]:
        raise RuntimeError("The service database is missing")
    if now["manifest"] == old:
        # This candidate carries the released runtime unchanged: nothing to replace.
        return {"from": old, "to": old, "runtimeReplaced": False, "identityRetained": True}
    retired = owner / "host/runtime/retired" / old
    if json.loads((retired / ".blackcrab-service-layout.json").read_text())["manifestSha256"] != old \
            or not (retired / "payload/t3").is_file():
        raise RuntimeError("The previous runtime was not kept whole")
    if not (owner / "host/upgrade-backups" / old[:16] / "statev2.sqlite").is_file():
        raise RuntimeError("The database was not copied before the upgrade")
    return {"from": old, "to": now["manifest"], "runtimeReplaced": True, "identityRetained": True,
            "previousRuntimeKept": True, "databaseCopied": True}


def digest(file):
    h = hashlib.sha256()
    with open(file, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verified_installers(report_path):
    if report_path.stat().st_size > 1024 * 1024:
        raise RuntimeError("Installer report exceeds bound")
    plan = json.loads(report_path.read_text())
    if plan.get("passed") is not True or plan.get("target") != "linux-x64" or plan.get("published") is not False:
        raise RuntimeError("Verified local Linux installer candidate required")
    items = plan.get("packages", [])
    packages = {item["kind"]: item for item in items}
    if len(items) != 2 or set(packages) != {"deb", "appimage"}:
        raise RuntimeError("Both actual installers required")
    for package in packages.values():
        file = Path(package["file"])
        if not file.is_absolute() or not file.is_file() or file.is_symlink() or digest(file) != package["sha256"]:
            raise RuntimeError("Installer changed after verification")
    return packages


def run(args, **kwargs):
    kwargs.setdefault("timeout", 60)
    return subprocess.run(args, check=True, **kwargs)


def stop(child):
    # Only the process group captured by this controller; no process discovery.
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=10)


def require_unused_driver_ports():
    # Refuse an existing listener instead of accidentally talking to another
    # session's driver. This runner/account is otherwise disposable and private.
    # The upgrade check runs two sessions in a row. A port the first session's
    # driver just closed lingers for a while and may be reused; one with a live
    # listener is still refused.
    with socket.socket() as public, socket.socket() as native:
        for probe, port in ((public, 4444), (native, 4445)):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(("127.0.0.1", port))


class DriverFailure(Exception):
    pass


def request(method, route, data=None):
    req = urllib.request.Request("http://127.0.0.1:4444" + route,
                                 data=None if data is None else json.dumps(data).encode(),
                                 method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            value = json.loads(response.read(4 * 1024 * 1024))["value"]
    except urllib.error.HTTPError as error:
        value = json.loads(error.read(65536)).get("value", {})
        raise DriverFailure(value.get("error", "WebDriver request failed")) from None
    # A WebDriver error object carries a string code and a message; a script
    # result is a different object and is never read as a driver failure.
    if isinstance(value, dict) and isinstance(value.get("error"), str) and "message" in value:
        raise DriverFailure(value["error"])
    return value


def await_driver(child):
    # The proxy listens before its native WebKit driver does, and drops early
    # connections without a response; retry any transport failure until ready.
    deadline = time.monotonic() + 60
    last = "no response"
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("Owned WebDriver exited before startup")
        try:
            if request("GET", "/status").get("ready"):
                return
            last = "not ready"
        except (OSError, http.client.HTTPException, DriverFailure, ValueError) as error:
            last = type(error).__name__
        time.sleep(0.2)
    raise RuntimeError("Owned WebDriver did not become ready: " + last)


def await_workspace(session):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        # DOM observation only. Never call __TAURI__, invoke(), product internals,
        # or inject a fabricated native success response.
        value = request("POST", f"/session/{session}/execute/sync", {"script":
            "return {status:document.querySelector('[role=status]')?.textContent,"
            "alert:document.querySelector('[role=alert]')?.textContent};", "args": []})
        if value.get("alert"):
            raise RuntimeError("Installed launcher reported: " + value["alert"][:400])
        if value.get("status") == "Your workspace is open.":
            return
        time.sleep(0.5)
    raise RuntimeError("Installed launcher never completed the real workspace handoff")


def sample_processes(timeline, started, finished):
    # Failure evidence only: when each command name in this fresh account was
    # first and last seen. Names only; no arguments, environment or output.
    while not finished.wait(0.25):
        try:
            names = subprocess.run(["/usr/bin/ps", "-u", str(UID), "-o", "comm="], capture_output=True,
                                   text=True, timeout=5).stdout.split()
        except Exception:
            continue
        at = round(time.monotonic() - started, 1)
        for name in set(names):
            timeline.setdefault(name, [at, at])[1] = at


def probe_workspace(environment):
    # After a failed handoff only: can the extracted workspace binary load and
    # start at all? It is run without Root's private descriptors, so it cannot
    # attach to the service; only its bounded startup output is kept.
    found = None
    for directory, _, files in os.walk(QA_HOME / ".local/share/com.bonjenn.blackcrab/managed-payloads-v1"):
        if "Blackcrab" in files and "chrome-sandbox" in files:
            found = Path(directory) / "Blackcrab"
            break
    if found is None:
        return {"found": False}
    probe = {"found": True}
    helper = found.with_name("chrome-sandbox").stat()
    probe["sandboxHelper"] = {"uid": helper.st_uid, "mode": oct(helper.st_mode & 0o7777)}
    try:
        probe["usernsClone"] = Path("/proc/sys/kernel/unprivileged_userns_clone").read_text().strip()
    except OSError:
        probe["usernsClone"] = "absent"
    linked = subprocess.run(["/usr/bin/ldd", str(found)], capture_output=True, text=True, timeout=20).stdout
    probe["missingLibraries"] = [line.strip()[:120] for line in linked.splitlines() if "not found" in line][:20]
    # Start it the way Root does (same environment, working directory and
    # inherited descriptor numbers) with a descriptor of the right shape but a
    # made-up credential and an unused loopback port. It cannot attach to the
    # service; this only shows what its startup prints, which Root discards.
    import fcntl
    import tempfile
    profile = QA_HOME / ".blackcrab/desktop"
    like_root = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": str(QA_HOME), "OTEL_SDK_DISABLED": "true",
                 "TMPDIR": str(profile / "tmp")}
    like_root.update({key: environment[key] for key in ["DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR",
                                                        "DBUS_SESSION_BUS_ADDRESS", "LANG"] if key in environment})
    probe["tmpdir"] = like_root["TMPDIR"]
    pairs = {number: socket.socketpair() for number in (3, 4, 6)}
    inherited = {number: fcntl.fcntl(pair[1].fileno(), fcntl.F_DUPFD, 40) for number, pair in pairs.items()}

    def place():
        for number, source in inherited.items():
            os.dup2(source, number)

    document = {"version": 1,
                "owner": {"kind": "blackcrab-managed-host", "generation": 1, "environmentId": "startup-probe",
                          "origin": "http://127.0.0.1:9/", "serverVersion": "0.1.7",
                          "orchestrationProtocolVersion": 2},
                "profile": {"root": str(profile), "namespace": "blackcrab-managed-v1",
                            "appId": "com.blackcrab.desktop.managed"},
                "control": {"kind": "unavailable"},
                "authorization": {"kind": "paired-credential", "credential": "222222222222",
                                  "expiresAt": int(time.time() * 1000) + 3600000,
                                  "renewal": {"kind": "owner-credential-fd-v1", "fd": 4}},
                "lifecycle": {"kind": "launcher-lifecycle-fd-v1", "fd": 6}}
    with tempfile.TemporaryFile() as captured:
        child = subprocess.Popen([str(found)], cwd=found.parent, env=like_root, stdin=subprocess.DEVNULL,
                                 stdout=captured, stderr=subprocess.STDOUT, start_new_session=True,
                                 close_fds=False, preexec_fn=place)
        for source in inherited.values():
            os.close(source)
        for pair in pairs.values():
            pair[1].close()
        time.sleep(2)
        pairs[3][0].sendall(json.dumps(document).encode())
        pairs[3][0].shutdown(socket.SHUT_WR)
        pairs[6][0].settimeout(20)
        try:
            pairs[6][0].sendall(b'{"version":1,"id":1,"action":"activate"}\n')
            probe["lifecycleReply"] = pairs[6][0].recv(200).decode("utf-8", "replace")[:200]
        except OSError as failure:
            probe["lifecycleReply"] = type(failure).__name__
        time.sleep(5)
        probe["exit"] = child.poll() if child.poll() is not None else "still running"
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=10)
        captured.seek(0)
        output = captured.read()
    probe["created"] = sorted(item.name for item in profile.iterdir())[:30]
    probe["output"] = re.sub(r"[A-Za-z0-9_\-=]{32,}", "[redacted]", output.decode("utf-8", "replace"))[-6000:]
    return probe


def workspace_logs():
    # The workspace writes its own startup log into this fresh account's private
    # profile. Keep the newest tails, with long token-like strings removed.
    profile = QA_HOME / ".blackcrab/desktop"
    files = []
    for directory, _, names in os.walk(profile):
        if len(Path(directory).relative_to(profile).parts) > 6:
            continue
        for name in names:
            if name.endswith((".log", ".ndjson", ".jsonl")) or "log" in Path(directory).name.lower():
                file = Path(directory) / name
                if file.is_file() and not file.is_symlink():
                    files.append(file)
    files.sort(key=lambda file: file.stat().st_mtime, reverse=True)
    result = {"files": [f"{file.relative_to(profile)} ({file.stat().st_size})" for file in files[:40]], "tails": {}}
    for file in files[:4]:
        with open(file, "rb") as source:
            source.seek(max(0, file.stat().st_size - 5000))
            text = source.read(5000).decode("utf-8", "replace")
        result["tails"][str(file.relative_to(profile))] = re.sub(r"[A-Za-z0-9_\-=]{32,}", "[redacted]", text)
    return result


def workspace_state():
    # Where the running workspace's main process is waiting: its low inherited
    # descriptors' kinds, each thread's current system call number, and the
    # names (not contents) of what it has created in its fresh profile.
    state = {}
    lines = subprocess.run(["/usr/bin/ps", "-u", str(UID), "-o", "pid=,comm=,args="], capture_output=True,
                           text=True, timeout=10).stdout.splitlines()
    mains = [line.split()[0] for line in lines
             if len(line.split()) > 1 and line.split()[1] == "Blackcrab" and "--type=" not in line]
    state["mainProcesses"] = len(mains)
    if mains:
        process = Path("/proc") / mains[0]
        descriptors = {}
        for number in range(0, 16):
            try:
                target = os.readlink(process / "fd" / str(number))
                descriptors[number] = target.split(":")[0] if target.startswith(("socket:", "pipe:", "anon_inode:")) \
                    else Path(target).name[:60]
            except OSError:
                descriptors[number] = None
        state["descriptors"] = descriptors
        threads = {}
        for task in sorted((process / "task").iterdir())[:60]:
            try:
                name = (task / "comm").read_text().strip()
                call = (task / "syscall").read_text().split()
                threads[f"{name}:{task.name}"] = " ".join(call[:2])
            except OSError as failure:
                threads[task.name] = type(failure).__name__
        state["threads"] = threads
    profile = QA_HOME / ".blackcrab/desktop"
    created = []
    for directory, folders, names in os.walk(profile):
        relative = Path(directory).relative_to(profile)
        if len(relative.parts) >= 3:
            folders[:] = []
        created.extend(f"{relative / name} ({(Path(directory) / name).lstat().st_size})" for name in sorted(names)[:25])
        created.extend(f"{relative / folder}/" for folder in sorted(folders)[:25])
    state["profile"] = sorted(created)[:200]
    return state


def inside(seed=False):
    if os.geteuid() != UID or Path(pwd.getpwuid(UID).pw_dir) != QA_HOME:
        raise RuntimeError("Fresh graphical QA account required")
    if (QA_HOME / ".blackcrab-desktop-qa").read_text() != "isolated-ci-only\n":
        raise RuntimeError("QA ownership marker missing")
    report = {"passed": False, "agentPromptsSent": 0, "published": False, "sessions": []}
    environment = dict(os.environ, TAURI_WEBVIEW_AUTOMATION="true", APPIMAGE_EXTRACT_AND_RUN="1",
                       LIBGL_ALWAYS_SOFTWARE="1")
    processes, handles = [], []
    session = None
    timeline, finished = {}, threading.Event()
    threading.Thread(target=sample_processes, args=(timeline, time.monotonic(), finished), daemon=True).start()
    try:
        require_unused_driver_ports()
        for name, command in [("window-manager", ["/usr/bin/openbox"]),
                              ("webdriver", [str(QA_HOME / "tauri-driver"), "--port", "4444", "--native-port", "4445"])]:
            log = open(QA_HOME / (name + ("-seed" if seed else "") + ".private.log"), "xb")
            handles.append(log)
            child = subprocess.Popen(command, env=environment, stdout=log, stderr=log, start_new_session=True)
            processes.append(child)
        await_driver(processes[-1])
        owner = QA_HOME / ".local/share/com.bonjenn.blackcrab/managed-host/v1"
        before = None
        seeded = QA_HOME / "seed.json"
        packages = [("released", "/usr/bin/blackcrab")] if seed else \
            [("deb", "/usr/bin/blackcrab"), ("appimage", str(QA_HOME / "Blackcrab.AppImage"))]
        for kind, application in packages:
            created = request("POST", "/session", {"capabilities": {"alwaysMatch": {
                "browserName": "wry", "tauri:options": {"application": application}}}})
            session = created["sessionId"]
            await_workspace(session)
            # Handoff succeeded only after the captured Electron child acknowledged
            # its loaded, visible window. The OS check also excludes the hidden Root.
            window = run(["/usr/bin/xdotool", "getactivewindow"], capture_output=True, text=True).stdout.strip()
            title = run(["/usr/bin/xdotool", "getwindowname", window], capture_output=True, text=True).stdout.strip()
            if "Blackcrab" not in title:
                raise RuntimeError("Expected the actual Blackcrab workspace in the foreground")
            # Let the acknowledged window finish its first paint so the retained
            # image shows the workspace, not its splash.
            time.sleep(8)
            run(["/usr/bin/import", "-window", "root", str(QA_HOME / (kind + "-workspace.png"))], env=environment)
            current = {name: digest(owner / name) for name in ["configuration.json", "host/userdata/environment-id"]}
            if before is not None and before != current:
                raise RuntimeError("Reopening from AppImage changed the persistent service identity")
            before = current
            run(["/usr/bin/systemctl", "--user", "is-active", "--quiet", "blackcrab.service"])
            if seed:
                seeded.write_text(json.dumps(service_record(owner)) + "\n")
            elif kind == "deb" and seeded.is_file():
                # The candidate just opened over the released version's service.
                report["upgrade"] = check_upgrade(owner, json.loads(seeded.read_text()))
            # Quit the foreground workspace as a user would: its Linux menu
            # shortcut first, then the window manager's close request. Root
            # should then exit through its captured-client exit monitor.
            def root_running():
                # The outer launcher's process name, in this fresh account only.
                names = subprocess.run(["/usr/bin/ps", "-u", str(UID), "-o", "comm="], capture_output=True,
                                       text=True, timeout=10).stdout.split()
                return "blackcrab" in names

            def root_closed(seconds):
                deadline = time.monotonic() + seconds
                while time.monotonic() < deadline:
                    try:
                        if not request("GET", f"/session/{session}/window/handles"):
                            return True
                    except DriverFailure as error:
                        if str(error) in ("invalid session id", "no such window"):
                            return True
                        # The driver reports a vanished Root in more than one
                        # way ("unknown error" among them). Believe it only if
                        # Root's process really is gone.
                        if root_running():
                            raise
                        return True
                    except (OSError, http.client.HTTPException):
                        return True
                    time.sleep(0.25)
                return False

            run(["/usr/bin/xdotool", "windowactivate", "--sync", window], env=environment)
            closed, quit_by = False, None
            for method, keys, seconds in [("shortcut", "ctrl+q", 15), ("window-close", "alt+F4", 30)]:
                run(["/usr/bin/xdotool", "key", "--clearmodifiers", keys], env=environment)
                if root_closed(seconds):
                    closed, quit_by = True, method
                    break
            if not closed:
                raise RuntimeError("Normal workspace Quit did not close its Root launcher")
            try:
                request("DELETE", f"/session/{session}")
            except DriverFailure as error:
                if str(error) != "invalid session id":
                    raise
            except (OSError, http.client.HTTPException):
                pass
            session = None
            run(["/usr/bin/systemctl", "--user", "is-active", "--quiet", "blackcrab.service"])
            report["sessions"].append({"package": kind, "visibleWorkspace": True, "normalQuit": quit_by,
                                       "serviceSurvived": True, "identityRetained": True})
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)[:500]
        # Read-only failure evidence: command names in this fresh account only,
        # to tell an exited workspace from a slow one. No arguments or logs.
        try:
            names = subprocess.run(["/usr/bin/ps", "-u", str(UID), "-o", "comm="], capture_output=True,
                                   text=True, timeout=10).stdout.split()
            report["accountProcesses"] = sorted(set(names))[:60]
        except Exception:
            pass
        finished.set()
        report["processTimeline"] = dict(sorted(timeline.items())[:80])
        # What is on screen and which workspace process roles exist. Titles and
        # Chromium's --type role only; the image is of this empty fresh account.
        try:
            subprocess.run(["/usr/bin/import", "-window", "root", str(QA_HOME / "failure-screen.png")],
                           env=environment, timeout=30)
            ids = subprocess.run(["/usr/bin/xdotool", "search", "--onlyvisible", "--name", ""], capture_output=True,
                                 text=True, env=environment, timeout=15).stdout.split()[:30]
            titles = [subprocess.run(["/usr/bin/xdotool", "getwindowname", i], capture_output=True, text=True,
                                     env=environment, timeout=5).stdout.strip()[:120] for i in ids]
            report["visibleWindows"] = sorted(set(t for t in titles if t))
            lines = subprocess.run(["/usr/bin/ps", "-u", str(UID), "-o", "comm=,args="], capture_output=True,
                                   text=True, timeout=10).stdout.splitlines()
            roles = {}
            for line in lines:
                if line.startswith("Blackcrab"):
                    role = next((part[7:] for part in line.split() if part.startswith("--type=")), "main")[:40]
                    roles[role] = roles.get(role, 0) + 1
            report["workspaceRoles"] = roles
        except Exception as failure:
            report["screenEvidence"] = type(failure).__name__
        try:
            report["workspaceState"] = workspace_state()
        except Exception as failure:
            report["workspaceState"] = {"error": type(failure).__name__}
        try:
            report["workspaceLogs"] = workspace_logs()
        except Exception as failure:
            report["workspaceLogs"] = {"error": type(failure).__name__}
        try:
            report["workspaceProbe"] = probe_workspace(environment)
        except Exception as failure:
            report["workspaceProbe"] = {"error": type(failure).__name__}
        raise
    finally:
        if session:
            try:
                request("DELETE", f"/session/{session}")
            except Exception:
                pass
        finished.set()
        cleanup_errors = []
        for child in reversed(processes):
            try:
                stop(child)
            except Exception:
                cleanup_errors.append("Captured graphical process cleanup failed")
        for handle in handles:
            handle.close()
        if cleanup_errors:
            report["passed"] = False
            report["cleanupErrors"] = cleanup_errors
        (QA_HOME / ("seed-result.json" if seed else "result.json")).write_text(json.dumps(report, indent=2) + "\n")


def main(report_path, released=None):
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "Linux":
        raise RuntimeError("Disposable GitHub Linux runner required")
    if QA_HOME.exists() or QA_HOME.is_symlink():
        raise RuntimeError("Refusing an existing QA home")
    for identity in (NAME, UID):
        try:
            pwd.getpwnam(identity) if isinstance(identity, str) else pwd.getpwuid(identity)
        except KeyError:
            continue
        raise RuntimeError("Refusing an existing QA account")
    existing = subprocess.run(["/usr/bin/dpkg-query", "-W", "-f=${Status}", "blackcrab"], capture_output=True, text=True)
    if existing.returncode == 0:
        raise RuntimeError("Refusing to replace an existing installed Blackcrab package")
    packages = verified_installers(report_path)
    if released is not None and (not released.is_file() or released.is_symlink() or digest(released) != RELEASED["sha256"]):
        raise RuntimeError("The released package to upgrade from is not the published one")
    output = report_path.parent / "ui-acceptance"
    output.mkdir(mode=0o700)
    driver = Path(os.environ["HOME"]) / ".cargo/bin/tauri-driver"
    created = installed = False
    try:
        run(["sudo", "useradd", "--create-home", "--home-dir", str(QA_HOME), "--uid", str(UID), "--shell", "/bin/bash", NAME])
        created = True
        # dpkg can leave this newly introduced package partially installed even
        # when its post-install step fails; still retire it in that case.
        installed = True
        for source, destination, mode in [(Path(__file__).resolve(), "test.py", "0644"),
                                          (driver, "tauri-driver", "0755"),
                                          (report_path, "plan.json", "0644"),
                                          (Path(packages["appimage"]["file"]), "Blackcrab.AppImage", "0755")]:
            run(["sudo", "install", "-m", mode, str(source), str(QA_HOME / destination)])
        marker = output / "marker"
        marker.write_text("isolated-ci-only\n")
        run(["sudo", "install", "-m", "0644", str(marker), str(QA_HOME / ".blackcrab-desktop-qa")])
        run(["sudo", "systemctl", "start", f"user@{UID}.service"])
        # Disposable runner only: let the QA account inspect its own processes'
        # /proc state when collecting failure evidence.
        subprocess.run(["sudo", "sysctl", "-q", "-w", "kernel.yama.ptrace_scope=0"], timeout=30)

        def graphical(*mode):
            run(["sudo", "runuser", "-u", NAME, "--", "env", "-i", f"HOME={QA_HOME}", f"USER={NAME}", f"LOGNAME={NAME}",
                 "PATH=/usr/bin:/bin", "LANG=C.UTF-8", f"XDG_RUNTIME_DIR=/run/user/{UID}",
                 f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{UID}/bus", "/usr/bin/xvfb-run", "--auto-servernum",
                 "--server-args=-screen 0 1440x1000x24 -nolisten tcp", "/usr/bin/python3", str(QA_HOME / "test.py"),
                 "--inside", *mode], timeout=600)

        if released is not None:
            # A person's existing installation: the published package, opened
            # once so that it sets up and starts its background service.
            run(["sudo", "dpkg", "--install", str(released)], timeout=180)
            graphical("--seed")
        # Over a released installation this is an ordinary package upgrade.
        run(["sudo", "dpkg", "--install", packages["deb"]["file"]], timeout=180)
        if digest("/usr/bin/blackcrab") != packages["deb"]["rootSha256"]:
            raise RuntimeError("Installed Root differs from the verified installer")
        graphical()
    finally:
        cleanup_errors = []
        def cleanup(args, accepted=(0,)):
            try:
                if subprocess.run(args, timeout=60).returncode not in accepted:
                    cleanup_errors.append(args[1])
            except Exception:
                cleanup_errors.append(args[1])

        if created:
            # Export only bounded public result and fresh empty-workspace images.
            # Driver, profile and service logs/configuration remain private.
            for name in ["result.json", "seed-result.json", "released-workspace.png", "deb-workspace.png",
                         "appimage-workspace.png", "failure-screen.png"]:
                if (QA_HOME / name).is_file():
                    cleanup(["sudo", "install", "-o", str(os.getuid()), "-m", "0600", str(QA_HOME / name), str(output / name)])
            # Failure evidence: signal and module-level trace of the newest core
            # dump from this account, if any. No environment or memory contents.
            try:
                crash = subprocess.run(["sudo", "coredumpctl", "--no-pager", "-1", "info", f"COREDUMP_UID={UID}"],
                                       capture_output=True, text=True, timeout=60)
                if crash.returncode == 0 and crash.stdout:
                    (output / "crash.txt").write_text(crash.stdout[:12000])
            except Exception:
                pass
            # The account has a systemd manager but no logind session, so there
            # is nothing for loginctl to terminate. Stop its manager, then end
            # anything still owned by this run's fresh UID (1 = none remained).
            cleanup(["sudo", "systemctl", "stop", f"user@{UID}.service"])
            cleanup(["sudo", "pkill", "-KILL", "-U", str(UID)], accepted=(0, 1))
            cleanup(["sudo", "systemctl", "stop", f"user-runtime-dir@{UID}.service"])
            cleanup(["sudo", "userdel", "--remove", NAME])
        if installed:
            cleanup(["sudo", "dpkg", "--remove", "blackcrab"])
        (output / "cleanup.json").write_text(json.dumps({"passed": not cleanup_errors, "failedSteps": cleanup_errors}) + "\n")
        if cleanup_errors:
            raise RuntimeError("Disposable QA cleanup failed: " + ", ".join(cleanup_errors))
    result = json.loads((output / "result.json").read_text())
    if not result.get("passed") or len(result.get("sessions", [])) != 2:
        raise RuntimeError("Installed graphical acceptance did not pass both package paths")
    if released is not None:
        if result.get("upgrade", {}).get("identityRetained") is not True:
            raise RuntimeError("The upgrade from the released version was not verified")
        print("UPGRADE_FROM_RELEASED_" + RELEASED["version"] + "_KEPT_SERVICE_IDENTITY_AND_DATA"
              + ("" if result["upgrade"]["runtimeReplaced"] else "_RUNTIME_UNCHANGED"))
    print("INSTALLED_LINUX_DEB_AND_APPIMAGE_WORKSPACE_ACCEPTANCE_PASSED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    parser.add_argument("--inside", action="store_true")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--upgrade-from", type=Path)
    args = parser.parse_args()
    if args.inside:
        inside(args.seed)
    elif args.report:
        main(args.report.resolve(), args.upgrade_from.resolve() if args.upgrade_from else None)
    else:
        parser.error("--report required")
