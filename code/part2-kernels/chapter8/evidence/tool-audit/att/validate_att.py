"""Validate the single-dispatch ATT output expected by profile_att.sh."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import re


def validate_att(directory: Path) -> dict:
    candidates = sorted(directory.glob('stats_*.csv'))
    if len(candidates) != 1:
        raise ValueError('expected exactly one decoded stats CSV')
    stats = candidates[0]
    match = re.fullmatch(r'stats_(ui_output_agent_\d+_dispatch_8)\.csv', stats.name)
    if match is None:
        raise ValueError('expected decoded stats for dispatch 8')
    integer_fields = ('CodeObj', 'Vaddr', 'Hitcount', 'Latency', 'Stall', 'Idle')
    required = {*integer_fields, 'Instruction', 'Source'}
    with stats.open(newline='') as file:
        reader = csv.DictReader(file, strict=True)
        fields = reader.fieldnames or []
        if len(fields) != len(set(fields)) or not required <= set(fields):
            raise ValueError('stats CSV has missing or duplicate required columns')
        rows = list(reader)
    if not rows:
        raise ValueError('stats CSV contains no instruction rows')
    for row in rows:
        if None in row or any(value is None for value in row.values()):
            raise ValueError('stats CSV row width does not match its header')
        if not row['Instruction'].strip():
            raise ValueError('stats CSV contains an empty instruction')
        if any(re.fullmatch(r'[0-9]+', row[field]) is None for field in integer_fields):
            raise ValueError('stats CSV counts and addresses must be non-negative integers')
    if not any(re.search(r'\bvector_add_v0\(', row['Source']) for row in rows):
        raise ValueError('stats CSV does not identify vector_add_v0')
    if not any(int(row['Hitcount']) > 0 for row in rows):
        raise ValueError('stats CSV contains no positive instruction Hitcount')
    ui = directory / match[1]
    json_files = sorted(ui.glob('*.json'))
    if not json_files or not (ui / 'code.json').is_file():
        raise ValueError('corresponding UI directory or code.json is missing')
    for path in json_files:
        document = json.loads(path.read_text())
        if not document:
            raise ValueError(f'empty decoded JSON: {path.name}')
    code = json.loads((ui / 'code.json').read_text())
    if not isinstance(code, dict) or not code.get('code'):
        raise ValueError('code.json contains no decoded instructions')
    if not list(ui.glob('*_wv*.json')):
        raise ValueError('UI directory contains no decoded wave JSON')
    return dict(dispatch=8, kernel='vector_add_v0', instruction_rows=len(rows),
                json_files=len(json_files), stats=stats.name, ui=ui.name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    try:
        result = validate_att(args.directory)
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(1, f'ATT validation failed: {error}\n')
    print('ATT_VALIDATED ' + ' '.join(f'{key}={value}' for key, value in result.items()))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
