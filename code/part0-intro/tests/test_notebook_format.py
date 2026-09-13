"""Check published notebooks can open with Python and contain no saved run output."""

import json
from pathlib import Path
import unittest


NOTEBOOK_ROOT = Path(__file__).resolve().parents[3] / "notebooks"


class NotebookFormatTest(unittest.TestCase):
    def test_notebook_format(self):
        paths = sorted(NOTEBOOK_ROOT.glob("part*/*.ipynb"))
        self.assertTrue(paths, "No tutorial notebooks found")
        for path in paths:
            with self.subTest(notebook=str(path.relative_to(NOTEBOOK_ROOT))):
                notebook = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(notebook.get("nbformat"), 4)
                kernel = notebook.get("metadata", {}).get("kernelspec", {})
                self.assertEqual(kernel.get("language", "").lower(), "python")
                self.assertIn("python3", kernel.get("name", "").lower().replace("python 3", "python3"))
                cells = notebook.get("cells", [])
                for kind in ("markdown", "code"):
                    self.assertTrue(any(
                        cell.get("cell_type") == kind and "".join(cell.get("source", [])).strip()
                        for cell in cells
                    ), f"Missing non-empty {kind} cell")
                for index, cell in enumerate(cells):
                    if cell.get("cell_type") == "code":
                        self.assertEqual(cell.get("outputs", []), [], f"Cell {index}: saved output")
                        self.assertIsNone(cell.get("execution_count"), f"Cell {index}: saved execution count")


if __name__ == "__main__":
    unittest.main()
