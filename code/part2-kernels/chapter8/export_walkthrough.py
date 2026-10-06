"""Publish Chapter 8's measured walkthrough outputs and figures from a raw run.

This is an offline exporter. It never executes kernels or reconstructs missing
measurements. The original stdout, stderr, trace rows and sample values remain
unchanged, except for explicitly requested private path-prefix substitutions.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile

from inspect_trace import analyze_trace, print_report
from summarize_rounds import digest, summarize


HERE = Path(__file__).resolve().parent
DEFAULT_OUTPUT = HERE / "evidence/walkthrough"
DEFAULT_IMAGES = HERE.parents[2] / "docs/part2-kernels/chapter8/images"


def normalize_paths(data: bytes, prefixes: list[tuple[str, str]]) -> bytes:
    """Only replace declared literal prefixes; retain all other log content."""
    text = data.decode("utf-8")
    for old, new in sorted(prefixes, key=lambda pair: len(pair[0]), reverse=True):
        if not old.startswith("/") or not old.rstrip("/") or not new or old == new:
            raise ValueError("path prefixes require an absolute original and a distinct replacement")
        text = text.replace(old.rstrip("/"), new.rstrip("/"))
    if "/home/" in text or "/Users/" in text:
        raise ValueError("unmapped private path; supply an explicit --path-prefix OLD=NEW")
    return text.encode("utf-8")


def identical(first: Path, second: Path) -> None:
    if first.read_bytes() != second.read_bytes():
        raise ValueError(f"raw compatibility file differs: {first.name} / {second.name}")


def inspect_output(trace: Path, kernel: str, skip: int, take: int) -> bytes:
    report = analyze_trace(trace, kernel, skip, take)
    output = io.StringIO()
    with redirect_stdout(output):
        print_report(report)
    return output.getvalue().encode("utf-8")


def archive_outputs(root: Path, stage: Path, manifest: dict,
                    prefixes: list[tuple[str, str]]) -> dict:
    """Verify the captured inspector output and preserve both process streams."""
    records = {}

    def archive(source: Path, relative: str, *, paths: bool = True) -> None:
        raw = source.read_bytes()
        data = normalize_paths(raw, prefixes) if paths else raw
        target = stage / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        records[relative] = {
            "raw_file": str(source.relative_to(root)),
            "raw_sha256": hashlib.sha256(raw).hexdigest(),
            "published_sha256": hashlib.sha256(data).hexdigest(),
            "path_prefixes_replaced": raw != data,
        }

    shape = manifest["benchmark"]["shape"]
    profile = manifest["profile"]
    skip = profile["precheck_dispatches"] + profile["warmup"]
    take = profile["repeat"]
    if (profile["precheck_dispatches"], profile["warmup"], take) != (1, 5, 10):
        raise ValueError("walkthrough requires one precheck, five warmups and ten traced repetitions")
    for config in manifest["configurations"]:
        name = config["id"]
        source = root / "configs" / name
        for process in (1, 2, 3):
            stem = f"n{shape}-{name}-p{process}"
            identical(source / f"benchmark-p{process}.stdout.log", root / "logs" / f"{stem}.log")
            identical(source / f"benchmark-p{process}.samples.csv", root / "samples" / f"{stem}.csv")
        identical(source / "profile.stdout.log", root / "logs" / f"profile-{name}.log")
        trace = source / "profile" / f"{name}_kernel_trace.csv"
        identical(trace, root / "profiles" / trace.name)
        kernel = "vector_add_kernel" if config["runtime"] == "triton" else "vector_add_" + config["version"].replace("-", "_")
        expected = inspect_output(trace, kernel, skip, take)
        if (source / "inspect.stdout.log").read_bytes() != expected:
            raise ValueError(f"{name}: captured inspector output differs from recomputed trace report")
        if (source / "inspect.stderr.log").read_bytes():
            raise ValueError(f"{name}: inspector wrote to stderr")
        for filename in ("benchmark-p1.stdout.log", "benchmark-p1.stderr.log",
                         "profile.stdout.log", "profile.stderr.log",
                         "inspect.stdout.log", "inspect.stderr.log"):
            archive(source / filename, f"configs/{name}/{filename}")
        archive(trace, f"configs/{name}/profile/{trace.name}", paths=False)
        for suffix in ("kernel_stats", "hip_api_stats", "domain_stats"):
            stats = source / "profile" / f"{name}_{suffix}.csv"
            if stats.exists():
                archive(stats, f"configs/{name}/profile/{stats.name}", paths=False)
        for failed in sorted(source.glob("failed-*/*.log")):
            archive(failed, str(failed.relative_to(root)))

    for name in manifest["source_sha256"]:
        # These bytes must remain identical to the source used for measurement.
        archive(root / "source" / name, f"source/{name}", paths=False)
    if "profile_driver" in manifest:
        driver = manifest["profile_driver"]
        source = root / driver["source"]
        if digest(source) != driver["sha256"]:
            raise ValueError("profile driver source hash changed")
        archive(source, driver["source"], paths=False)
    commands = root / "commands.jsonl"
    rows = [json.loads(line) for line in commands.read_text().splitlines() if line.strip()]
    required = {"compile", "hipcc-version", "rocprofv3-version"}
    for config in manifest["configurations"]:
        name = config["id"]
        required.update({f"benchmark-{name}-p{process}" for process in (1, 2, 3)})
        required.update({f"profile-{name}", f"inspect-{name}"})
    for name in required:
        matches = [row for row in rows if row.get("name") == name]
        if len(matches) != 1 or matches[0].get("returncode") != 0:
            raise ValueError(f"expected exactly one successful captured command: {name}")
    archive(commands, "commands.jsonl")
    return records


def render_figures(stage: Path, image_stage: Path) -> None:
    # Reuse the reviewed controls, colours, process ranges and axis definitions.
    # Render in isolation because the shared function names outputs round-*.
    from plot_rounds import ROUNDS, read_rows, render_round, select_rows

    manifest = json.loads((stage / "manifest.json").read_text())
    shape = int(manifest["benchmark"]["shape"])
    rows = select_rows(read_rows(stage / "summary.csv", manifest), manifest, shape, ROUNDS)
    for spec in ROUNDS:
        render_round(spec, rows, manifest, shape, image_stage, ["png", "svg"])
        for extension in ("png", "svg"):
            (image_stage / f"round-{spec.name}.{extension}").rename(
                image_stage / f"walkthrough-{spec.name}.{extension}")


def export(root: Path, output: Path, images: Path | None,
           prefixes: list[tuple[str, str]]) -> dict:
    root = root.resolve()
    if output.exists():
        raise FileExistsError(f"choose a new publication directory: {output}")
    raw_manifest = json.loads((root / "manifest.json").read_text())
    if not raw_manifest.get("completed_at") or not raw_manifest.get("raw_sha256"):
        raise ValueError("capture is incomplete: require completed_at and raw_sha256")
    for relative, expected in raw_manifest["raw_sha256"].items():
        if digest(root / relative) != expected:
            raise ValueError(f"captured raw file hash changed: {relative}")
    for name in ("vector_add_hip.hip", "vector_add_triton.py", "inspect_trace.py"):
        if digest(HERE / name) != raw_manifest["source_sha256"].get(name):
            raise ValueError(f"current teaching source differs from the measured snapshot: {name}")
    with tempfile.TemporaryDirectory(prefix="ch8-walkthrough-") as temporary:
        stage = Path(temporary) / "evidence"
        # This checks frozen source/binary identity, complete sample matrix,
        # runtime ENV, all sample metadata and correctness, then recomputes medians.
        summarize(root, stage)
        manifest = json.loads((stage / "manifest.json").read_text())
        benchmark = manifest["benchmark"]
        if (benchmark["processes"], benchmark["warmup"], benchmark["repeat"]) != (3, 10, 50):
            raise ValueError("walkthrough requires three processes, ten warmups and fifty samples")
        archive = archive_outputs(root, stage, manifest, prefixes)
        manifest["walkthrough_export"] = {
            "raw_manifest_sha256": digest(root / "manifest.json"),
            "exporter_sha256": digest(Path(__file__)),
            "captured_outputs": archive,
            "path_normalization": [
                {"original_prefix_sha256": hashlib.sha256(old.encode()).hexdigest(),
                 "replacement": new} for old, new in prefixes
            ],
            "measurement_values_changed": False,
            "profile_event_results_in_benchmark": False,
        }
        readme = """# Chapter 8 walkthrough evidence

