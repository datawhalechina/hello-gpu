"""The source bootstrap works in an existing kernel without touching its SDK."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class BootstrapTests(unittest.TestCase):
    def test_bootstrap_resolves_checkout_without_importing_gpu_packages(self):
        common = Path(__file__).resolve().parents[1]
        chapter = common.parent / "part0-intro" / "chapter1"
        script = """
import importlib.util
from pathlib import Path
import runpy
import sys

bootstrap = Path(sys.argv[1])
expected = Path(sys.argv[2]).resolve()
for _ in range(2):
    runpy.run_path(str(bootstrap))
assert sys.path[0] == str(expected)
assert sys.path.count(str(expected)) == 1
assert Path(importlib.util.find_spec("hello_gpu").origin) == expected / "hello_gpu" / "__init__.py"
assert not {"torch", "triton", "hello_gpu"}.intersection(sys.modules)
"""
        with tempfile.TemporaryDirectory() as unrelated:
            locations = [
                (chapter, "../../common/bootstrap.py"),
                (Path(unrelated), str(common / "bootstrap.py")),
            ]
            for cwd, bootstrap in locations:
                with self.subTest(cwd=str(cwd)):
                    result = subprocess.run(
                        [sys.executable, "-I", "-c", script, bootstrap, str(common / "src")],
                        cwd=cwd, capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
