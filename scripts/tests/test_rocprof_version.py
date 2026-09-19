"""ROCm SDK 10.0 and its HIP 7.15 component must not be conflated."""

from pathlib import Path
import sys
import unittest

CHAPTER = Path(__file__).resolve().parents[2] / "code/part2-kernels/chapter8"
sys.path.insert(0, str(CHAPTER))
from resolve_rocprofv3 import select_rocprofv3


class RocprofVersionTest(unittest.TestCase):
    def test_bundled_reports_actual_sdk_version(self):
        result = select_rocprofv3(
            torch_hip="7.15.26333", torch_rocm_version="10.0.0",
            bundled_roots=[Path("/example/sdk")], bundled_rocm_version="10.0.0",
            system_executable=None, system_rocm_version=None,
        )
        self.assertTrue(result.available)
        self.assertEqual(result.rocprof_rocm, "10.0.0")
        self.assertEqual(result.torch_hip, "7.15.26333")

    def test_matching_sdk_is_accepted_even_when_hip_number_differs(self):
        result = select_rocprofv3(
            torch_hip="7.15.26333", torch_rocm_version="10.0.0", bundled_roots=[],
            system_executable=Path("/example/bin/rocprofv3"), system_rocm_version="10.0.0",
        )
        self.assertTrue(result.available)
        self.assertEqual(result.kind, "system")

    def test_different_sdk_is_rejected(self):
        result = select_rocprofv3(
            torch_hip="7.15.26333", torch_rocm_version="10.0.0", bundled_roots=[],
            system_executable=Path("/example/bin/rocprofv3"), system_rocm_version="7.15.0",
        )
        self.assertFalse(result.available)


if __name__ == "__main__":
    unittest.main()
