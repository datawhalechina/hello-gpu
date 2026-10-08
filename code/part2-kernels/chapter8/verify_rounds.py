"""Additional tile/tail checks and an independent confirmation of frozen kernels."""

from __future__ import annotations

import argparse
import copy
import csv
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

from rounds_identity import check_frozen_identity
from summarize_rounds import summarize


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frozen-run", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    frozen, root = args.frozen_run.resolve(), args.output.resolve()
    if root.exists():
        raise FileExistsError("choose a fresh confirmation directory")
    original = json.loads((frozen / "manifest.json").read_text())
    identity = check_frozen_identity(frozen, original)
    for name in ("logs", "samples"):
        (root / name).mkdir(parents=True, exist_ok=True)
    shutil.copy2(__file__, root / "verify_rounds.py")
    identity_source = Path(__file__).with_name("rounds_identity.py")
    shutil.copy2(identity_source, root / identity_source.name)
    ids = ("hip-v0", "triton-t0-b256", "hip-v2-g65536", "hip-v3-g256")
    configs = {c["id"]: c for c in original["configurations"]}
    manifest = {"experiment": "chapter8-independent-confirmation", "started_at": datetime.now(timezone.utc).isoformat(),
                "environment": {**identity["environment"], "profiler_during_benchmark": False,
                                "gpu_exclusive": False,
                                "background_note": "See this confirmation's GPU state logs; other contexts are not terminated."},
                "environment_source": "captured-before-confirmation",
                "identity_check": identity,
                "source_reference": {"run_id": frozen.name, **identity["source_reference"]},
                "benchmark": copy.deepcopy(original["benchmark"]),
                "source_sha256": original["source_sha256"], "build": original["build"],
                "configurations": [copy.deepcopy(configs[name]) for name in ids],
                "verify_script_sha256": sha(Path(__file__)),
                "verification_sources_sha256": {"verify_rounds.py": sha(Path(__file__)),
                                                identity_source.name: sha(identity_source)},
                "execution_order": []}
    manifest["benchmark"]["correctness"] = "NaN prefill before one full precheck; one full postcheck after warmup and all timed submissions; no per-sample checks"
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    boundaries = []
    commands = []

    def execute(config: dict, size: int, stem: str, *, process: int | None = None) -> None:
        prefix = ([str(frozen / "build/vector_add_hip")] if config["runtime"] == "hip" else
                  [sys.executable, str(frozen / "source/vector_add_triton.py")])
        timing = manifest["benchmark"]
        cmd = prefix + ["--version", config["version"], "--size", str(size), "--block", str(config["block"]),
                        "--warmup", str(timing["warmup"] if process else 0),
                        "--repeat", str(timing["repeat"] if process else 1), "--seed", str(timing["seed"])]
        if "grid" in config:
            cmd += ["--grid", str(config["grid"])]
        if process:
            cmd += ["--samples", str(root / "samples" / f"{stem}.csv"), "--config-id", config["id"], "--process", str(process)]
        print(f"running {stem}", flush=True)
        log = root / "logs" / f"{stem}.log"
        with log.open("w") as file:
            subprocess.run(cmd, stdout=file, stderr=subprocess.STDOUT, check=True)
        records = [dict(token.split("=", 1) for token in shlex.split(line)[1:])
                   for line in log.read_text().splitlines() if line.startswith("RESULT ")]
        if len(records) != 1 or any(records[0].get(k) != "OK" for k in ("correct", "precheck", "postcheck")):
            raise ValueError(f"failed result: {log}")
        commands.append({"argv": cmd, "log": str(log.relative_to(root))})
        if not process:
            boundaries.append({"config_id": config["id"], "shape": size, "correct": "OK",
                               "result": records[0], "log": str(log.relative_to(root)), "log_sha256": sha(log)})

    with open("/tmp/hello-gpu-experiment.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if shutil.which("amd-smi"):
            for subcommand in ("metric", "process"):
                with (root / "logs" / f"gpu-{subcommand}-before.log").open("w") as file:
                    subprocess.run(["amd-smi", subcommand], stdout=file, stderr=subprocess.STDOUT, check=True)
        for tile in (512, 1024, 2048):
            for size in (tile - 1, tile, tile + 1):
                execute(configs[f"triton-t1-b{tile}"], size, f"boundary-tile{tile}-n{size}")
        for size in (2, 6, 1026):
            execute(configs["hip-v3-g256"], size, f"boundary-float4-n{size}")
        for process in (1, 2, 3):
            offset = process - 1
            order = ids[offset:] + ids[:offset]
            manifest["execution_order"].append({"shape": 16777216, "process": process, "configs": order})
            for config_id in order:
                execute(configs[config_id], 16777216, f"n16777216-{config_id}-p{process}", process=process)
    manifest["finished_at"] = datetime.now(timezone.utc).isoformat()
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (root / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
    summary = summarize(root, root / "summary", frozen_root=frozen)
    payload = json.loads((root / "summary/manifest.json").read_text())
    payload["boundaries"] = boundaries
    payload["boundary_counts"] = {"triton_tile_boundary_checks": 9, "float4_remainder_two_checks": 3, "total": 12}
    payload["results"] = summary
    payload["process_results"] = list(csv.DictReader((root / "summary/process-summary.csv").open()))
    payload["commands"] = [{**c, "argv": [s.replace(str(frozen), "FROZEN_RUN").replace(str(root), "CONFIRMATION_RUN").replace(sys.executable, "python") for s in c["argv"]]} for c in commands]
    payload["main_matrix_unchanged"] = True
    (root / "confirmation.json").write_text(json.dumps(payload, indent=2) + "\n")
    print("PASS: 12 targeted boundaries; 12 independent processes; 600 event samples")


if __name__ == "__main__":
    main()
