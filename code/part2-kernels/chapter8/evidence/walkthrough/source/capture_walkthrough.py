"""Capture Chapter 8's direct-command walkthrough without changing its kernels."""
from pathlib import Path
from datetime import datetime, timezone
from importlib.metadata import version
import csv
import fcntl
import hashlib
import json
import os
import platform
import shlex
import shutil
import statistics
import subprocess

RUN = Path("chapter8/results/walkthrough-20260920")
CONFIGS = [
    dict(id="hip-v0", runtime="hip", version="v0", block=256),
    dict(id="hip-v1-contiguous", runtime="hip", version="v1-contiguous", block=256),
    dict(id="hip-v1-strided", runtime="hip", version="v1-strided", block=256),
    dict(id="hip-v2-g65536", runtime="hip", version="v2", block=256, grid=65536),
    dict(id="hip-v2-g2048", runtime="hip", version="v2", block=256, grid=2048),
    dict(id="hip-v2-g256", runtime="hip", version="v2", block=256, grid=256),
    dict(id="hip-v3-g256", runtime="hip", version="v3", block=256, grid=256),
    dict(id="triton-t0-b256", runtime="triton", version="t0", block=256),
    dict(id="triton-t1-b512", runtime="triton", version="t1", block=512),
    dict(id="triton-t1-b1024", runtime="triton", version="t1", block=1024),
    dict(id="triton-t1-b2048", runtime="triton", version="t1", block=2048),
]
KERNELS = {"v0": "vector_add_v0", "v1-contiguous": "vector_add_v1_contiguous",
           "v1-strided": "vector_add_v1_strided", "v2": "vector_add_v2_grid_stride",
           "v3": "vector_add_v3_float4", "t0": "vector_add_kernel", "t1": "vector_add_kernel"}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def write_manifest(data):
    data["updated_at"] = now()
    (RUN / "manifest.json").write_text(json.dumps(data, indent=2) + "\n")


