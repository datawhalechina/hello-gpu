"""Author a clean, single-file teaching notebook with embedded local figures."""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def notebook_image(path: Path) -> tuple[Path, dict]:
    """Embed raster images, preserving SVG sources for editable diagrams.

    JupyterLab's Markdown attachment resolver accepts safe raster image MIME
    types and rejects SVG attachments. Use PNG for this notebook display path.
    Committed PNGs allow regeneration without a graphics tool on learner hosts.
    """
    provenance = {"source": str(path.relative_to(ROOT)),
                  "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    if path.suffix.lower() != ".svg":
        return path, provenance
    relative = path.relative_to(ROOT)
    target = ROOT / "notebooks/assets/rendered" / relative.with_suffix(".png")
    identity = target.with_suffix(".sha256")
    if not target.is_file() or not identity.is_file() or identity.read_text().strip() != provenance["source_sha256"]:
        renderer = shutil.which("rsvg-convert")
        if not renderer:
            raise RuntimeError(f"Regenerating {relative} requires rsvg-convert (librsvg).")
        target.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([renderer, "--zoom=2", "--output", str(target), str(path)], check=True)
        identity.write_text(provenance["source_sha256"] + "\n")
    provenance["rendered_sha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
    return target, provenance


class Notebook:
    def __init__(self, part: str, chapter: int):
        self.part, self.chapter = part, chapter
        self.doc = ROOT / "docs" / part / f"chapter{chapter}" / "index.md"
        self.cells = []

    def md(self, text: str):
        self.cells.append({"cell_type": "markdown", "metadata": {}, "source": text.strip() + "\n"})
        return self

    def code(self, text: str):
        if not any(cell["cell_type"] == "code" for cell in self.cells):
            text = "%run ../../common/bootstrap.py\n\n" + text.strip()
        self.cells.append({"cell_type": "code", "metadata": {}, "source": text.strip() + "\n",
                           "execution_count": None, "outputs": []})
        return self

    def figure(self, path: str | Path, caption: str, alt: str):
        path = Path(path)
        if not path.is_absolute():
            path = ROOT / path
        path, provenance = notebook_image(path)
        mime = mimetypes.guess_type(path.name)[0]
        if mime not in ("image/png", "image/jpeg"):
            raise ValueError(f"Unsupported figure: {path}")
        self.md(f"![{alt}](attachment:{path.name})\n\n*{caption}*")
        self.cells[-1]["attachments"] = {path.name: {mime: base64.b64encode(path.read_bytes()).decode()}}
        self.cells[-1]["metadata"]["hello_gpu_figure"] = provenance
        return self

    def write(self):
        document = self.doc.read_text()
        title = re.search(r"(?m)^# (.+)$", document).group(1)
        for index, cell in enumerate(self.cells):
            cell["id"] = f"ch{self.chapter}-{index:03d}"
        notebook = {"nbformat": 4, "nbformat_minor": 5, "cells": self.cells,
                    "metadata": {"kernelspec": {"display_name": "Python 3",
                                                "language": "python", "name": "python3"},
                                 "language_info": {"name": "python"},
                                 "hello_gpu": {"schema_version": 2,
                                               "doc": str(self.doc.relative_to(ROOT)),
                                               "doc_sha256": hashlib.sha256(self.doc.read_bytes()).hexdigest(),
                                               "title": title}}}
        target = ROOT / "notebooks" / self.part / f"chapter{self.chapter}" / f"chapter{self.chapter}.ipynb"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n")
        return target
