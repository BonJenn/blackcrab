#!/usr/bin/env python3
"""Native CI only: exercise systemd in a new disposable OS account.

Never point the test at the runner's or a developer's existing user manager.
The product itself never uses sudo, creates accounts or enables linger.
"""
import json
import os
from pathlib import Path
import pwd
import subprocess
import tempfile


def run(args, **kwargs):
    kwargs.setdefault("timeout", 180)
    return subprocess.run(args, check=True, **kwargs)


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "Linux":
        raise RuntimeError("This test requires a disposable GitHub-hosted Linux runner")
    name, uid = "blackcrab-systemd-qa", 1999
    home = Path("/home") / name
    if home.exists() or home.is_symlink():
        raise RuntimeError("Refusing an existing QA home")
    for identity in (name, uid):
        try:
            pwd.getpwnam(identity) if isinstance(identity, str) else pwd.getpwuid(identity)
        except KeyError:
            continue
        raise RuntimeError("Refusing an existing QA account")
    root = Path(__file__).resolve().parent.parent
    result = run(["cargo", "test", "--locked", "--lib", "--no-run", "--message-format=json"],
                 cwd=root / "src-tauri", capture_output=True, text=True)
    binaries = [item["executable"] for line in result.stdout.splitlines()
                if line.startswith("{") and (item := json.loads(line)).get("reason") == "compiler-artifact"
                and item.get("profile", {}).get("test") and item.get("target", {}).get("name") == "blackcrab_lib"
                and item.get("executable")]
    if len(binaries) != 1:
        raise RuntimeError("Expected one compiled native test executable")
    created = False
    try:
        run(["sudo", "useradd", "--create-home", "--home-dir", str(home), "--uid", str(uid), "--shell", "/bin/bash", name])
        created = True
        # Copy only our compiled test executable and a public fixture marker.
        run(["sudo", "install", "-m", "0755", binaries[0], str(home / "native-tests")])
        with tempfile.NamedTemporaryFile(mode="w", prefix="blackcrab-ci-marker-") as marker:
            marker.write("isolated-ci-only\n")
            marker.flush()
            run(["sudo", "install", "-m", "0644", marker.name, str(home / ".blackcrab-disposable-systemd-qa")])
        run(["sudo", "systemctl", "start", f"user@{uid}.service"])
        run(["sudo", "runuser", "-u", name, "--", "env", "-i", f"HOME={home}", f"USER={name}", f"LOGNAME={name}",
             "PATH=/usr/bin:/bin", "LANG=C", f"XDG_RUNTIME_DIR=/run/user/{uid}",
             f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus", str(home / "native-tests"),
             "managed_host::linux_service_control::tests::actual_systemd_user_lifecycle", "--exact", "--ignored", "--nocapture"], timeout=300)
    finally:
        if created:
            # Only the newly created account/unit may be stopped and removed.
            run(["sudo", "systemctl", "stop", f"user@{uid}.service"])
            run(["sudo", "systemctl", "stop", f"user-runtime-dir@{uid}.service"])
            run(["sudo", "userdel", "--remove", name])


if __name__ == "__main__":
    main()
