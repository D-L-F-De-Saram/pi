"""Regression test for missing formula caches and empty/merged worksheet cells."""
import json
import pathlib
import subprocess
import tempfile
import re
import zipfile
from openpyxl import Workbook, load_workbook
from pptx import Presentation

root = pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='desaram-workbook-test-') as folder:
    file = pathlib.Path(folder) / 'test.xlsx'
    book = Workbook()
    sheet = book.active
    sheet['A1'] = 'Checklist'
    sheet['B2'] = 2
    sheet['B3'] = 3
    sheet['B5'] = '=SUM(B2:B3)'
    sheet.merge_cells('D2:F3')
    book.save(file)
    command = ['python3', str(root / 'junior-de-saram/documents/validate.py'), str(file)]
    first = json.loads(subprocess.check_output(command))
    assert not first['valid'] and 'cached result' in first['error'], first
    recalculation = subprocess.run(['python3', str(root / '.agents/skills/xlsx/recalc.py'), str(file), '30'], capture_output=True, text=True, timeout=45)
    assert recalculation.returncode == 0, recalculation.stderr
    second = json.loads(subprocess.check_output(command))
    assert second['valid'], second
    assert load_workbook(file, data_only=True).active['B5'].value == 5
    print('PASS: uncached formulas rejected; recalculated formulas and empty/merged cells validated.')
    deck = pathlib.Path(folder) / 'test.pptx'
    slides = Presentation()
    slides.slides.add_slide(slides.slide_layouts[6])
    slides.save(deck)
    with zipfile.ZipFile(deck) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    files['docProps/app.xml'] = re.sub(rb'<Company\s*/>|<Company>.*?</Company>', b'<Company>D. L. & F. De Saram</Company>', files['docProps/app.xml'])
    def save_deck():
        with zipfile.ZipFile(deck, 'w') as archive:
            for name, content in files.items():
                archive.writestr(name, content)
    save_deck()
    command = ['python3', str(root / 'junior-de-saram/documents/validate.py'), str(deck)]
    invalid = json.loads(subprocess.check_output(command))
    assert not invalid['valid'] and 'app.xml' in invalid['error'], invalid
    files['docProps/app.xml'] = files['docProps/app.xml'].replace(b'D. L. & F.', b'D. L. &amp; F.')
    save_deck()
    assert json.loads(subprocess.check_output(command))['valid']
    print('PASS: malformed company metadata rejected; XML-escaped firm metadata accepted.')