This publication contains a new measured run. `summary.csv` uses benchmark
samples only: 50 event samples per process, then the median of three process
medians and their min/max range. It does not pool processes or use event values
printed while profiling. `profile-summary.csv` has a separate kernel-trace scope.

`configs/<id>/benchmark-p1.stdout.log` is one process's stdout, so its median need
not equal the three-process summary. `profile.stdout.log` and `profile.stderr.log` preserve
the two captured profiler streams separately, including warnings. An empty
stderr file means that the captured stream was empty, not that it was omitted.
`inspect.stdout.log` is the inspector output captured on the experiment host and
checked again against the complete CSV in each config's `profile/` before publication.
If collection needed a retry, `failed-*` retains the failed attempt's captured
streams; the standard `profile.*.log` and selected trace refer to the successful
attempt. Recorded failures are never used as benchmark or trace measurements.
Small profiler statistics CSVs are included when emitted. Full HIP API traces
and Perfetto files remain in the local raw run; their hashes remain in the raw
manifest records. The recorded profiler commands can regenerate those files.

Only explicitly supplied private path prefixes are normalized in terminal and
command files. No lines, timings, timestamps or resource values are removed or
rewritten. `manifest.json` records both original and published file hashes and
the replacement labels (the private originals themselves are represented by
hashes). Frozen source bytes and trace CSVs are preserved without normalization.

