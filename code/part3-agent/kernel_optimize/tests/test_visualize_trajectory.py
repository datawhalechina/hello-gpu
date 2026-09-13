"""Host-only regression: synthetic records test chart semantics, not GPU speed."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


_MODULE_PATH = Path(__file__).resolve().parents[2] / "chapter16" / "visualize_trajectory.py"
_SPEC = importlib.util.spec_from_file_location("visualize_trajectory", _MODULE_PATH)
assert _SPEC is not None and _SPEC.loader is not None
visualize_trajectory = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(visualize_trajectory)


class AcceptedLatencyTest(unittest.TestCase):
    def test_current_version_uses_acceptance_and_preserves_missing_measurements(self) -> None:
        # These deliberately invented values are fixtures, never benchmark data.
        rows = [
            {"accepted": False, "latencyMs": 0.7},  # No accepted version yet.
            {"accepted": True, "latencyMs": 1.0},
            {"accepted": False, "latencyMs": 0.4},  # Faster rejected candidate.
            {"accepted": False, "status": "compile_error"},
            {"accepted": True, "latencyMs": 1.2},   # Cross-round noise can rise.
            {"accepted": True, "latencyMs": None},  # New version has no record.
            {"accepted": False, "latencyMs": 0.2},
            {"accepted": True, "latencyMs": 1.1},
            {"accepted": False},
        ]

        self.assertEqual(
            visualize_trajectory._accepted_latency_series(rows),
            [None, 1.0, 1.0, 1.0, 1.2, None, None, 1.1, 1.1],
        )


if __name__ == "__main__":
    unittest.main()
