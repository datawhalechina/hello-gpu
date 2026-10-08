"""CPU regressions for Attention confirmation subsets.

Fixtures are temporary filtered views of the already-published confirmation.
They retain its measured values; they are not new experimental runs. Only the
temporary JSON's binding hash is updated. Runtime, evidence and figures stay
unchanged, and rendering is intercepted before it can write any image.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE / 'evidence/rounds'
MINIMUM = ('hip-materialized-b256', 'hip-online-b256',
           'triton-materialized-k32', 'triton-online-k16')
OPTIONAL = ('triton-online-k32', 'triton-online-k64')


class ConfirmationSubsetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix='ch12-confirmation-subset-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.evidence = self.root / 'filtered-published-evidence'
        self.evidence.mkdir()
        for name in ('manifest.json', 'summary.csv', 'process-summary.csv', 'confirmation.json'):
            shutil.copy2(EVIDENCE / name, self.evidence / name)
        self.parent = json.loads((self.evidence / 'manifest.json').read_text())
        self.original = json.loads((self.evidence / 'confirmation.json').read_text())
        self.assertEqual({config['id'] for config in self.original['configurations']},
                         set((*MINIMUM, *OPTIONAL)))

    def bind(self, name: str) -> None:
        self.parent['artifacts_sha256'][name] = hashlib.sha256(
            (self.evidence / name).read_bytes()).hexdigest()
        (self.evidence / 'manifest.json').write_text(json.dumps(self.parent))

    def publish_fixture(self, confirmation: dict, *, rebind: bool = True) -> None:
        (self.evidence / 'confirmation.json').write_text(json.dumps(confirmation))
        if rebind:
            self.bind('confirmation.json')

    def subset(self, ids: tuple[str, ...]) -> dict:
        confirmation = copy.deepcopy(self.original)
        selected = set(ids)
        confirmation['selection_rule'] = 'CPU regression fixture: filtered published observations, not a new run'
        confirmation['configurations'] = [config for config in confirmation['configurations']
                                         if config['id'] in selected]
        confirmation['results'] = [row for row in confirmation['results']
                                   if row['config_id'] in selected]
        confirmation['process_results'] = [row for row in confirmation['process_results']
                                           if row['config_id'] in selected]
        shape = confirmation['benchmark']['shape']
        confirmation['measurement_matrix'] = {shape: list(ids)}
        for entry in confirmation.get('execution_order', []):
            entry['configs'] = [cid for cid in entry['configs'] if cid in selected]
        return confirmation

    def validate(self) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(HERE / 'plot_rounds.py'), '--evidence', str(self.evidence),
             '--round', 'confirmation', '--validate-only'],
            capture_output=True, text=True, check=False)

    def assert_rejected(self, fixture: dict, message: str, *, rebind: bool = True) -> None:
        self.publish_fixture(fixture, rebind=rebind)
        result = self.validate()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stderr)

    def rendered_spec(self) -> dict:
        # A fresh interpreter prevents same-named chapter modules from leaking
        # into one another when the repository runs several CPU test suites.
        code = '''
import json, sys
sys.path.insert(0, sys.argv[1])
import plot_rounds as plot
captured = []
def capture(**kw):
    captured.append(dict(name=kw['name'], notes=kw['notes'], panels=[
        dict(title=p.title, values=[dict(config=v.config, center=v.center_ms)
                                   for v in p.values]) for p in kw['panels']]))
plot.render_panels = capture
sys.argv = ['plot_rounds', '--evidence', sys.argv[2], '--round', 'confirmation']
plot.main()
print(json.dumps(captured))
'''
        result = subprocess.run([sys.executable, '-c', code, str(HERE), str(self.evidence)],
                                capture_output=True, text=True, check=True)
        captures = json.loads(result.stdout)
        self.assertEqual(len(captures), 1)
        return captures[0]

    def test_four_five_and_six_configurations_use_only_confirmation_values(self) -> None:
        selections = (MINIMUM, (*MINIMUM, OPTIONAL[0]), (*MINIMUM, OPTIONAL[1]),
                      (*MINIMUM, *OPTIONAL))
        for ids in selections:
            with self.subTest(ids=ids):
                confirmation = self.subset(ids)
                self.publish_fixture(confirmation)
                result = self.validate()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(f'{len(ids)} independent confirmations', result.stdout)
                spec = self.rendered_spec()
                shown = {value['config']: value['center']
                         for panel in spec['panels'] for value in panel['values']}
                expected = {row['config_id']: float(row['median_ms'])
                            for row in confirmation['results']}
                self.assertEqual(shown, expected)
                tiles = [cid.rsplit('k', 1)[1] for cid in ids if cid.startswith('triton-online-')]
                self.assertIn(f'{len(tiles)} 种在线配置', spec['panels'][1]['title'])
                self.assertIn('本次确认的在线 key tile：' + ' / '.join(tiles) + '。', spec['notes'])

    def test_confirmation_must_keep_the_minimum_group(self) -> None:
        for missing in MINIMUM:
            with self.subTest(missing=missing):
                fixture = self.subset(tuple(cid for cid in MINIMUM if cid != missing))
                self.assert_rejected(fixture, 'Attention confirmation must retain')

    def test_missing_planned_configuration_is_not_an_optional_subset(self) -> None:
        fixture = self.subset((*MINIMUM, OPTIONAL[0]))
        fixture['results'] = [row for row in fixture['results'] if row['config_id'] != OPTIONAL[0]]
        self.assert_rejected(fixture, 'Missing, extra or duplicate configuration/shape rows')

    def test_missing_or_duplicate_process_is_rejected(self) -> None:
        for duplicate in (False, True):
            with self.subTest(duplicate=duplicate):
                fixture = self.subset(MINIMUM)
                if duplicate:
                    fixture['process_results'].append(copy.deepcopy(fixture['process_results'][0]))
                else:
                    fixture['process_results'].pop()
                self.assert_rejected(fixture, 'Incomplete or duplicate process matrix')

    def test_missing_sample_is_rejected(self) -> None:
        fixture = self.subset(MINIMUM)
        fixture['process_results'][0]['sample_count'] = fixture['benchmark']['repeat'] - 1
        self.assert_rejected(fixture, 'process protocol differs')

    def test_source_and_binary_identity_must_match_parent(self) -> None:
        for binary in (False, True):
            with self.subTest(binary=binary):
                fixture = self.subset(MINIMUM)
                if binary:
                    fixture['build']['binary_sha256'] = '0' * 64
                else:
                    fixture['source_sha256']['attention_hip.hip'] = '0' * 64
                self.assert_rejected(fixture, 'Confirmation must use the same frozen kernels')

    def test_scope_and_configuration_changes_are_rejected(self) -> None:
        fixture = self.subset(MINIMUM)
        fixture['benchmark']['scope'] = 'kernel-trace'
        self.assert_rejected(fixture, 'Confirmation protocol changed: scope')
        fixture = self.subset(MINIMUM)
        for config in fixture['configurations']:
            if config['id'] == 'triton-online-k16':
                config['block_k'] = 32
        self.assert_rejected(fixture, 'Confirmation configuration changed from parent experiment')

    def test_confirmation_hash_remains_mandatory(self) -> None:
        self.assert_rejected(self.subset(MINIMUM), 'file is not bound to this experiment', rebind=False)

    def test_main_scan_still_requires_all_six_configurations(self) -> None:
        removed = OPTIONAL[1]
        self.parent['configurations'] = [config for config in self.parent['configurations']
                                         if config['id'] != removed]
        selection = self.parent.get('validation_selection', {})
        if 'config_ids' in selection:
            selection['config_ids'] = [cid for cid in selection['config_ids'] if cid != removed]
        for shape, ids in self.parent.get('measurement_matrix', {}).items():
            self.parent['measurement_matrix'][shape] = [cid for cid in ids if cid != removed]
        for name in ('summary.csv', 'process-summary.csv'):
            path = self.evidence / name
            with path.open() as file:
                reader = csv.DictReader(file)
                fields = reader.fieldnames
                rows = [row for row in reader if row['config_id'] != removed]
            with path.open('w', newline='') as file:
                writer = csv.DictWriter(file, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            self.bind(name)
        result = self.validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Attention scan must preserve', result.stderr)


if __name__ == '__main__':
    unittest.main()
