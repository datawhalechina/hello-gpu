"""Host-only checks for optional reader provenance; no GPU commands are run."""

from __future__ import annotations

import ast
import contextlib
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


PART = Path(__file__).resolve().parents[1]
REPO = PART.parents[1]
HELPER = PART / "common" / "source_commit.sh"
BASH = shutil.which("bash")


class SourceCommitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.git_calls = self.root / "git-calls"
        git = self.bin / "git"
        git.write_text('#!/bin/sh\nprintf "called\\n" >> "$GIT_CALL_LOG"\nexit 99\n')
        git.chmod(0o755)
        self.env = os.environ.copy()
        self.env.pop("SOURCE_COMMIT", None)
        self.env["GIT_CALL_LOG"] = str(self.git_calls)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_helper(self, helper: Path = HELPER) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [BASH, str(helper)], cwd=self.root, env=self.env,
            text=True, capture_output=True, check=False,
        )

    def spy_on_git(self) -> None:
        self.env["PATH"] = str(self.bin) + os.pathsep + self.env.get("PATH", "")

    def copy_archive(self) -> Path:
        helper = self.root / "archive" / "code" / "part2-kernels" / "common" / HELPER.name
        helper.parent.mkdir(parents=True)
        shutil.copy2(HELPER, helper)
        return helper

    def test_clone_records_its_head_even_when_called_from_another_directory(self) -> None:
        self.env.pop("GIT_DIR", None)
        self.env.pop("GIT_WORK_TREE", None)
        expected = subprocess.check_output(
            ["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True, env=self.env,
        ).strip()
        # The helper must also ignore caller-specific repository overrides.
        self.env["GIT_DIR"] = str(self.root / "another-repository.git")
        self.env["GIT_WORK_TREE"] = str(self.root)
        completed = self.run_helper()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), expected)

    def test_explicit_commit_bypasses_git_entirely(self) -> None:
        self.spy_on_git()
        self.env["SOURCE_COMMIT"] = "abcdef1234567"
        completed = self.run_helper()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), "abcdef1234567")
        self.assertFalse(self.git_calls.exists())

    def test_archive_does_not_inherit_an_ancestor_repository(self) -> None:
        helper = self.copy_archive()
        (self.root / ".git").mkdir()
        self.spy_on_git()
        completed = self.run_helper(helper)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), "unknown")
        self.assertFalse(self.git_calls.exists())

    def test_worktree_git_file_is_supported_and_root_must_match(self) -> None:
        helper = self.copy_archive()
        checkout = helper.parents[3].resolve()
        (checkout / ".git").write_text("gitdir: /fixture/worktree-metadata\n")
        git = self.bin / "git"
        git.write_text(
            '#!/bin/sh\n'
            'case "$4" in\n'
            '  --show-toplevel) printf "%s\\n" "$FIXTURE_GIT_ROOT" ;;\n'
            '  --verify) printf "%s\\n" "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ;;\n'
            '  *) exit 99 ;;\n'
            'esac\n'
        )
        self.spy_on_git()
        self.env["FIXTURE_GIT_ROOT"] = str(checkout)
        completed = self.run_helper(helper)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), "a" * 40)

        self.env["FIXTURE_GIT_ROOT"] = str(self.root)
        completed = self.run_helper(helper)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), "unknown")

    def test_git_unavailable_in_a_checkout_is_nonblocking(self) -> None:
        only_utilities = self.root / "utilities"
        only_utilities.mkdir()
        (only_utilities / "dirname").symlink_to(shutil.which("dirname"))
        self.env["PATH"] = str(only_utilities)
        completed = self.run_helper()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), "unknown")

    def test_unreadable_git_metadata_is_honestly_unknown(self) -> None:
        self.spy_on_git()
        completed = self.run_helper()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), "unknown")
        self.assertTrue(self.git_calls.exists())

    def test_malformed_explicit_commit_fails_without_git_or_artifact_writes(self) -> None:
        self.spy_on_git()
        for invalid in ("abc123", "A" * 40, "g" * 40, "a" * 41, "unknown", "a" * 7 + "\n"):
            with self.subTest(source_commit=invalid):
                self.env["SOURCE_COMMIT"] = invalid
                completed = self.run_helper()
                self.assertEqual(completed.returncode, 2, completed.stderr)
                self.assertIn("SOURCE_COMMIT", completed.stderr)
                self.assertEqual(completed.stdout, "")
        self.assertFalse(self.git_calls.exists())

    def test_all_metadata_entrypoints_validate_before_creating_artifacts(self) -> None:
        helper = self.copy_archive()
        self.env["SOURCE_COMMIT"] = "not-a-sha"
        paths = [PART / "chapter8" / "run_all.sh", *sorted(PART.glob("chapter*/profile_all.sh"))]
        for source in paths:
            with self.subTest(script=str(source.relative_to(PART))):
                chapter = helper.parent.parent / source.parent.name
                chapter.mkdir(exist_ok=True)
                script = chapter / source.name
                shutil.copy2(source, script)
                existing = set(chapter.iterdir())
                completed = subprocess.run(
                    [BASH, str(script)], cwd=self.root, env=self.env,
                    text=True, capture_output=True, check=False,
                )
                self.assertEqual(completed.returncode, 2, completed.stderr)
                self.assertIn("SOURCE_COMMIT", completed.stderr)
                self.assertEqual(set(chapter.iterdir()), existing)

    def test_notebook_uses_the_same_archive_and_override_resolution(self) -> None:
        notebook = json.loads((REPO / "notebooks/part2-kernels/chapter8.ipynb").read_text())
        cell = next("".join(c["source"]) for c in notebook["cells"] if "def source_commit_for_formal_run():" in "".join(c["source"]))
        function = next(n for n in ast.parse(cell).body if isinstance(n, ast.FunctionDef) and n.name == "source_commit_for_formal_run")
        helper = self.copy_archive()
        namespace = {"subprocess": subprocess, "code_dir": helper.parent.parent / "chapter8"}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "notebook-provenance", "exec"), namespace)
        self.spy_on_git()
        with mock.patch.dict(os.environ, self.env, clear=True), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(namespace[function.name](), "unknown")
            os.environ["SOURCE_COMMIT"] = "abcdef1234567"
            self.assertEqual(namespace[function.name](), "abcdef1234567")
            os.environ["SOURCE_COMMIT"] = "malformed"
            self.assertIsNone(namespace[function.name]())
        self.assertFalse(self.git_calls.exists())


if __name__ == "__main__":
    unittest.main()
