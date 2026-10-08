"""CPU checks for refusing incomplete or unrelated ATT decoder output."""
import csv
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

from validate_att import validate_att


class ValidateATTTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stats = self.root / 'stats_ui_output_agent_1_dispatch_8.csv'
        self.fields = ['CodeObj', 'Vaddr', 'Instruction', 'Hitcount', 'Latency', 'Stall', 'Idle', 'Source']
        self.rows = [dict(zip(self.fields, ['2', '100', 'v_add_f32', '4', '4', '0', '0',
                                          '(anonymous namespace)::vector_add_v0(float*)']))]
        self.write_stats()
        self.ui = self.root / 'ui_output_agent_1_dispatch_8'
        self.ui.mkdir()
        (self.ui / 'code.json').write_text(json.dumps({'code': [['v_add_f32']]}))
        (self.ui / 'se0_sm0_sl0_wv0.json').write_text(json.dumps({'instructions': [1]}))

    def write_stats(self):
        with self.stats.open('w', newline='') as file:
            writer = csv.DictWriter(file, fieldnames=self.fields)
            writer.writeheader()
            writer.writerows(self.rows)

    def test_valid(self):
        self.assertEqual(validate_att(self.root)['dispatch'], 8)

    def test_missing_stats(self):
        self.stats.unlink()
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            validate_att(self.root)

    def test_multiple_dispatches(self):
        (self.root / 'stats_ui_output_agent_1_dispatch_9.csv').write_bytes(self.stats.read_bytes())
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            validate_att(self.root)

    def test_wrong_dispatch(self):
        self.stats.rename(self.root / 'stats_ui_output_agent_1_dispatch_9.csv')
        with self.assertRaisesRegex(ValueError, 'dispatch 8'):
            validate_att(self.root)

    def test_empty_csv(self):
        self.rows = []
        self.write_stats()
        with self.assertRaisesRegex(ValueError, 'no instruction rows'):
            validate_att(self.root)

    def test_missing_column(self):
        self.stats.write_text('Instruction,Source\nv_add_f32,vector_add_v0()\n')
        with self.assertRaisesRegex(ValueError, 'required columns'):
            validate_att(self.root)

    def test_wrong_kernel(self):
        self.rows[0]['Source'] = 'vector_add_v1(float*)'
        self.write_stats()
        with self.assertRaisesRegex(ValueError, 'vector_add_v0'):
            validate_att(self.root)

    def test_no_positive_hitcount(self):
        self.rows[0]['Hitcount'] = '0'
        self.write_stats()
        with self.assertRaisesRegex(ValueError, 'positive'):
            validate_att(self.root)

    def test_bad_count(self):
        self.rows[0]['Latency'] = 'nan'
        self.write_stats()
        with self.assertRaisesRegex(ValueError, 'non-negative integers'):
            validate_att(self.root)

    def test_missing_ui(self):
        self.ui.rename(self.root / 'unrelated_ui')
        with self.assertRaisesRegex(ValueError, 'UI directory'):
            validate_att(self.root)

    def test_invalid_json(self):
        (self.ui / 'code.json').write_text('{')
        with self.assertRaises(ValueError):
            validate_att(self.root)

    def test_empty_json(self):
        (self.ui / 'se0_sm0_sl0_wv0.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'empty decoded JSON'):
            validate_att(self.root)

    def test_cli_failure_is_nonzero_and_explicit(self):
        self.stats.unlink()
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('validate_att.py')),
                                 str(self.root)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('ATT validation failed:', result.stderr)
        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
