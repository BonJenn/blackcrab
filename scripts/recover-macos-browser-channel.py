#!/usr/bin/env python3
"""Repair only an absent 0.4.3 browser runtime directory; never reset app data."""
import argparse
import ctypes
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import tempfile

MANIFEST = "c04c4d4498a552d3c1ca26c2d600ddde7ed513c8c6030d5f7ce79ece15f45e83"
MARKER = ".blackcrab-browser-owner.json"


def require(ok):
    if not ok:
        raise RuntimeError("Ownership or capability verification failed; nothing was replaced")


def private(path, mode, directory=False):
    info = path.lstat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == mode
            and (directory or info.st_nlink == 1))


def read_private(path, limit=1024 * 1024):
    private(path, 0o600)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1)
        value = source.read(limit + 1)
        require(len(value) <= limit)
        return value


def verify_runtime(directory, owner):
    private(directory, 0o700, directory=True)
    require(directory.resolve() == directory)
    require(json.loads(read_private(directory / MARKER, 4096)) == {"schema": 1, "owner": str(owner)})
    socket = directory / "b.sock"
    if os.path.lexists(socket):
        info = socket.lstat()
        require(stat.S_ISSOCK(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o600)


def recover(owner, repair=False):
    private(owner, 0o700, directory=True)
    require(owner.resolve() == owner)
    require(read_private(owner / ".blackcrab-managed-host", 64) == b"blackcrab-managed-host-v1\n")
    # Same configuration lease as Root/helper; do not stop or adopt any process.
    private(owner / "launcher.lock", 0o600)
    lock = os.open(owner / "launcher.lock", os.O_RDWR | os.O_NOFOLLOW)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1 and info.st_size == 0)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = read_private(owner / "configuration.json")
        config = json.loads(before)
        require(config.get("schema") == 2 and config.get("ownership") == "service"
                and config.get("manifestDigest") == MANIFEST)
        cap = config.get("browser", {})
        require(set(cap) == {"path", "key", "generation"})
        require(isinstance(cap["key"], str) and re.fullmatch(r"[0-9a-f]{64}", cap["key"])
                and type(cap["generation"]) is int and 1 <= cap["generation"] <= 9007199254740991)
        socket = Path(cap["path"])
        directory = socket.parent
        require(socket.is_absolute() and len(os.fsencode(socket)) <= 100 and socket.name == "b.sock"
                and directory.parent == Path("/private/tmp")
                and re.fullmatch(r"blackcrab-browser-[0-9a-f]{32}", directory.name))
        if os.path.lexists(directory):
            verify_runtime(directory, owner)
            return "Existing runtime directory verified; no changes"
        if not repair:
            return "Verified configuration; temporary runtime directory is missing"
        # Prepare the complete private marker first, then publish atomically with
        # Darwin RENAME_EXCL (0x4). Never replace even an empty existing directory.
        with tempfile.TemporaryDirectory(prefix="blackcrab-browser-recovery-", dir="/private/tmp") as name:
            stage = Path(name)
            fd = os.open(stage / MARKER, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as target:
                target.write(json.dumps({"schema": 1, "owner": str(owner)}).encode())
                target.flush()
                os.fsync(target.fileno())
            require(read_private(owner / "configuration.json") == before)
            system = ctypes.CDLL(None, use_errno=True)
            rename = system.renameatx_np
            rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            rename.restype = ctypes.c_int
            if rename(-2, os.fsencode(stage), -2, os.fsencode(directory), 0x4) != 0:
                raise RuntimeError("Runtime publication refused; no existing directory was replaced")
        verify_runtime(directory, owner)
        require(read_private(owner / "configuration.json") == before)
        return "Missing runtime directory restored; persistent configuration unchanged"
    finally:
        os.close(lock)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repair", action="store_true", help="restore only a verified missing temporary directory")
    args = parser.parse_args()
    try:
        require(os.uname().sysname == "Darwin")
        owner = Path.home() / "Library/Application Support/com.bonjenn.blackcrab/managed-host/v1"
        print(recover(owner, args.repair))
    except Exception:
        # Never render secret-bearing config values or arbitrary exception text.
        raise SystemExit("Recovery refused or busy; existing app data and configuration were left intact")
