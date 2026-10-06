"""Freeze and run the controlled Chapter 9 reduction rounds, one process at a time.

The default main phase runs boundary checks and three-process benchmarks;
profiling and additional validation are explicit, optional phases.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

from summarize_rounds import summarize
from rounds_identity import check_frozen_identity

SOURCE = Path(__file__).resolve().parent
CONFIGS = [
    {"id": "hip-element-atomic", "runtime": "hip", "version": "element-atomic", "block": 256, "first_kernel": "reduction_element_atomic"},
    {"id": "hip-block-atomic", "runtime": "hip", "version": "block-atomic", "block": 256, "first_kernel": "reduction_block_atomic"},
    {"id": "hip-partials", "runtime": "hip", "version": "partials", "block": 256, "first_kernel": "reduction_partials", "final_kernel": "reduction_final"},
    *({"id": f"hip-local-lds-g{grid}", "runtime": "hip", "version": "local-lds", "block": 256, "grid": grid,
       "first_kernel": "reduction_local_lds", "final_kernel": "reduction_final"} for grid in (65536, 1024, 256)),
    {"id": "hip-local-wave-g256", "runtime": "hip", "version": "local-wave", "block": 256, "grid": 256,
     "first_kernel": "reduction_local_wave", "final_kernel": "reduction_final"},
    *({"id": f"triton-p{programs}", "runtime": "triton", "block": 1024, "programs": programs,
       "first_kernel": "round_partial_kernel", "final_kernel": "round_final_kernel"} for programs in (1024, 512, 256, 128)),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(root: Path, manifest: dict) -> None:
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def run(cmd: list[str], log: Path, root: Path, env: dict | None = None) -> None:
    print(f"running {log.stem}", flush=True)
    with (root / "commands.jsonl").open("a") as file:
        file.write(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "argv": cmd,
                               "log": str(log.relative_to(root))}) + "\n")
    with log.open("w") as file:
        subprocess.run(cmd, cwd=root / "build", stdout=file, stderr=subprocess.STDOUT, check=True, env=env)


def command(c: dict, root: Path, size: int, warmup: int, repeat: int, seed: int, kind: str = "random") -> list[str]:
    if c["runtime"] == "hip":
        cmd = [str(root / "build/reduction_rounds"), "--version", c["version"]]
        if "grid" in c:
            cmd += ["--grid", str(c["grid"])]
    else:
        cmd = [sys.executable, str(root / "source/reduction_rounds_triton.py"), "--programs", str(c["programs"])]
    return cmd + ["--size", str(size), "--block", str(c["block"]), "--warmup", str(warmup),
                  "--repeat", str(repeat), "--seed", str(seed), "--input", kind, "--config-id", c["id"]]


def benchmark(configs: list[dict], root: Path, m: dict, size: int) -> None:
    b = m["benchmark"]
    for process in (1, 2, 3):
        shift = (process - 1) * max(1, len(configs) // 3)
        order = configs[shift:] + configs[:shift]
        m["execution_order"].append({"shape": size, "process": process, "configs": [c["id"] for c in order]})
        save(root, m)
        for c in order:
            stem = f"n{size}-{c['id']}-p{process}"
            sample = root / "samples" / f"{stem}.csv"
            if sample.exists():
                raise FileExistsError(sample)
            cmd = command(c, root, size, b["warmup"], b["repeat"], b["seed"])
            cmd += ["--samples", str(sample), "--process", str(process)]
            run(cmd, root / "logs" / f"{stem}.log", root)


def initialize(root: Path, args: argparse.Namespace) -> dict:
    if root.exists():
        raise FileExistsError("choose a fresh output directory")
    for folder in ("source", "build", "samples", "logs", "profiles"):
        (root / folder).mkdir(parents=True, exist_ok=True)
    files = {name: SOURCE / name for name in ("reduction_rounds.hip", "reduction_rounds_triton.py", "run_rounds.py", "summarize_rounds.py", "rounds_identity.py")}
    files.update({name: SOURCE.parent / "chapter8" / name for name in ("collect_environment.sh", "resolve_rocprofv3.py")})
    for name, source in files.items():
        shutil.copy2(source, root / "source" / name)
    import torch
    if version("rocm") != "10.0.0" or not torch.cuda.is_available() or torch.cuda.get_device_properties(0).gcnArchName.split(":")[0] != "gfx1201":
        raise RuntimeError("requires ROCm SDK10 and gfx1201")
    m = {"schema_version": 1, "experiment": "chapter9-controlled-reduction-rounds",
         "started_at": datetime.now(timezone.utc).isoformat(),
         "hardware": torch.cuda.get_device_name(0),
         "software": {"rocm": version("rocm"), "hip": torch.version.hip, "torch": torch.__version__, "triton": version("triton")},
         "platform": {"os_pretty_name": platform.freedesktop_os_release().get("PRETTY_NAME"), "kernel": platform.release(), "execution": "native"},
         "environment": {"gpu": torch.cuda.get_device_name(0), "rocm_sdk": version("rocm"), "hip": torch.version.hip,
                         "gpu_exclusive": False, "profiler_during_benchmark": False, "background_note": "Desktop and existing contexts retained; see GPU state logs."},
         "source_sha256": {name: sha(root / "source" / name) for name in files},
         "benchmark": {"shape": 16777216, "size": 16777216, "dtype": "float32", "input": "random", "seed": args.seed,
                       "warmup": 10, "repeat": 50, "processes": 3, "independent_runs": 3, "scope": "gpu-event-full-operator",
                       "atomic_scope": "required output clear and atomic kernel", "staged_scope": "first stage and fixed final kernel",
                       "cache": "reuse arrays within process; no cache flush", "order": "rotate configurations across process passes",
                       "correctness": "exact comparison against FP64; staged versions check every partial and final; atomic versions final only; precheck and postcheck, not per sample"},
         "configurations": CONFIGS, "execution_order": []}
    save(root, m)
    run(["bash", str(root / "source/collect_environment.sh")], root / "logs/environment.log", root)
    if shutil.which("amd-smi"):
        for sub in ("metric", "process"):
            run(["amd-smi", sub], root / "logs" / f"gpu-{sub}-before.log", root)
    compile_cmd = ["hipcc", "--offload-arch=gfx1201", "-O3", "-std=c++17", "-save-temps", "../source/reduction_rounds.hip", "-o", "reduction_rounds"]
    run(compile_cmd, root / "logs/compile.log", root)
    m["build"] = {"command": compile_cmd, "binary_sha256": sha(root / "build/reduction_rounds")}
    # A pilot prevents the introductory element-atomic version from dominating the run.
    pilot = root / "logs/element-atomic-pilot.log"
    run(command(CONFIGS[0], root, 1048576, 1, 3, args.seed), pilot, root)
    result = next(line for line in pilot.read_text().splitlines() if line.startswith("RESULT "))
    fields = dict(token.split("=", 1) for token in result.split()[1:])
    predicted_ms = float(fields["median_ms"]) * 16
    m["element_atomic_pilot"] = {"shape": 1048576, "repeat": 3, "median_ms": float(fields["median_ms"]),
                                 "linear_estimate_main_ms": predicted_ms, "main_time_budget_per_sample_ms": 100,
                                 "included_in_main": predicted_ms <= 100}
    if predicted_ms > 100:
        m["configurations"] = [c for c in CONFIGS if c["id"] != "hip-element-atomic"]
    save(root, m)
    # At these small shapes all Triton caps resolve to <=2 programs, so one cap suffices.
    representatives = [c for c in m["configurations"] if c["id"] in ("hip-element-atomic", "hip-block-atomic", "hip-partials", "hip-local-lds-g256", "hip-local-wave-g256", "triton-p128")]
    m["small_edge_configs"] = [c["id"] for c in representatives]
    save(root, m)
    for size in (1, 33, 257, 1023, 1024, 1025):
        for kind in ("random", "weighted", "ones"):
            for c in representatives:
                run(command(c, root, size, 0, 1, args.seed, kind), root / "logs" / f"edge-n{size}-{kind}-{c['id']}.log", root)
    return m


def profile(root: Path, m: dict) -> None:
    selection = json.loads(subprocess.check_output([sys.executable, str(root / "source/resolve_rocprofv3.py")], text=True))
    if not selection["available"]:
        raise RuntimeError(selection["reason"])
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = os.pathsep.join(selection["library_dirs"] + [env.get("LD_LIBRARY_PATH", "")])
    m["profile"] = {"warmup": 5, "repeat": 10, "precheck_dispatches": 1, "tool_kind": selection["kind"], "sdk": selection["rocprof_rocm"]}
    save(root, m)
    for c in m["configurations"]:
        cmd = [selection["executable"], "--rocm-root", selection["root"], "--kernel-trace", "--output-directory", str(root / "profiles"),
               "--output-file", c["id"], "--output-format", "csv", "--"]
        cmd += command(c, root, 16777216, 5, 10, m["benchmark"]["seed"])
        run(cmd, root / "logs" / f"profile-{c['id']}.log", root, env)


def validation(root: Path, m: dict) -> None:
    rows = summarize(root, root / "summary")
    triton_main = [r for r in rows if r["runtime"] == "triton" and int(r["shape"]) == 16777216]
    best = min(triton_main, key=lambda r: r["median_ms"])["config_id"]
    ids = {"hip-block-atomic", "hip-partials", "hip-local-lds-g256", "hip-local-wave-g256", "triton-p1024", best}
    selected = [c for c in m["configurations"] if c["id"] in ids]
    m["validation_selection"] = {"shape": 1048576, "config_ids": [c["id"] for c in selected],
                                "rule": "HIP block-atomic/partials/LDS256/wave256, Triton p1024 and fastest measured main cap"}
    save(root, m)
    benchmark(selected, root, m, 1048576)
    for kind in ("random", "weighted", "ones"):
        for c in m["configurations"]:
            run(command(c, root, 1048579, 0, 1, m["benchmark"]["seed"], kind), root / "logs" / f"tail-n1048579-{kind}-{c['id']}.log", root)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phase", choices=("main", "profile", "validation", "all"), default="main",
                        help="main (default): boundary checks and three-process benchmarks; "
                             "profile: trace an existing run on demand; "
                             "validation: validate additional shapes in an existing run on demand; "
                             "all: run main, profile and validation")
    parser.add_argument("--seed", type=int, default=20260920)
    args = parser.parse_args()
    root = args.output.resolve()
    with open("/tmp/hello-gpu-experiment.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.phase in ("main", "all"):
            m = initialize(root, args)
            benchmark(m["configurations"], root, m, 16777216)
        else:
            m = json.loads((root / "manifest.json").read_text())
            m.setdefault("phase_identity_checks", []).append({"phase": args.phase, **check_frozen_identity(root, m)})
            save(root, m)
        if args.phase in ("profile", "all"):
            profile(root, m)
        if args.phase in ("validation", "all"):
            validation(root, m)
        m["updated_at"] = datetime.now(timezone.utc).isoformat()
        save(root, m)
        summarize(root, root / "summary")


if __name__ == "__main__":
    main()
