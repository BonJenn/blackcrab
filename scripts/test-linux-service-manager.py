#!/usr/bin/env python3
"""Native CI only: exercise systemd in a new disposable OS account.

Never point the test at the runner's or a developer's existing user manager.
The product itself never uses sudo, creates accounts or enables linger.
"""
import json
import argparse
import os
from pathlib import Path
import pwd
import subprocess
import tempfile


def run(args, **kwargs):
    kwargs.setdefault("timeout", 180)
    return subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--actual-host", action="store_true")
    args = parser.parse_args()
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
    archive = None
    if args.actual_host:
        for key in ("BLACKCRAB_EMBEDDED_HOST_MANIFEST_SHA256", "BLACKCRAB_EMBEDDED_HOST_ARCHIVE_SHA256"):
            value = os.environ.get(key, "")
            if len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
                raise RuntimeError("Actual package requires freshly selected compile-time pins")
        archive = Path(os.environ["BLACKCRAB_TEST_HOST_ARCHIVE"])
        helper = Path(os.environ["BLACKCRAB_SERVICE_ISSUER_PATH"])
        if not archive.is_absolute() or not archive.is_file() or not helper.is_absolute() or not helper.is_file():
            raise RuntimeError("Actual package/helper are missing")
    result = subprocess.run(["cargo", "test", "--locked", "--lib", "--no-run", "--message-format=json"],
                            cwd=root / "src-tauri", capture_output=True, text=True, timeout=1800)
    if result.returncode != 0:
        print(result.stderr[-32768:])
        raise RuntimeError("Native test compilation failed; no QA account was created")
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
        if archive is not None:
            run(["sudo", "install", "-o", str(uid), "-m", "0600", str(archive), str(home / "managed-host-payload.tar.gz")])
        with tempfile.NamedTemporaryFile(mode="w", prefix="blackcrab-ci-marker-") as marker:
            marker.write("isolated-ci-only\n")
            marker.flush()
            run(["sudo", "install", "-m", "0644", marker.name, str(home / ".blackcrab-disposable-systemd-qa")])
        run(["sudo", "systemctl", "start", f"user@{uid}.service"])
        test = ("managed_host::service_package_tests::actual_packaged_linux_service_lifecycle" if args.actual_host else
                "managed_host::linux_service_control::tests::actual_systemd_user_lifecycle")
        result = subprocess.run(["sudo", "runuser", "-u", name, "--", "env", "-i", f"HOME={home}", f"USER={name}", f"LOGNAME={name}",
             "PATH=/usr/bin:/bin", "LANG=C", f"XDG_RUNTIME_DIR=/run/user/{uid}",
             f"DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/{uid}/bus", str(home / "native-tests"),
             test, "--exact", "--ignored", "--nocapture"], timeout=600, capture_output=True, text=True)
        print(result.stdout)
        print(result.stderr)
        if result.returncode != 0 or "1 passed; 0 failed; 0 ignored" not in result.stdout:
            raise RuntimeError("The actual native acceptance test did not run")
    finally:
        if created:
            # Only the newly created account/unit may be stopped and removed.
            run(["sudo", "systemctl", "stop", f"user@{uid}.service"])
            run(["sudo", "systemctl", "stop", f"user-runtime-dir@{uid}.service"])
            run(["sudo", "userdel", "--remove", name])


if __name__ == "__main__":
    main()
