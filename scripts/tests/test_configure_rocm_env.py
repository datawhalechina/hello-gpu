"""Regression checks for first install and migration of existing uv projects."""

import importlib.util
from pathlib import Path
import tomllib
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "configure-rocm-env.py"
spec = importlib.util.spec_from_file_location("configure_rocm_env", SCRIPT)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class ConfigureTest(unittest.TestCase):
    def test_first_install_and_repeat(self):
        text = '[project]\nname = "example"\nversion = "0.1.0"\ndependencies = []\n'
        result = config.configure(text, "gfx1201", mirror="https://pypi.org/simple")
        self.assertEqual(result, config.configure(result, "gfx1201", mirror="https://pypi.org/simple"))
        project = tomllib.loads(result)
        self.assertEqual(project["project"]["requires-python"], ">=3.12,<3.13")
        self.assertIn("rocm[devel,device-gfx1201]==10.0.0", project["project"]["dependencies"])
        self.assertNotIn("explicit", project["tool"]["uv"]["index"][0])

    def test_existing_project_keeps_other_dependencies_and_settings(self):
        text = '''[project]
name = "agent"
version = "0.1.0"
dependencies = [
    "litellm>=1.50",
    "torch==2.11.0+rocm7.13.0",
    "rocm-sdk-libraries-gfx120x-all==7.13.0",
    "triton==3.6.0+rocm7.13.0",
]
[tool.pytest.ini_options]
testpaths = ["tests"]
[dependency-groups]
dev = ["pytest>=8"]
[[tool.uv.index]]
name = "rocm-amd"
url = "https://repo.amd.com/rocm/whl/gfx120X-all/"
explicit = true
[[tool.uv.index]]
name = "pypi-mirror"
url = "https://pypi.org/simple"
default = true
[tool.uv.sources]
rocm-sdk-libraries-gfx120x-all = { index = "rocm-amd" }
custom = { path = "../custom", editable = true }
'''
        result = config.configure(text, "gfx1151")
        project = tomllib.loads(result)
        self.assertIn("litellm>=1.50", project["project"]["dependencies"])
        self.assertIn("torch[device-gfx1151]==2.13.0+rocm10.0.0", project["project"]["dependencies"])
        self.assertEqual(project["dependency-groups"]["dev"], ["pytest>=8"])
        self.assertEqual(project["tool"]["pytest"]["ini_options"]["testpaths"], ["tests"])
        self.assertEqual(project["tool"]["uv"]["sources"]["custom"], {"path": "../custom", "editable": True})
        self.assertEqual(project["tool"]["uv"]["index"][1]["url"], "https://pypi.org/simple")
        self.assertNotIn("7.13", result)
        self.assertNotIn("gfx120x", result)
        self.assertEqual(result, config.configure(result, "gfx1151"))

    def test_architecture_switch_has_no_leftover_device_packages(self):
        text = '[project]\nname = "example"\ndependencies = []\n'
        result = config.configure(config.configure(text, "gfx1201"), "gfx942")
        self.assertNotIn("gfx1201", result)
        self.assertEqual(result.count("device-gfx942"), 3)
        with self.assertRaises(ValueError):
            config.configure(text, "gfx120X-all")


if __name__ == "__main__":
    unittest.main()