The VitePress page can import these tracked files directly. It does not require
the ignored local `results/` directory to build. This exporter does not run GPU
experiments; reproducing the measurements still requires the documented host.
"""
        (stage / "README.md").write_text(readme)
        manifest["artifacts_sha256"] = {
            str(path.relative_to(stage)): digest(path)
            for path in sorted(stage.rglob("*")) if path.is_file() and path.name != "manifest.json"
        }
        (stage / "manifest.json").write_bytes(normalize_paths(
            (json.dumps(manifest, indent=2) + "\n").encode(), prefixes))
        # Validate the published identity and controls even when skipping figures.
        from plot_rounds import ROUNDS, read_rows, select_rows
        published = json.loads((stage / "manifest.json").read_text())
        select_rows(read_rows(stage / "summary.csv", published), published,
                    int(published["benchmark"]["shape"]), ROUNDS)
        image_stage = Path(temporary) / "images"
        if images is not None:
            render_figures(stage, image_stage)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stage, output)
        if images is not None:
            images.mkdir(parents=True, exist_ok=True)
            for path in image_stage.iterdir():
                shutil.copy2(path, images / path.name)
        return published


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--images", type=Path, default=DEFAULT_IMAGES)
    parser.add_argument("--no-plots", action="store_true")
    parser.add_argument("--path-prefix", action="append", default=[], metavar="OLD=NEW",
                        help="literal private absolute prefix and its public replacement; repeatable")
    args = parser.parse_args()
    try:
        prefixes = []
        for value in args.path_prefix:
            if "=" not in value:
                raise ValueError("--path-prefix requires OLD=NEW")
            prefixes.append(tuple(value.split("=", 1)))
        result = export(args.run_dir, args.out, None if args.no_plots else args.images, prefixes)
    except (ValueError, OSError, KeyError) as error:
        parser.error(str(error))
    print(f"Published {len(result['configurations'])} configurations -> {args.out}")


if __name__ == "__main__":
    main()
