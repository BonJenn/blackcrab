import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("linux_workspace", Path(__file__).with_name("test-linux-installed-workspace.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CandidateTests(unittest.TestCase):
    def test_both_packages_are_bound_to_the_actual_verified_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            items = []
            for kind in ("deb", "appimage"):
                file = root / kind
                file.write_bytes(b"isolated verifier fixture")
                items.append({"kind": kind, "file": str(file), "sha256": module.digest(file)})
            report = root / "report.json"
            data = {"passed": True, "published": False, "target": "linux-x64", "packages": items}
            report.write_text(json.dumps(data))
            self.assertEqual(set(module.verified_installers(report)), {"deb", "appimage"})
            (root / "deb").write_bytes(b"changed package")
            with self.assertRaisesRegex(RuntimeError, "changed"):
                module.verified_installers(report)
            (root / "deb").write_bytes(b"isolated verifier fixture")
            for change in ({"passed": False}, {"target": "win32-x64"}, {"published": True},
                           {"packages": items[:1]}, {"packages": [*items, items[0]]}):
                report.write_text(json.dumps({**data, **change}))
                with self.assertRaises(RuntimeError):
                    module.verified_installers(report)

    def test_it_refuses_to_run_outside_disposable_ci_before_any_native_command(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(module.subprocess, "run") as execute:
            with self.assertRaisesRegex(RuntimeError, "Disposable"):
                module.main(Path("unused.json"))
            execute.assert_not_called()

    def test_webdriver_failure_does_not_print_arbitrary_response_messages(self):
        payload = io.BytesIO(json.dumps({"value": {"error": "no such window", "message": "private diagnostic"}}).encode())
        with patch.object(module.urllib.request, "urlopen", side_effect=HTTPError("", 404, "", {}, payload)):
            with self.assertRaisesRegex(module.DriverFailure, "^no such window$"):
                module.request("GET", "/session/fixture/window/handles")

    def test_a_script_result_is_not_mistaken_for_a_webdriver_error(self):
        class Reply(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False
        for value in ({"status": "Starting", "alert": None}, {"status": None, "error": None}):
            with patch.object(module.urllib.request, "urlopen", return_value=Reply(json.dumps({"value": value}).encode())):
                self.assertEqual(module.request("POST", "/session/fixture/execute/sync", {}), value)
        reply = Reply(json.dumps({"value": {"error": "no such window", "message": "m"}}).encode())
        with patch.object(module.urllib.request, "urlopen", return_value=reply):
            with self.assertRaisesRegex(module.DriverFailure, "^no such window$"):
                module.request("GET", "/x")


if __name__ == "__main__":
    unittest.main()
