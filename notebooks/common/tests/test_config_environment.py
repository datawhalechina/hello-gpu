"""Host settings and metadata must work without opening a GPU context."""

import importlib
import json

import pytest
import torch

from hello_gpu import settings
from hello_gpu.config import configuration


def test_config_overlay_is_explicit_and_independent_of_cwd(tmp_path, monkeypatch):
    path = tmp_path / "settings.toml"
    path.write_text("[experiment]\nn = 4097\nseed = 17\n", encoding="utf-8")
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(path))
    monkeypatch.chdir(tmp_path.parent)
    result = settings()
    assert result == {"n": 4097, "block": 256, "warmup": 5, "repeat": 30, "seed": 17}
    result["n"] = 1
    assert settings()["n"] == 4097


@pytest.mark.parametrize("content", [
    "n = 0", "block = true", "repeat = 0", "warmup = -1", "seed = -1",
    "repeat = 1.5", "n = 2147483648", "seed = 9223372036854775808", "repeats = 3",
])
def test_config_rejects_invalid_or_misspelled_settings(content, tmp_path, monkeypatch):
    path = tmp_path / "invalid.toml"
    path.write_text("[experiment]\n" + content + "\n", encoding="utf-8")
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(path))
    with pytest.raises(ValueError):
        settings()


def test_explicit_missing_config_fails_instead_of_silently_using_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(tmp_path / "missing.toml"))
    with pytest.raises(FileNotFoundError):
        settings()


def test_full_configuration_preserves_other_modules_sections(tmp_path, monkeypatch):
    path = tmp_path / "config.toml"
    path.write_text("[profiling]\ncommand = 'rocprofv3'\n[agent]\nblocks = [64, 128]\n", encoding="utf-8")
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(path))
    complete = configuration()
    assert complete["experiment"]["seed"] == 0
    assert complete["profiling"]["command"] == "rocprofv3"
    assert complete["agent"]["blocks"] == [64, 128]


def test_host_environment_does_not_probe_gpu(monkeypatch):
    module = importlib.import_module("hello_gpu.environment")
    def forbidden(*args, **kwargs):
        pytest.fail("host metadata must not probe or initialize a GPU")
    for name in ("is_available", "current_device", "get_device_properties", "current_stream", "init"):
        monkeypatch.setattr(torch.cuda, name, forbidden)
    result = module.environment(require_gpu=False)
    assert result["gpu"] is None
    assert result["gpu_probed"] is False
    assert result["cpu_threads"] == torch.get_num_threads()
    assert result["hip"] == torch.version.hip
    json.dumps(result, allow_nan=False)
