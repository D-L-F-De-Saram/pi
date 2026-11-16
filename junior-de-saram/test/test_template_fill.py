import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from docx import Document


HELPER = Path(__file__).resolve().parents[2] / ".agents" / "skills" / "de-saram-legal-drafting" / "fill-template-docx.py"


class TemplateFillTests(unittest.TestCase):
    def test_fills_split_placeholder_without_rewriting_other_runs_or_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "template.docx"
            mapping = root / "known-facts.json"
            output = root / "filled.docx"
            document = Document()
            paragraph = document.add_paragraph()
            paragraph.add_run("Client: ").bold = True
            paragraph.add_run("[NA").italic = True
            paragraph.add_run("ME]")
            paragraph.add_run(" — Signed").underline = True
            document.save(source)
            original = source.read_bytes()
            mapping.write_text(json.dumps({"[NAME]": "A. Client"}), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(HELPER), str(source), str(mapping), str(output)],
                capture_output=True, text=True, check=True,
            )
            self.assertEqual(json.loads(result.stdout)["replacement_counts"], {"[NAME]": 1})
            self.assertEqual(source.read_bytes(), original)
            completed = Document(output).paragraphs[0]
            self.assertEqual(completed.text, "Client: A. Client — Signed")
            self.assertTrue(completed.runs[0].bold)
            self.assertTrue(completed.runs[1].italic)
            self.assertTrue(completed.runs[-1].underline)


if __name__ == "__main__":
    unittest.main()