def record(name, argv, prefix, timeout=120, required=True):
    prefix = Path(prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    stdout = prefix.with_name(prefix.name + ".stdout.log")
    stderr = prefix.with_name(prefix.name + ".stderr.log")
    if stdout.exists() or stderr.exists():
        raise RuntimeError(f"refusing to replace existing output: {prefix}")
    started = now()
    with stdout.open("w") as out, stderr.open("w") as err:
        result = subprocess.run(argv, stdout=out, stderr=err, text=True, timeout=timeout)
    entry = dict(name=name, started_at=started, finished_at=now(), cwd=str(Path.cwd()),
                 argv=list(map(str, argv)), command=shlex.join(list(map(str, argv))),
                 stdout=str(stdout.relative_to(RUN)), stderr=str(stderr.relative_to(RUN)),
                 returncode=result.returncode)
    with (RUN / "commands.jsonl").open("a") as output:
        output.write(json.dumps(entry) + "\n")
    print(name, "returncode=" + str(result.returncode), flush=True)
    if required and result.returncode:
        raise RuntimeError(f"command failed: {name}; see {stderr}")
    return stdout, stderr


def command(config, warmup, repeat, process):
    argv = ([str(RUN / "build/vector_add_hip")] if config["runtime"] == "hip"
            else ["python", "chapter8/vector_add_triton.py"])
    argv += ["--version", config["version"], "--size", "16777216", "--block", str(config["block"]),
             "--warmup", str(warmup), "--repeat", str(repeat), "--seed", "20260920",
             "--config-id", config["id"], "--process", str(process)]
    if "grid" in config:
        argv += ["--grid", str(config["grid"])]
    return argv


def verify_sources(manifest):
    for name, expected in manifest["source_sha256"].items():
        if digest(RUN / "source" / name) != expected:
            raise RuntimeError(f"frozen source changed: {name}")
        current = Path("chapter8") / name
        if current.exists() and digest(current) != expected:
            raise RuntimeError(f"active source differs from frozen source: {name}")
    if digest(RUN / "build/vector_add_hip") != manifest["build"]["binary_sha256"]:
        raise RuntimeError("compiled binary changed")


def verify_benchmark(path, log, config, process):
    with path.open(newline="") as file:
        rows = list(csv.DictReader(file))
    if len(rows) != 50 or [int(row["sample"]) for row in rows] != list(range(50)):
        raise RuntimeError(f"incomplete samples: {path}")
    for row in rows:
        for key, expected in dict(config_id=config["id"], process=process, shape=16777216,
                                  block=config["block"], warmup=10, repeat=50, seed=20260920).items():
            if row[key] != str(expected):
                raise RuntimeError(f"sample metadata mismatch: {path} {key}")
    results = [line for line in log.read_text().splitlines() if line.startswith("RESULT ")]
    if len(results) != 1:
        raise RuntimeError(f"missing RESULT: {log}")
    result = dict(token.split("=", 1) for token in shlex.split(results[0])[1:])
    if any(result.get(key) != "OK" for key in ("correct", "precheck", "postcheck")):
        raise RuntimeError(f"failed correctness: {log}")
    if abs(statistics.median(float(row["ms"]) for row in rows) - float(result["median_ms"])) > 0.00000051:
        raise RuntimeError(f"sample median differs from RESULT: {log}")


def main():
    if (RUN / "manifest.json").exists():
        raise RuntimeError("run already exists; use a new directory for another collection")
    for relative in ("build", "logs", "samples", "profiles", "configs"):
        (RUN / relative).mkdir(parents=True, exist_ok=True)
    for name in ("vector_add_hip.hip", "vector_add_triton.py", "inspect_trace.py"):
        shutil.copyfile(Path("chapter8") / name, RUN / "source" / name)
    import torch
    environment = dict(gpu=torch.cuda.get_device_name(0), architecture=torch.cuda.get_device_properties(0).gcnArchName,
                       rocm_sdk=version("rocm"), hip=torch.version.hip, torch=torch.__version__,
                       triton=version("triton"), os=platform.freedesktop_os_release()["PRETTY_NAME"],
                       kernel=platform.release(), python=platform.python_version(), profiler_during_benchmark=False,
                       gpu_exclusive=False, background_note="Existing desktop and unrelated contexts retained; no clock/power changes.")
    manifest = dict(schema_version=1, experiment="chapter8-vector-add-walkthrough", started_at=now(), environment=environment,
                    hardware=environment["gpu"], software=dict(rocm=environment["rocm_sdk"], hip=environment["hip"],
                    torch=environment["torch"], triton=environment["triton"]), platform=dict(os_pretty_name=environment["os"], execution="native"),
                    source_sha256={p.name: digest(p) for p in sorted((RUN / "source").glob("*")) if p.is_file()},
                    benchmark=dict(shape=16777216, size=16777216, warmup=10, repeat=50, processes=3, independent_runs=3,
                    seed=20260920, dtype="float32", scope="gpu-event-single-kernel", cache="same arrays reused; no explicit flush",
                    order="three sequential passes; rotate configuration order by 3 each pass",
                    input="a=((17*i+seed)%2048-1024)/1024; b=((29*i+3*seed)%4096-2048)/2048",
                    correctness="NaN-prefilled precheck and postcheck; finite output; abs error <= 1e-6"),
                    configurations=CONFIGS, execution_order=[],
                    profile=dict(warmup=5, repeat=10, precheck_dispatches=1, scope="separate rocprofv3 kernel and HIP API trace; excluded from benchmark",
                    tool_kind="public ROCm wheel wrapper", sdk="10.0.0", formats=["csv", "pftrace"],
                    filtering="all dispatches retained; inspect_trace selects one kernel name, sorts timestamps, skips 6 and keeps 10"))
    write_manifest(manifest)
    record("hipcc-version", ["hipcc", "--version"], RUN / "logs/hipcc-version")
    record("rocprofv3-version", ["rocprofv3", "--version"], RUN / "logs/rocprofv3-version")
    record("gpu-state-before", ["amd-smi", "metric"], RUN / "logs/gpu-state-before", required=False)
    record("gpu-process-before", ["amd-smi", "process"], RUN / "logs/gpu-process-before", required=False)
    compile_argv = ["hipcc", "--offload-arch=gfx1201", "-O3", "-std=c++17", "chapter8/vector_add_hip.hip",
                    "-o", str(RUN / "build/vector_add_hip")]
    record("compile", compile_argv, RUN / "logs/compile")
    manifest["build"] = dict(command=compile_argv, binary_sha256=digest(RUN / "build/vector_add_hip"))
    write_manifest(manifest)
    for process in range(1, 4):
        offset = 3 * (process - 1)
        order = CONFIGS[offset:] + CONFIGS[:offset]
        manifest["execution_order"].append(dict(shape=16777216, process=process, configs=[c["id"] for c in order]))
        write_manifest(manifest)
        for config in order:
            verify_sources(manifest)
            prefix = RUN / "configs" / config["id"] / f"benchmark-p{process}"
            samples = prefix.with_name(prefix.name + ".samples.csv")
            log, _ = record(f"benchmark-{config['id']}-p{process}", command(config, 10, 50, process) + ["--samples", str(samples)], prefix)
            verify_benchmark(samples, log, config, process)
            stem = f"n16777216-{config['id']}-p{process}"
            os.link(samples, RUN / "samples" / (stem + ".csv"))
            os.link(log, RUN / "logs" / (stem + ".log"))
    manifest["benchmark_completed_at"] = now()
    write_manifest(manifest)
    for config in CONFIGS:
        verify_sources(manifest)
        cfgdir = RUN / "configs" / config["id"]
        profile_dir = cfgdir / "profile"
        profile_dir.mkdir()
        argv = ["rocprofv3", "--kernel-trace", "--hip-trace", "--stats", "--output-format", "csv", "pftrace",
                "--output-directory", str(profile_dir), "--output-file", config["id"], "--", *command(config, 5, 10, 1)]
        log, _ = record("profile-" + config["id"], argv, cfgdir / "profile")
        os.link(log, RUN / "logs" / f"profile-{config['id']}.log")
        trace = profile_dir / f"{config['id']}_kernel_trace.csv"
        os.link(trace, RUN / "profiles" / trace.name)
        record("inspect-" + config["id"], ["python", "chapter8/inspect_trace.py", str(trace), "--kernel",
               KERNELS[config["version"]], "--skip", "6", "--take", "10"], cfgdir / "inspect")
    record("gpu-state-after", ["amd-smi", "metric"], RUN / "logs/gpu-state-after", required=False)
    record("gpu-process-after", ["amd-smi", "process"], RUN / "logs/gpu-process-after", required=False)
    manifest["completed_at"] = now()
    manifest["raw_sha256"] = {str(p.relative_to(RUN)): digest(p) for p in sorted(RUN.rglob("*"))
                              if p.is_file() and p.name != "manifest.json" and "__pycache__" not in p.parts}
    write_manifest(manifest)
    print("WALKTHROUGH_COMPLETE", flush=True)


if __name__ == "__main__":
    with open("/tmp/hello-gpu-experiment.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        main()
