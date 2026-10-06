"""CPU regressions for measured validation shapes in Chapter 9 plots.

Temporary manifests describe existing published observations; these are not new
GPU runs. CSV bytes stay unchanged, and --validate-only never renders images.
"""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE / 'evidence/rounds'


class ValidationShapeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix='ch9-plot-shape-test-')
        self.addCleanup(temporary.cleanup)
        self.evidence = Path(temporary.name)
        for name in ('manifest.json', 'summary.csv', 'process-summary.csv'):
            shutil.copy2(EVIDENCE / name, self.evidence / name)
        self.manifest = json.loads((self.evidence / 'manifest.json').read_text())

    def validate(self, shape: int, round_name: str = 'wave') -> subprocess.CompletedProcess:
        (self.evidence / 'manifest.json').write_text(json.dumps(self.manifest))
        return subprocess.run(
            [sys.executable, str(HERE / 'plot_rounds.py'),
             '--evidence', str(self.evidence), '--shape', str(shape),
             '--round', round_name, '--validate-only'],
            capture_output=True, text=True, check=False,
        )

    def test_published_singular_shape_is_accepted(self) -> None:
        self.assertEqual(self.manifest['validation_selection']['shape'], 1048576)
        result = self.validate(1048576)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Validated 3 full-operator round records at N=1048576', result.stdout)

    def test_plural_shape_schema_remains_supported(self) -> None:
        selection = self.manifest['validation_selection']
        selection['shapes'] = [selection.pop('shape')]
        result = self.validate(1048576)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_main_shape_needs_no_validation_section(self) -> None:
        self.manifest.pop('validation_selection')
        result = self.validate(16777216)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_existing_rows_do_not_declare_a_shape(self) -> None:
        self.manifest.pop('validation_selection')
        result = self.validate(1048576)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('N=1048576 is not declared', result.stderr)

    def test_unmeasured_shape_is_rejected(self) -> None:
        result = self.validate(1048577)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('N=1048577 is not declared', result.stderr)

    def test_declared_shape_does_not_supply_unmeasured_configs(self) -> None:
        # Only p1024 and p256 were measured at this secondary shape.
        result = self.validate(1048576, 'triton')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing N=1048576 measurements', result.stderr)


if __name__ == '__main__':
    unittest.main()
