import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("recovery", Path(__file__).with_name("recover-macos-browser-channel.py"))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)

@unittest.skipUnless(os.uname().sysname == "Darwin", "Mac recovery utility")
class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.owner = Path(self.temporary.name).resolve()
        self.directory = Path("/private/tmp") / ("blackcrab-browser-" + secrets.token_hex(16))
        self.config = {"schema": 2, "ownership": "service", "manifestDigest": recovery.MANIFEST,
                       "browser": {"path": str(self.directory / "b.sock"), "key": secrets.token_hex(32), "generation": 42}}
        self.put(".blackcrab-managed-host", b"blackcrab-managed-host-v1\n")
        self.put("launcher.lock", b"")
        self.put("configuration.json", json.dumps(self.config).encode())
        self.put("history", b"retained history")

    def put(self, name, value):
        path = self.owner / name
        path.write_bytes(value)
        path.chmod(0o600)

    def tearDown(self):
        if self.directory.is_symlink(): self.directory.unlink()
        elif self.directory.exists(): shutil.rmtree(self.directory)
        self.temporary.cleanup()

    def test_restore_only_missing_and_preserve_config(self):
        before = (self.owner / "configuration.json").read_bytes()
        self.assertIn("missing", recovery.recover(self.owner))
        self.assertFalse(self.directory.exists())
        self.assertIn("restored", recovery.recover(self.owner, True))
        recovery.verify_runtime(self.directory, self.owner)
        self.assertTrue((self.owner / "configuration.json").read_bytes() == before)
        self.assertEqual((self.owner / "history").read_bytes(), b"retained history")
        self.assertIn("no changes", recovery.recover(self.owner, True))

    def test_refuse_preexisting_empty_or_symlink(self):
        self.directory.mkdir(mode=0o700)
        with self.assertRaises(Exception): recovery.recover(self.owner, True)
        self.assertTrue(self.directory.is_dir())
        self.directory.rmdir()
        self.directory.symlink_to(self.owner, target_is_directory=True)
        with self.assertRaises(Exception): recovery.recover(self.owner, True)
        self.assertTrue(self.directory.is_symlink())

    def test_refuse_foreign_configuration(self):
        self.config["manifestDigest"] = "0" * 64
        self.put("configuration.json", json.dumps(self.config).encode())
        with self.assertRaises(Exception): recovery.recover(self.owner, True)
        self.assertFalse(self.directory.exists())

if __name__ == "__main__": unittest.main()
