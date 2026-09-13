"""Regression checks for experiment completion and artifact reuse."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PART_ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('part3_runner', PART_ROOT / 'chapter16' / 'run_part3_test.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerEvidenceTests(unittest.TestCase):
    def test_completion_requires_valid_status_and_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp)
            self.assertEqual(runner._agent_exit_code(workspace), 1)
            for state, ready, expected in [
                ('incomplete', True, 1), ('complete', False, 1),
                ('unknown', True, 1), ('complete', True, 0),
                ('complete_with_warning', True, 0),
            ]:
                (workspace / 'agent-status.json').write_text(json.dumps({'state': state, 'evidenceReady': ready}))
                self.assertEqual(runner._agent_exit_code(workspace), expected)

    def test_reuse_does_not_require_gpu_or_llm_configuration(self):
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(runner, '_check_llm_env', side_effect=AssertionError('LLM must not be used')), \
             patch.object(runner, '_check_gpu', side_effect=AssertionError('GPU must not be used')), \
             patch.object(runner, '_visualize', return_value=[]), \
             patch.object(runner, '_write_summary') as write_summary, patch.object(runner.os, 'chdir'):
            self.assertEqual(runner.main(['--skip-agent', '--workspace', temp]), 0)
            write_summary.assert_not_called()

    def test_failed_pytest_propagates_to_exit_status(self):
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(runner, '_check_llm_env'), patch.object(runner, '_check_gpu'), \
             patch.object(runner, '_run_pytest', return_value=1), \
             patch.object(runner, '_run_agent', return_value=(0, 'complete')), \
             patch.object(runner, '_visualize', return_value=[]), \
             patch.object(runner, '_write_summary'), patch.object(runner.os, 'chdir'):
            self.assertEqual(runner.main(['--workspace', temp]), 1)


if __name__ == '__main__':
    unittest.main()
