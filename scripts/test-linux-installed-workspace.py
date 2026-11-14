#!/usr/bin/env python3
"""Exercise the normal installed Root UI and Electron handoff in disposable CI.

No native IPC invocation, test-only Root feature, provider prompt, or existing OS
account is used. WebDriver reads rendered startup status; xdotool sends normal Quit.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request

NAME, UID = "blackcrab-desktop-qa", 1998
QA_HOME = Path("/home") / NAME


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
    with socket.socket() as public, socket.socket() as native:
        public.bind(("127.0.0.1", 4444))
        native.bind(("127.0.0.1", 4445))


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
    if isinstance(value, dict) and "error" in value:
        raise DriverFailure(value["error"])
    return value


def await_driver(child):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("Owned WebDriver exited before startup")
        try:
            if request("GET", "/status").get("ready"):
                return
        except (urllib.error.URLError, DriverFailure):
            pass
        time.sleep(0.2)
    raise RuntimeError("Owned WebDriver did not become ready")


def await_workspace(session):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        # DOM observation only. Never call __TAURI__, invoke(), product internals,
        # or inject a fabricated native success response.
        value = request("POST", f"/session/{session}/execute/sync", {"script":
            "return {status:document.querySelector('[role=status]')?.textContent,"
            "error:document.querySelector('[role=alert]')?.textContent};", "args": []})
        if value.get("error"):
            raise RuntimeError("Installed launcher reported: " + value["error"][:400])
        if value.get("status") == "Your workspace is open.":
            return
        time.sleep(0.5)
    raise RuntimeError("Installed launcher never completed the real workspace handoff")


def inside():
    if os.geteuid() != UID or Path(pwd.getpwuid(UID).pw_dir) != QA_HOME:
        raise RuntimeError("Fresh graphical QA account required")
    if (QA_HOME / ".blackcrab-desktop-qa").read_text() != "isolated-ci-only\n":
        raise RuntimeError("QA ownership marker missing")
    report = {"passed": False, "agentPromptsSent": 0, "published": False, "sessions": []}
    environment = dict(os.environ, TAURI_WEBVIEW_AUTOMATION="true", APPIMAGE_EXTRACT_AND_RUN="1",
                       LIBGL_ALWAYS_SOFTWARE="1")
    processes, handles = [], []
    session = None
    try:
        require_unused_driver_ports()
        for name, command in [("window-manager", ["/usr/bin/openbox"]),
                              ("webdriver", [str(QA_HOME / "tauri-driver"), "--port", "4444", "--native-port", "4445"])]:
            log = open(QA_HOME / (name + ".private.log"), "xb")
            handles.append(log)
            child = subprocess.Popen(command, env=environment, stdout=log, stderr=log, start_new_session=True)
            processes.append(child)
        await_driver(processes[-1])
        owner = QA_HOME / ".local/share/com.bonjenn.blackcrab/managed-host/v1"
        before = None
        for kind, application in [("deb", "/usr/bin/blackcrab"), ("appimage", str(QA_HOME / "Blackcrab.AppImage"))]:
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
            run(["/usr/bin/import", "-window", "root", str(QA_HOME / (kind + "-workspace.png"))], env=environment)
            current = {name: digest(owner / name) for name in ["configuration.json", "host/userdata/environment-id"]}
            if before is not None and before != current:
                raise RuntimeError("Reopening from AppImage changed the persistent service identity")
            before = current
            run(["/usr/bin/systemctl", "--user", "is-active", "--quiet", "blackcrab.service"])
            # Quit the foreground workspace through its normal Linux menu shortcut.
            # Root should then exit through its captured-client exit monitor.
            run(["/usr/bin/xdotool", "key", "--clearmodifiers", "ctrl+q"])
            deadline = time.monotonic() + 30
            closed = False
            while time.monotonic() < deadline:
                try:
                    windows = request("GET", f"/session/{session}/window/handles")
                    if not windows:
                        closed = True
                        break
                except DriverFailure as error:
                    if str(error) in ("invalid session id", "no such window"):
                        closed = True
                        break
                    raise
                time.sleep(0.25)
            if not closed:
                raise RuntimeError("Normal workspace Quit did not close its Root launcher")
            try:
                request("DELETE", f"/session/{session}")
            except DriverFailure as error:
                if str(error) != "invalid session id":
                    raise
            session = None
            run(["/usr/bin/systemctl", "--user", "is-active", "--quiet", "blackcrab.service"])
            report["sessions"].append({"package": kind, "visibleWorkspace": True, "normalQuit": True,
                                       "serviceSurvived": True, "identityRetained": True})
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)[:500]
        raise
    finally:
        if session:
            try:
                request("DELETE", f"/session/{session}")
            except Exception:
                pass
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
        (QA_HOME / "result.json").write_text(json.dumps(report, indent=2) + "\n")


def main(report_path):
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
        run(["sudo", "dpkg", "--install", packages["deb"]["file"]], timeout=180)
        if digest("/usr/bin/blackcrab") != packages["deb"]["rootSha256"]:
            raise RuntimeError("Installed Root differs from the verified installer")
        for source, destination, mode in [(Path(__file__).resolve(), "test.py", "0644"),
                                          (driver, "tauri-driver", "0755"),
                                          (report_path, "plan.json", "0644"),
                                          (Path(packages["appimage"]["file"]), "Blackcrab.AppImage", "0755")]:
            run(["sudo", "install", "-m", mode, str(source), str(QA_HOME / destination)])
        marker = output / "marker"
        marker.write_text("isolated-ci-only\n")
        run(["sudo", "install", "-m", "0644", str(marker), str(QA_HOME / ".blackcrab-desktop-qa")])
        run(["sudo", "systemctl", "start", f"user@{UID}.service"])
        run(["sudo", "runuser", "-u", NAME, "--", "env", "-i", f"HOME={QA_HOME}", f"USER={NAME}", f"LOGNAME={NAME}",
             "PATH=/usr/bin:/bin", "LANG=C.UTF-8", f"XDG_RUNTIME_DIR=/run/user/{UID}",
             f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{UID}/bus", "/usr/bin/xvfb-run", "--auto-servernum",
             "--server-args=-screen 0 1440x1000x24 -nolisten tcp", "/usr/bin/python3", str(QA_HOME / "test.py"), "--inside"], timeout=600)
    finally:
        cleanup_errors = []
        def cleanup(args):
            try:
                run(args)
            except Exception:
                cleanup_errors.append(args[1])

        if created:
            # Export only bounded public result and fresh empty-workspace images.
            # Driver, profile and service logs/configuration remain private.
            for name in ["result.json", "deb-workspace.png", "appimage-workspace.png"]:
                if (QA_HOME / name).is_file():
                    cleanup(["sudo", "install", "-o", str(os.getuid()), "-m", "0600", str(QA_HOME / name), str(output / name)])
            cleanup(["sudo", "loginctl", "terminate-user", NAME])
            cleanup(["sudo", "systemctl", "stop", f"user@{UID}.service"])
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
    print("INSTALLED_LINUX_DEB_AND_APPIMAGE_WORKSPACE_ACCEPTANCE_PASSED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path)
    parser.add_argument("--inside", action="store_true")
    args = parser.parse_args()
    if args.inside:
        inside()
    elif args.report:
        main(args.report.resolve())
    else:
        parser.error("--report required")
