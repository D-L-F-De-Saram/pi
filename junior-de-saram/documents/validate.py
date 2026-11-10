"""Validate completed Office/PDF files before publishing user downloads."""
import json
import pathlib
import sys
import zipfile
from defusedxml import ElementTree


def validate(source):
    if source.suffix.lower() in ('.docx', '.pptx', '.xlsx'):
        with zipfile.ZipFile(source) as archive:
            if len(archive.infolist()) > 5000:
                raise ValueError('Office archive exceeds validation limits')
            for entry in archive.infolist():
                if entry.filename.endswith(('.xml', '.rels')):
                    if entry.file_size > 20 * 1024 * 1024:
                        raise ValueError('Office XML exceeds validation limits')
                    try:
                        ElementTree.fromstring(archive.read(entry))
                    except Exception:
                        raise ValueError('Invalid XML in ' + entry.filename + '. Escape metadata XML characters such as & before regenerating the file.')
    if source.suffix.lower() == '.xlsx':
        import openpyxl
        formulas = openpyxl.load_workbook(source, read_only=True, data_only=False)
        values = openpyxl.load_workbook(source, read_only=True, data_only=True)
        count = 0
        for sheet in formulas:
            if sheet.max_row > 200000 or sheet.max_column > 500:
                raise ValueError('Workbook exceeds publication validation limits')
            for row in sheet:
                for cell in row:
                    if cell.value is None:
                        continue
                    cached = values[sheet.title][cell.coordinate]
                    if cell.data_type == 'f':
                        count += 1
                        if cached.value is None and cached.data_type != 's':
                            raise ValueError('Formula has no cached result at ' + sheet.title + '!' + cell.coordinate + '. Recalculate using the XLSX skill recalc.py script, then republish.')
                    if cached.data_type == 'e':
                        raise ValueError('Spreadsheet error at ' + sheet.title + '!' + cell.coordinate + ': ' + str(cached.value))
        return {'sheets': len(formulas.sheetnames), 'formulas': count, 'cached_formula_results': True}
    if source.suffix.lower() == '.docx':
        from docx import Document
        document = Document(source)
        return {'paragraphs': len(document.paragraphs), 'tables': len(document.tables)}
    if source.suffix.lower() == '.pptx':
        from pptx import Presentation
        presentation = Presentation(source)
        if not presentation.slides:
            raise ValueError('Presentation has no slides')
        return {'slides': len(presentation.slides)}
    from pypdf import PdfReader
    pdf = PdfReader(source)
    if not pdf.pages:
        raise ValueError('PDF has no pages')
    return {'pages': len(pdf.pages)}


try:
    print(json.dumps({'valid': True, 'details': validate(pathlib.Path(sys.argv[1]))}))
except Exception as error:
    print(json.dumps({'valid': False, 'error': str(error)[:1000]}))
