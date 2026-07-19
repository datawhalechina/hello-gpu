from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from chapter7 import plot_vector_add_ch7 as plot
from chapter7.plot_vector_add_ch7 import (
    format_experiment_note,
    format_experiment_subtitle,
    validate_summary_metadata,
)


class Chapter7PlotMetadataTest(unittest.TestCase):
    IMPLEMENTATIONS = (
        "hip-v0",
        "hip-v1-contiguous",
        "hip-v1-strided",
        "hip-v2",
        "hip-v3",
        "triton-t0",
        "triton-t1",
    )

    def _valid_rows(self) -> list[tuple[str, str, str]]:
        return [
            (implementation, "1024", "5")
            for implementation in self.IMPLEMENTATIONS
        ]

    def _run_plot_cli(
        self, rows: list[tuple[str, str, str]]
    ) -> tuple[subprocess.CompletedProcess[str], bool]:
        script = Path(__file__).parents[1] / "chapter7" / "plot_vector_add_ch7.py"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            summary = root / "summary.csv"
            summary.write_text(
                "implementation,shape,run_count\n"
                + "".join(
                    f"{implementation},{shape},{run_count}\n"
                    for implementation, shape, run_count in rows
                ),
                encoding="utf-8",
            )
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "hardware": "AMD Radeon RX 9070 XT",
                        "software": {"rocm": "7.13"},
                        "benchmark": {"size": "1024", "independent_runs": "5"},
                    }
                ),
                encoding="utf-8",
            )
            output = root / "plot.png"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--summary",
                    str(summary),
                    "--manifest",
                    str(manifest),
                    "--out",
                    str(output),
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            return completed, output.exists()

    def test_plot_cli_rejects_duplicate_implementation(self) -> None:
        rows = self._valid_rows()
        rows.append(("hip-v0", "1024", "5"))

        completed, output_exists = self._run_plot_cli(rows)

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("duplicate implementations: hip-v0", completed.stderr)
        self.assertNotIn("matplotlib", completed.stderr)
        self.assertFalse(output_exists)

    def test_plot_cli_rejects_unexpected_implementation(self) -> None:
        rows = self._valid_rows()
        rows.append(("unexpected", "1024", "5"))

        completed, output_exists = self._run_plot_cli(rows)

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("unexpected implementations: unexpected", completed.stderr)
        self.assertNotIn("matplotlib", completed.stderr)
        self.assertFalse(output_exists)

    def test_plot_cli_rejects_metadata_mismatch_in_extra_row(self) -> None:
        rows = self._valid_rows()
        rows.append(("unexpected", "2048", "5"))

        completed, output_exists = self._run_plot_cli(rows)

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("summary shapes", completed.stderr)
        self.assertNotIn("matplotlib", completed.stderr)
        self.assertFalse(output_exists)

    def test_plot_cli_rejects_missing_implementation_explicitly(self) -> None:
        rows = [
            (implementation, "1024", "5")
            for implementation in self.IMPLEMENTATIONS
            if implementation != "triton-t1"
        ]

        completed, output_exists = self._run_plot_cli(rows)

        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("missing implementations: triton-t1", completed.stderr)
        self.assertNotIn("matplotlib", completed.stderr)
        self.assertFalse(output_exists)

    def test_plot_cli_rejects_metadata_mismatch_before_plotting(self) -> None:
        script = Path(__file__).parents[1] / "chapter7" / "plot_vector_add_ch7.py"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            summary = root / "summary.csv"
            summary.write_text(
                "implementation,shape,run_count\n"
                + "".join(f"{name},2048,5\n" for name in self.IMPLEMENTATIONS),
                encoding="utf-8",
            )
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "hardware": "AMD Radeon RX 9070 XT",
                        "software": {"rocm": "7.13"},
                        "benchmark": {"size": "1024", "independent_runs": "5"},
                    }
                ),
                encoding="utf-8",
            )
            output = root / "plot.png"

            completed = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--summary",
                    str(summary),
                    "--manifest",
                    str(manifest),
                    "--out",
                    str(output),
                ],
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("summary shapes", completed.stderr)
            self.assertNotIn("matplotlib", completed.stderr)
            self.assertFalse(output.exists())

    def test_plot_labels_come_from_manifest(self) -> None:
        manifest = {
            "hardware": "AMD Radeon RX 9070 XT",
            "software": {"rocm": "7.13", "torch": "2.11", "triton": "3.6"},
            "benchmark": {"size": "1024", "independent_runs": "5"},
        }
        self.assertIn("N=1,024", format_experiment_subtitle(manifest))
        self.assertIn("5 个独立进程", format_experiment_note(manifest))

    def test_publication_layout_reserves_bottom_text_clearance(self) -> None:
        layout = plot.publication_layout()

        self.assertGreaterEqual(
            plot.footnote_xlabel_clearance_points(layout),
            10.0,
        )

    def test_plot_rejects_summary_shape_that_disagrees_with_manifest(self) -> None:
        manifest = {"benchmark": {"size": "1024", "independent_runs": "5"}}
        rows = [{"shape": "2048", "run_count": "5"}]

        with self.assertRaisesRegex(ValueError, "summary shapes"):
            validate_summary_metadata(rows, manifest)

    def test_plot_rejects_run_count_that_disagrees_with_manifest(self) -> None:
        manifest = {"benchmark": {"size": "1024", "independent_runs": "5"}}
        rows = [{"shape": "1024", "run_count": "3"}]

        with self.assertRaisesRegex(ValueError, "summary run counts"):
            validate_summary_metadata(rows, manifest)


