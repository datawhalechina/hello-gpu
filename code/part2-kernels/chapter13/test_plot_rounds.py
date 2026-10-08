"""CPU-only checks using subsets of published measurements, never new GPU data."""
from __future__ import annotations

import contextlib
import copy
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import plot_rounds as plot
from common.round_evidence import measurement_matrix, read_evidence


class PartialRoundEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        published = HERE / 'evidence/rounds'
        self.parent = json.loads((published / 'manifest.json').read_text())
        self.rows = list(csv.DictReader(io.StringIO((published / 'summary.csv').read_text())))
        self.processes = list(csv.DictReader(io.StringIO((published / 'process-summary.csv').read_text())))
        self.main_only()

    def tearDown(self):
        self.temp.cleanup()

    def main_only(self, ids=plot.MAIN_IDS):
        """Retain real main-phase values; all eight catalog entries remain."""
        self.parent['measurement_matrix'] = {plot.MAIN_SHAPE: list(ids)}
        self.parent.pop('validation_selection', None)
        self.parent.pop('profile', None)
        self.rows = [r for r in self.rows if r['shape'] == plot.MAIN_SHAPE and r['config_id'] in ids]
        self.processes = [r for r in self.processes if r['shape'] == plot.MAIN_SHAPE and r['config_id'] in ids]

    def write(self):
        for name, rows in (('summary.csv', self.rows), ('process-summary.csv', self.processes)):
            with (self.directory / name).open('w', newline='') as file:
                writer = csv.DictWriter(file, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
        self.parent['artifacts_sha256'] = {
            name: hashlib.sha256((self.directory / name).read_bytes()).hexdigest()
            for name in ('summary.csv', 'process-summary.csv')
        }
        self.save_manifest()

    def save_manifest(self):
        (self.directory / 'manifest.json').write_text(json.dumps(self.parent))

    def read(self):
        return read_evidence(self.directory, plot.expected_meta, plot.matches)

    def invoke(self, *arguments, directory=None):
        argv = ['plot_rounds.py', '--evidence', str(directory or self.directory), *arguments]
        with mock.patch.object(sys, 'argv', argv), contextlib.redirect_stdout(io.StringIO()) as stdout:
            plot.main()
        return stdout.getvalue()

    def test_catalog_can_include_unmeasured_later_phase(self):
        self.write()
        manifest, rows = self.read()
        self.assertEqual(len(manifest['configurations']), 8)
        self.assertEqual(len(rows), 6)
        self.assertEqual(measurement_matrix(manifest), {plot.MAIN_SHAPE: set(plot.MAIN_IDS)})
        self.assertFalse((self.directory / 'confirmation.json').exists())
        self.assertFalse((self.directory / 'profile-summary.csv').exists())

    def test_each_main_figure_accepts_main_only(self):
        self.write()
        for name in ('cooperative', 'block', 'warps'):
            with self.subTest(name=name):
                self.assertIn('for 1 figures', self.invoke('--round', name, '--validate-only'))

    def test_block_only_does_not_require_unrelated_candidates(self):
        self.main_only(plot.HIP_BLOCKS)
        self.write()
        self.assertIn('Validated 3', self.invoke('--round', 'block', '--validate-only'))

    def test_only_requested_figure_is_rendered_from_selected_input(self):
        self.write()
        with mock.patch.object(plot, 'render_panels') as render:
            self.invoke('--round', 'block', '--out-dir', str(self.directory / 'figures'))
        render.assert_called_once()
        self.assertEqual(render.call_args.kwargs['name'], 'block')
        values = render.call_args.kwargs['panels'][0].values
        expected = {r['config_id']: float(r['median_ms']) for r in self.rows}
        self.assertEqual({value.config: value.center_ms for value in values},
                         {cid: expected[cid] for cid in plot.HIP_BLOCKS})

    def test_default_all_figures_reject_incomplete_scan(self):
        self.write()
        with self.assertRaisesRegex(ValueError, 'missing measured configurations'):
            self.invoke('--validate-only')

    def test_missing_selected_candidate_rejected_even_when_matrix_consistent(self):
        self.main_only((plot.BASE_HIP, 'hip-block-b64'))
        self.write()
        with self.assertRaisesRegex(ValueError, 'hip-block-b128'):
            self.invoke('--round', 'block', '--validate-only')

    def test_short_rows_not_silently_filled_from_published_evidence(self):
        self.write()
        with self.assertRaisesRegex(ValueError, '4096x128'):
            self.invoke('--round', 'rows', '--validate-only')

    def test_published_all_figures_still_validate(self):
        output = self.invoke('--validate-only', directory=HERE / 'evidence/rounds')
        self.assertIn('19 RMSNorm configuration/shape groups', output)
        self.assertIn('4 main confirmations and 3 short-row confirmations', output)

    def test_missing_declared_row_rejected(self):
        self.rows.pop()
        self.write()
        with self.assertRaisesRegex(ValueError, 'Missing, extra or duplicate configuration/shape rows'):
            self.read()

    def test_extra_undeclared_row_rejected(self):
        self.parent['measurement_matrix'][plot.MAIN_SHAPE].remove(plot.SERIAL)
        self.write()
        with self.assertRaisesRegex(ValueError, 'Missing, extra or duplicate configuration/shape rows'):
            self.read()

    def test_missing_process_rejected(self):
        self.processes.pop()
        self.write()
        with self.assertRaisesRegex(ValueError, 'Incomplete or duplicate process matrix'):
            self.read()

    def test_duplicate_process_rejected(self):
        self.processes.append(copy.deepcopy(self.processes[0]))
        self.write()
        with self.assertRaisesRegex(ValueError, 'Incomplete or duplicate process matrix'):
            self.read()

    def test_unknown_matrix_configuration_rejected(self):
        self.parent['measurement_matrix'][plot.MAIN_SHAPE].append('unrecorded-config')
        self.write()
        with self.assertRaisesRegex(ValueError, 'invalid configuration subset'):
            self.read()

    def test_duplicate_matrix_configuration_rejected(self):
        self.parent['measurement_matrix'][plot.MAIN_SHAPE].append(plot.BASE_HIP)
        self.write()
        with self.assertRaisesRegex(ValueError, 'invalid configuration subset'):
            self.read()

    def test_corrupt_artifact_identity_rejected(self):
        self.write()
        with (self.directory / 'summary.csv').open('a') as file:
            file.write('\n')
        with self.assertRaisesRegex(ValueError, 'file is not bound to this experiment'):
            self.read()

    def test_rebound_wrong_configuration_metadata_rejected(self):
        next(r for r in self.rows if r['config_id'] == plot.BASE_HIP)['block'] = '64'
        self.write()
        with self.assertRaisesRegex(ValueError, 'configuration differs from manifest'):
            self.read()

    def test_malformed_source_identity_rejected(self):
        self.parent['source_sha256']['rmsnorm_hip.hip'] = 'not-a-source-hash'
        self.write()
        with self.assertRaisesRegex(ValueError, 'Missing frozen source identity'):
            self.invoke('--round', 'block', '--validate-only')

    def test_confirmation_cannot_change_parent_source_identity(self):
        published = HERE / 'evidence/rounds'
        parent = json.loads((published / 'manifest.json').read_text())
        confirmation = json.loads((published / 'confirmation.json').read_text())
        confirmation['source_sha256']['rmsnorm_hip.hip'] = '0' * 64
        target = self.directory / 'confirmation.json'
        target.write_text(json.dumps(confirmation))
        parent['artifacts_sha256']['confirmation.json'] = hashlib.sha256(target.read_bytes()).hexdigest()
        (self.directory / 'manifest.json').write_text(json.dumps(parent))
        with self.assertRaisesRegex(ValueError, 'same frozen kernels'):
            read_evidence(self.directory, plot.expected_meta, plot.matches,
                          confirmation='confirmation.json')


if __name__ == '__main__':
    unittest.main()
