"""Run sequential, independent Vector Add configurations in an isolated output directory.

Activate the Part 2 ROCm environment before invoking this script. It never
changes the environment, reads Git, or overwrites the historical evidence.
The default main phase runs boundary checks and three-process benchmarks;
profiling and additional validation are explicit, optional phases.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

from summarize_rounds import summarize
from rounds_identity import capture_environment, check_frozen_identity

SOURCE = Path(__file__).resolve().parent
CONFIGS = [
    {"id": "hip-v0", "runtime": "hip", "version": "v0", "block": 256},
    {"id": "hip-v1-contiguous", "runtime": "hip", "version": "v1-contiguous", "block": 256},
    {"id": "hip-v1-strided", "runtime": "hip", "version": "v1-strided", "block": 256},
    *({"id": f"hip-v2-g{grid}", "runtime": "hip", "version": "v2", "block": 256, "grid": grid}
      for grid in (65536, 2048, 256)),
    {"id": "hip-v3-g256", "runtime": "hip", "version": "v3", "block": 256, "grid": 256},
    {"id": "triton-t0-b256", "runtime": "triton", "version": "t0", "block": 256},
    *({"id": f"triton-t1-b{block}", "runtime": "triton", "version": "t1", "block": block}
      for block in (512, 1024, 2048)),
]
SOURCES = ("vector_add_hip.hip", "vector_add_triton.py", "run_rounds.py",
           "summarize_rounds.py", "resolve_rocprofv3.py", "collect_environment.sh",
           "rounds_identity.py")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_manifest(root: Path, manifest: dict) -> None:
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def run(command: list[str], log: Path, root: Path, *, env: dict | None = None) -> None:
    print(f"running {log.stem}", flush=True)
    with (root / "commands.jsonl").open("a") as file:
        file.write(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "argv": command,
                               "log": str(log.relative_to(root))}) + "\n")
    with log.open("w") as file:
        subprocess.run(command, stdout=file, stderr=subprocess.STDOUT, check=True,
                       cwd=root / "build", env=env)


def command(config: dict, root: Path, size: int, warmup: int, repeat: int, seed: int) -> list[str]:
    executable = ([str(root / "build/vector_add_hip")] if config["runtime"] == "hip" else
                  [sys.executable, str(root / "source/vector_add_triton.py")])
    result = executable + ["--version", config["version"], "--size", str(size),
                           "--block", str(config["block"]), "--warmup", str(warmup),
                           "--repeat", str(repeat), "--seed", str(seed)]
    if "grid" in config:
        result += ["--grid", str(config["grid"])]
    return result


def benchmark(configs: list[dict], root: Path, manifest: dict, size: int) -> None:
    b = manifest["benchmark"]
    for process in range(1, b["processes"] + 1):
        offset = (process - 1) * max(1, len(configs) // b["processes"])
        order = configs[offset:] + configs[:offset]
        manifest["execution_order"].append({"shape": size, "process": process,
                                             "configs": [c["id"] for c in order]})
        save_manifest(root, manifest)
        for config in order:
            stem = f"n{size}-{config['id']}-p{process}"
            samples = root / "samples" / f"{stem}.csv"
            if samples.exists():
                raise FileExistsError(f"refusing to append another run: {samples}")
            cmd = command(config, root, size, b["warmup"], b["repeat"], b["seed"])
            cmd += ["--samples", str(samples), "--config-id", config["id"], "--process", str(process)]
            run(cmd, root / "logs" / f"{stem}.log", root)


def initialize(root: Path, args: argparse.Namespace) -> dict:
    if root.exists():
        raise FileExistsError(f"choose a new --output directory: {root}")
    environment = capture_environment()
    if environment["rocm_sdk"] != "10.0.0":
        raise RuntimeError("requires ROCm SDK 10.0.0 and an available GPU")
    if environment["architecture"].split(":")[0] != "gfx1201":
        raise RuntimeError("this publication run requires gfx1201")
    for part in ("logs", "samples", "profiles", "source", "build"):
        (root / part).mkdir(parents=True, exist_ok=True)
    for name in SOURCES:
        shutil.copy2(SOURCE / name, root / "source" / name)
    manifest = {
        "schema_version": 1, "experiment": "chapter8-vector-add-rounds",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "environment": {**environment,
                        "profiler_during_benchmark": False, "gpu_exclusive": False,
                        "background_note": "See gpu-state logs; desktop and other contexts are not terminated."},
        "source_sha256": {name: sha(root / "source" / name) for name in SOURCES},
        "benchmark": {"shape": args.size, "warmup": args.warmup, "repeat": args.repeat,
                      "processes": 3, "seed": args.seed, "dtype": "float32",
                      "scope": "GPU events around a single kernel submission",
                      "cache": "same arrays reused within process; no explicit flush",
                      "order": "configuration order rotated across three independent process passes",
                      "input": "a=((17*i+seed)%2048-1024)/1024; b=((29*i+3*seed)%4096-2048)/2048",
                      "correctness": "NaN-prefilled precheck and postcheck, finite output, abs error <= 1e-6"},
        "configurations": CONFIGS, "execution_order": [],
    }
    manifest["hardware"] = manifest["environment"]["gpu"]
    manifest["software"] = {"rocm": environment["rocm_sdk"], "hip": environment["hip"],
                            "torch": environment["torch"], "triton": environment["triton"]}
    manifest["platform"] = {"os_pretty_name": manifest["environment"]["os"], "execution": "native"}
    manifest["benchmark"].update(size=args.size, independent_runs=3,
                                 scope="gpu-event-single-kernel")
    save_manifest(root, manifest)
    run(["bash", str(root / "source/collect_environment.sh")], root / "logs/environment.log", root)
    if shutil.which("amd-smi"):
        run(["amd-smi", "metric"], root / "logs/gpu-state-before.log", root)
        run(["amd-smi", "process"], root / "logs/gpu-process-before.log", root)
    compile_command = ["hipcc", "--offload-arch=gfx1201", "-O3", "-std=c++17", "-save-temps",
                       "../source/vector_add_hip.hip", "-o", "vector_add_hip"]
    run(compile_command, root / "logs/compile.log", root)
    manifest["build"] = {"command": compile_command, "binary_sha256": sha(root / "build/vector_add_hip")}
    save_manifest(root, manifest)
    # Short sizes validate masks and float4 tails before any publication timing.
    for size in (1, 31, 32, 33, 255, 256, 257, 1027):
        for runtime, block in (("hip", 256), ("triton", 1024)):
            cfg = {"runtime": runtime, "version": "all", "block": block}
            run(command(cfg, root, size, 0, 1, args.seed), root / "logs" / f"edge-{size}-{runtime}.log", root)
    return manifest


def profile(root: Path, manifest: dict) -> None:
    identity = check_frozen_identity(root, manifest)
    manifest.setdefault("identity_checks", []).append({"phase": "profile", **identity})
    save_manifest(root, manifest)
    selection = json.loads(subprocess.check_output(
        [sys.executable, str(root / "source/resolve_rocprofv3.py")], text=True))
    if not selection["available"]:
        raise RuntimeError(selection["reason"])
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = os.pathsep.join(selection["library_dirs"] + [env.get("LD_LIBRARY_PATH", "")])
    manifest["profile"] = {"warmup": 5, "repeat": 10, "precheck_dispatches": 1,
                           "scope": "separate rocprofv3 kernel trace, excluded from benchmark",
                           "tool_kind": selection["kind"], "sdk": selection["rocprof_rocm"]}
    save_manifest(root, manifest)
    for config in manifest["configurations"]:
        prefix = config["id"]
        cmd = [selection["executable"], "--rocm-root", selection["root"], "--kernel-trace",
               "--output-directory", str(root / "profiles"), "--output-file", prefix,
               "--output-format", "csv", "--"]
        cmd += command(config, root, manifest["benchmark"]["shape"], 5, 10, manifest["benchmark"]["seed"])
        run(cmd, root / "logs" / f"profile-{prefix}.log", root, env=env)


def validate_selected(root: Path, manifest: dict) -> None:
    identity = check_frozen_identity(root, manifest)
    manifest.setdefault("identity_checks", []).append({"phase": "validation", **identity})
    save_manifest(root, manifest)
    rows = summarize(root, root / "summary")
    main = [r for r in rows if int(r["shape"]) == manifest["benchmark"]["shape"]]
    best_grid = min((r for r in main if r["implementation"] == "hip-v2"), key=lambda r: r["median_ms"])
    best_triton = min((r for r in main if r["runtime"] == "triton"), key=lambda r: r["median_ms"])
    ids = {"hip-v0", "hip-v3-g256", "triton-t0-b256", best_grid["config_id"], best_triton["config_id"]}
    selected = [c for c in manifest["configurations"] if c["id"] in ids]
    manifest["validation_selection"] = {"rule": "HIP v0, float4 g256, Triton t0, fastest main-shape v2 grid and Triton tile; duplicates removed",
                                         "shapes": [1048576, 4194304],
                                         "config_ids": [c["id"] for c in selected]}
    save_manifest(root, manifest)
    for size in (1048576, 4194304):
        benchmark(selected, root, manifest, size)
    for cfg in manifest["configurations"]:
        run(command(cfg, root, 16777219, 0, 1, manifest["benchmark"]["seed"]),
            root / "logs" / f"tail-16777219-{cfg['id']}.log", root)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phase", choices=("main", "profile", "validation", "all"), default="main",
                        help="main (default): boundary checks and three-process benchmarks; "
                             "profile: trace an existing run on demand; "
                             "validation: validate additional shapes in an existing run on demand; "
                             "all: run main, profile and validation")
    parser.add_argument("--size", type=int, default=16777216)
    parser.add_argument("--warmup", type=int, default=10)
    parser.add_argument("--repeat", type=int, default=50)
    parser.add_argument("--seed", type=int, default=20260920)
    args = parser.parse_args()
    if args.size <= 0 or args.warmup < 0 or args.repeat <= 0:
        parser.error("invalid size/warmup/repeat")
    root = args.output.resolve()
    # Advisory lock serializes this runner; it cannot stop desktop activity.
    with open("/tmp/hello-gpu-experiment.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.phase in ("main", "all"):
            manifest = initialize(root, args)
            benchmark(manifest["configurations"], root, manifest, args.size)
        else:
            manifest = json.loads((root / "manifest.json").read_text())
        if args.phase in ("profile", "all"):
            profile(root, manifest)
        if args.phase in ("validation", "all"):
            validate_selected(root, manifest)
        manifest["updated_at"] = datetime.now(timezone.utc).isoformat()
        save_manifest(root, manifest)
        summarize(root, root / "summary")


if __name__ == "__main__":
    main()