class Chapter7PublicCommandContractTest(unittest.TestCase):
    def test_run_all_reports_curated_evidence_directory(self) -> None:
        script = (
            Path(__file__).parents[1] / "chapter7" / "run_all.sh"
        ).read_text(encoding="utf-8")

        self.assertNotIn('"${SCRIPT_DIR}/results"', script)
        self.assertIn("summary written to ${SCRIPT_DIR}/evidence", script)

    def test_documented_commands_use_commit_and_evidence_paths(self) -> None:
        document = (
            Path(__file__).parents[3]
            / "docs"
            / "part2-kernels"
            / "chapter7"
            / "index.md"
        ).read_text(encoding="utf-8")
        rerun_section = document.split("### 7.7.1 一键入口", 1)[1].split(
            "### 7.7.2", 1
        )[0]

        self.assertIn('export SOURCE_COMMIT="$(git rev-parse HEAD)"', rerun_section)
        self.assertIn("bash chapter7/run_all.sh", rerun_section)
        self.assertIn("bash chapter7/profile_all.sh", rerun_section)
        self.assertIn("chapter7/evidence/summary.csv", rerun_section)
        self.assertIn("chapter7/evidence/manifest.json", rerun_section)
        self.assertIn(
            "../../docs/part2-kernels/chapter7/images/"
            "vector-add-ch7-bandwidth.png",
            rerun_section,
        )
        self.assertNotIn("results/", rerun_section)

    def test_experiment_documents_remote_plot_and_single_png_transfer(self) -> None:
        experiment = (
            Path(__file__).parents[1] / "chapter7" / "EXPERIMENT.md"
        ).read_text(encoding="utf-8")
        reproduction = experiment.split("## Reproduction commands", 1)[1].split(
            "## Curated evidence files", 1
        )[0]

        self.assertIn("python3 -m unittest discover -s tests -v", reproduction)
        self.assertIn("python3 - <<'PY'", reproduction)
        self.assertNotIn("python -m unittest discover -s tests -v", reproduction)
        self.assertIn(
            "source .venv/bin/activate && python "
            "chapter7/plot_vector_add_ch7.py",
            reproduction,
        )
        self.assertIn(
            "--out chapter7/evidence/vector-add-ch7-bandwidth.png",
            reproduction,
        )
        self.assertIn("rsync -az", reproduction)
        self.assertIn(
            "hwj-frp-9070xt-2404:/home/hellogpu/hdb/hello-gpu-part2/"
            "code/part2-kernels/chapter7/evidence/"
            "vector-add-ch7-bandwidth.png",
            reproduction,
        )
        self.assertIn(
            "docs/part2-kernels/chapter7/images/"
            "vector-add-ch7-bandwidth.png",
            reproduction,
        )
        self.assertNotIn(
            "--out ../../docs/part2-kernels/chapter7/images/",
            reproduction,
        )


if __name__ == "__main__":
    unittest.main()
