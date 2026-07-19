from __future__ import annotations

import shlex
from collections.abc import Mapping, Sequence

MANIFEST_FIELDS = (
    "operator",
    "generated_at",
    "git_commit",
    "source_sha256",
    "hardware",
    "software",
    "benchmark",
)

RECORD_FIELDS = (
    "operator",
    "implementation",
    "runtime",
    "shape",
    "dtype",
    "correct",
    "median_ms",
)


def parse_result_line(line: str, source: str = "") -> dict[str, str] | None:
    if not line.startswith("RESULT "):
        return None
    record = {"source": source}
    for token in shlex.split(line)[1:]:
        key, separator, value = token.partition("=")
        if separator:
            record[key] = value
    return record


def validate_manifest(manifest: Mapping[str, object]) -> list[str]:
    return [f"manifest missing field: {field}" for field in MANIFEST_FIELDS if field not in manifest]


def validate_records(records: Sequence[Mapping[str, object]]) -> list[str]:
    errors: list[str] = []
    for index, record in enumerate(records):
        errors.extend(
            f"record {index} missing field: {field}"
            for field in RECORD_FIELDS
            if field not in record
        )
        if record.get("correct") != "OK":
            errors.append(f"record {index} correctness is not OK")
    return errors
