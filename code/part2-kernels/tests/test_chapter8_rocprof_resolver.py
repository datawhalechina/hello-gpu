from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
CHAPTER = ROOT / "chapter8"
RESOLVER = CHAPTER / "resolve_rocprofv3.py"


def load_resolver():
    if not RESOLVER.is_file():
        raise AssertionError(f"missing rocprof resolver: {RESOLVER}")
    spec = importlib.util.spec_from_file_location("chapter8_rocprof_resolver", RESOLVER)
    if spec is None or spec.loader is None:
        raise AssertionError(f"cannot load rocprof resolver: {RESOLVER}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class RocprofSelectionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = load_resolver()

    def test_matching_system_rocm_release_line_is_accepted(self) -> None:
        selection = self.module.select_rocprofv3(
            torch_hip="7.2.53211",
            bundled_roots=(),
            system_executable=Path("/opt/rocm-7.2.4/bin/rocprofv3"),
            system_rocm_version="7.2.4",
        )

        self.assertTrue(selection.available)
        self.assertEqual(selection.kind, "system")
        self.assertEqual(
            selection.executable,
            Path("/opt/rocm-7.2.4/bin/rocprofv3"),
        )
        self.assertEqual(selection.root, Path("/opt/rocm-7.2.4"))
        self.assertEqual(
            selection.library_dirs[0],
            Path("/opt/rocm-7.2.4/lib"),
        )
        self.assertEqual(selection.torch_hip, "7.2.53211")
        self.assertEqual(selection.rocprof_rocm, "7.2.4")

    def test_bundled_profiler_takes_precedence_over_system_profiler(self) -> None:
        bundled = Path("/venv/lib/python3.12/site-packages/_rocm_sdk_core")
        selection = self.module.select_rocprofv3(
            torch_hip="7.13.0",
            bundled_roots=(bundled,),
            system_executable=Path("/opt/rocm-7.2.4/bin/rocprofv3"),
            system_rocm_version="7.2.4",
        )

        self.assertTrue(selection.available)
        self.assertEqual(selection.kind, "bundled")
        self.assertEqual(selection.executable, bundled / "bin" / "rocprofv3")
        self.assertEqual(selection.root, bundled)

    def test_mismatched_system_release_line_is_rejected(self) -> None:
        selection = self.module.select_rocprofv3(
            torch_hip="7.13.0",
            bundled_roots=(),
            system_executable=Path("/opt/rocm-7.2.4/bin/rocprofv3"),
            system_rocm_version="7.2.4",
        )

        self.assertFalse(selection.available)
        self.assertEqual(selection.kind, "none")
        self.assertIn("does not match", selection.reason)

    def test_missing_profiler_is_rejected(self) -> None:
        selection = self.module.select_rocprofv3(
            torch_hip="7.2.53211",
            bundled_roots=(),
            system_executable=None,
            system_rocm_version=None,
        )

        self.assertFalse(selection.available)
        self.assertIn("not found", selection.reason)

    def test_discovers_versioned_rocm_under_opt_without_path_entry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            opt_root = Path(temporary)
            executable = opt_root / "rocm-8.1.2" / "bin" / "rocprofv3"
            executable.parent.mkdir(parents=True)
            executable.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            executable.chmod(0o755)

            candidates = self.module.system_rocprof_candidates(
                path_executable=None,
                environment={},
                opt_root=opt_root,
            )

        self.assertEqual(candidates, (executable.resolve(),))

    def test_json_contract_contains_paths_and_versions(self) -> None:
        selection = self.module.select_rocprofv3(
            torch_hip="7.2.53211",
            bundled_roots=(),
            system_executable=Path("/opt/rocm-7.2.4/bin/rocprofv3"),
            system_rocm_version="7.2.4",
        )

        payload = json.loads(self.module.selection_json(selection))
        self.assertEqual(payload["kind"], "system")
        self.assertEqual(payload["root"], "/opt/rocm-7.2.4")
        self.assertEqual(payload["torch_hip"], "7.2.53211")
        self.assertEqual(payload["rocprof_rocm"], "7.2.4")

    def test_line_contract_has_exactly_eight_fields(self) -> None:
        selection = self.module.select_rocprofv3(
            torch_hip="7.2.53211",
            bundled_roots=(),
            system_executable=Path("/opt/rocm-7.2.4/bin/rocprofv3"),
            system_rocm_version="7.2.4",
        )

        fields = self.module.selection_lines(selection).splitlines()
        self.assertEqual(len(fields), 8)
        self.assertEqual(fields[0], "1")
        self.assertEqual(fields[1], "system")
        self.assertEqual(fields[2], "/opt/rocm-7.2.4/bin/rocprofv3")
        self.assertEqual(fields[3], "/opt/rocm-7.2.4")
        self.assertEqual(fields[5], "7.2.53211")
        self.assertEqual(fields[6], "7.2.4")


if __name__ == "__main__":
    unittest.main()
