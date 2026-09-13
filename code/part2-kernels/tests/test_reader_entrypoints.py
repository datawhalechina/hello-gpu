"""Reader entrypoint checks that stop before activating or executing GPU tools."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


PART = Path(__file__).resolve().parents[1]


class ReaderEntrypointsTest(unittest.TestCase):
    def test_all_entrypoints_reach_environment_setup_without_git_or_commit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            part = root / "part2-kernels"
            (part / ".venv/bin").mkdir(parents=True)
            (part / ".venv/bin/activate").touch()
            (part / "activate-rocm.sh").write_text(
                'echo "REACHED_ENVIRONMENT_SETUP"\nexit 77\n', encoding="utf-8"
            )
            binary_dir = root / "bin"
            binary_dir.mkdir()
            git = binary_dir / "git"
            git.write_text('#!/bin/sh\necho called >> "$GIT_CALL_LOG"\nexit 99\n')
            git.chmod(0o755)
            environment = os.environ.copy()
            environment.pop("HELLO_GPU_SKIP_ACTIVATE", None)
            environment["PATH"] = str(binary_dir) + os.pathsep + environment.get("PATH", "")
            environment["GIT_CALL_LOG"] = str(root / "git-calls")
            scripts = sorted(PART.glob("chapter*/run_all.sh")) + sorted(PART.glob("chapter*/profile_all.sh"))
            for source in scripts:
                chapter = part / source.parent.name
                chapter.mkdir(exist_ok=True)
                script = chapter / source.name
                shutil.copy2(source, script)
                for legacy_value in (None, "obsolete-value"):
                    with self.subTest(script=str(source.relative_to(PART)), legacy_value=legacy_value):
                        if legacy_value is None:
                            environment.pop("SOURCE_COMMIT", None)
                        else:
                            environment["SOURCE_COMMIT"] = legacy_value
                        completed = subprocess.run(
                            ["bash", str(script)], cwd=root, env=environment,
                            text=True, capture_output=True, check=False,
                        )
                        self.assertEqual(completed.returncode, 77, completed.stderr)
                        self.assertIn("REACHED_ENVIRONMENT_SETUP", completed.stdout)
            self.assertFalse((root / "git-calls").exists())


if __name__ == "__main__":
    unittest.main()
