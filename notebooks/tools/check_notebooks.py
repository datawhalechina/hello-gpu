#!/usr/bin/env python3
"""CPU-only contract: learning order, local figures, concise cells and clean source."""
from __future__ import annotations

import ast
import base64
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent


def headings(text: str):
    inside = False
    result = []
    for line in text.splitlines():
        if line.strip().startswith("```"):
            inside = not inside
        if not inside and re.match(r"^## \d+\.\d+ ", line):
            result.append(line.strip())
    return result


def main():
    reports = []
    manifest = json.loads((ROOT / "chapters.json").read_text())
    expected = {str((ROOT / entry["notebook"]).resolve()) for entry in manifest["chapters"]}
    published_parts = {Path(entry["notebook"]).parts[0] for entry in manifest["chapters"]}
    actual = {str(path.resolve()) for part in published_parts for path in (ROOT / part).glob("chapter*/*.ipynb")}
    assert expected == actual, f"Manifest mismatch: {expected ^ actual}"
    for entry in manifest["chapters"]:
        path = ROOT / entry["notebook"]
        doc = REPO / entry["doc"]
        notebook = json.loads(path.read_text())
        cells = notebook["cells"]
        metadata = notebook["metadata"]["hello_gpu"]
        assert notebook["metadata"]["kernelspec"]["name"] == "python3", f"Use the cloud Python kernel: {path}"
        assert metadata["doc"] == entry["doc"], path
        assert metadata["doc_sha256"] == hashlib.sha256(doc.read_bytes()).hexdigest(), f"Review updated doc: {doc}"
        title = re.search(r"(?m)^# (.+)$", doc.read_text()).group(1)
        assert "".join(cells[0]["source"]).splitlines()[0] == "# " + title, path
        text = "\n".join("".join(c["source"]) for c in cells if c["cell_type"] == "markdown")
        assert headings(text) == headings(doc.read_text()), f"Section order: {path}"
        assert "练习" in text or "自我检验" in text, path
        assert list(path.parent.iterdir()) == [path], f"Chapter contains extra files: {path.parent}"
        assert len({c["id"] for c in cells}) == len(cells), path
        images = sum(len(c.get("attachments", {})) for c in cells)
        assert images >= 1, f"Missing teaching figure: {path}"
        lines = []
        for cell in cells:
            source = "".join(cell["source"])
            assert "\t" not in source, f"Unexpected tab / broken LaTeX escape: {path}"
            if cell["cell_type"] == "markdown":
                assert "**观察：**" not in source, f"Colon belongs outside emphasis: {path}"
                assert "远程" not in source and "浏览器在 Mac" not in source, f"Deployment prose in lesson: {path}"
            for name, bundle in cell.get("attachments", {}).items():
                assert f"attachment:{name}" in source, path
                for mime, encoded in bundle.items():
                    assert mime in {"image/png", "image/jpeg"}, f"Use raster notebook attachments: {path} / {name}"
                    data = base64.b64decode(encoded, validate=True)
                    signature = b"\x89PNG\r\n\x1a\n" if mime == "image/png" else b"\xff\xd8\xff"
                    assert data.startswith(signature), f"Invalid binary image: {path} / {name}"
                    figure = cell["metadata"].get("hello_gpu_figure")
                    assert figure and figure["source_sha256"] == hashlib.sha256((REPO / figure["source"]).read_bytes()).hexdigest(), path
                    if "rendered_sha256" in figure:
                        assert hashlib.sha256(data).hexdigest() == figure["rendered_sha256"], path
            if cell["cell_type"] != "code":
                continue
            assert cell["execution_count"] is None and cell["outputs"] == [], path
            count = len(source.splitlines())
            assert count <= 30, f"Long cell ({count}): {path} / {cell['id']}"
            lines.append(count)
            assert not re.search(r"(?m)^\s*!|sys\.path|subprocess\.", source), path
            assert "gfx1201" not in source, f"Hardcoded architecture: {path}"
            if not source.startswith("%%hip"):
                ast.parse("\n".join(line for line in source.splitlines() if not line.startswith("%")))
        reports.append({"notebook": entry["notebook"], "sections": len(headings(text)),
                        "figures": images, "code_cells": len(lines), "code_lines": sum(lines),
                        "max_cell_lines": max(lines, default=0)})
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
