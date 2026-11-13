"""Verify document previews use self-contained text instead of page images."""
import pathlib
import sys
import tempfile
import unittest

from docx import Document
from reportlab.pdfgen import canvas

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'documents'))
from preview import preview


class PreviewTest(unittest.TestCase):
    def test_pdf_preview_keeps_page_text_without_image_links(self):
        with tempfile.TemporaryDirectory() as folder:
            source = pathlib.Path(folder) / 'nmra.pdf'
            page = canvas.Canvas(str(source))
            page.drawString(72, 720, 'NMRA & drug pricing <gazette>')
            page.save()
            markup = preview(source)
            self.assertIn('NMRA &amp; drug pricing &lt;gazette&gt;', markup)
            self.assertIn('Page 1', markup)
            self.assertNotIn('<img', markup)
            self.assertNotIn('preview.png', markup)

    def test_docx_preview_keeps_heading_table_and_inline_formatting(self):
        with tempfile.TemporaryDirectory() as folder:
            source = pathlib.Path(folder) / 'legal-note.docx'
            document = Document()
            document.add_heading('Legal note', level=1)
            paragraph = document.add_paragraph()
            paragraph.add_run('Important').bold = True
            paragraph.add_run(' & relevant')
            table = document.add_table(rows=1, cols=2)
            table.cell(0, 0).text = 'Act'
            table.cell(0, 1).text = 'Date'
            document.save(source)
            markup = preview(source)
            self.assertIn('<h2>Legal note</h2>', markup)
            self.assertIn('<strong>Important</strong> &amp; relevant', markup)
            self.assertIn('<td>Act</td><td>Date</td>', markup)
            self.assertNotIn('<img', markup)


if __name__ == '__main__':
    unittest.main()
