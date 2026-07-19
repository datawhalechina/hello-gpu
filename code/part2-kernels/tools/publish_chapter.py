#!/usr/bin/env python3
"""Publish validated, curated evidence for one Part 2 chapter."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PART_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PART_DIR))

from common.publication import PublicationError, publish


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Validate exactly three independent benchmark logs and atomically "
            "replace <chapter-dir>/evidence with curated publication files."
        )
    )
    parser.add_argument("--chapter-dir", required=True, type=Path)
    parser.add_argument("--operator", required=True)
    parser.add_argument("--git-commit", required=True)
    parser.add_argument(
        "--run-log",
        required=True,
        action="append",
        type=Path,
        help="one process log; pass exactly three times",
    )
    parser.add_argument("--environment-file", type=Path)
    parser.add_argument("--profile-dir", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        publish(
            chapter_dir=args.chapter_dir,
            operator=args.operator,
            git_commit=args.git_commit,
            run_logs=args.run_log,
            environment_file=args.environment_file,
            profile_dir=args.profile_dir,
        )
    except PublicationError as error:
        print(f"publication rejected: {error}", file=sys.stderr)
        return 2
    print(f"published evidence: {args.chapter_dir / 'evidence'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
