"""Render legal artifacts into a static, escaped LibreChat canvas preview."""
import base64
import html
import json
import pathlib
import subprocess
import sys
import tempfile


def preview(source):
    suffix = source.suffix.lower()
    if suffix == '.pptx':
        from pptx import Presentation
        deck = Presentation(source)
        slides = []
        for index, slide in enumerate(list(deck.slides)[:25], 1):
            lines = []
            for shape in slide.shapes:
                if shape.has_text_frame:
                    lines.extend(p.text.strip() for p in shape.text_frame.paragraphs if p.text.strip())
            title = html.escape(lines[0] if lines else f'Slide {index}')
            details = ''.join('<li>' + html.escape(line) + '</li>' for line in lines[1:11])
            slides.append(f'<article class="slide"><span class="slide-number">{index}</span><h2>{title}</h2><ul>{details}</ul></article>')
        return '<p>Slide gallery. Download the PowerPoint for its complete design and editable content.</p><section class="slide-gallery">' + ''.join(slides) + '</section>'
    if suffix == '.xlsx':
        import openpyxl
        book = openpyxl.load_workbook(source, data_only=True, read_only=True)
        sections = []
        for sheet in list(book)[:6]:
            rows = []
            for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 60), max_col=min(sheet.max_column, 12), values_only=True):
                rows.append('<tr>' + ''.join('<td>' + html.escape(str(v) if v is not None else '') + '</td>' for v in row) + '</tr>')
            sections.append('<h2>' + html.escape(sheet.title) + '</h2><table>' + ''.join(rows) + '</table>')
        return ''.join(sections)
    if suffix in ('.txt', '.md', '.json'):
        text = source.read_text(encoding='utf-8')[:100000]
        if suffix == '.json':
            text = json.dumps(json.loads(text), indent=2, ensure_ascii=False)
        return '<pre>' + html.escape(text) + '</pre>'
    with tempfile.TemporaryDirectory(prefix='desaram-preview-') as working:
        folder = pathlib.Path(working)
        pdf = source
        if suffix != '.pdf':
            subprocess.run(['soffice', '-env:UserInstallation=file://' + str(folder / 'profile'), '--headless', '--convert-to', 'pdf', '--outdir', str(folder), str(source)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=75)
            pdf = folder / (source.stem + '.pdf')
        subprocess.run(['pdftoppm', '-f', '1', '-l', '6', '-scale-to', '1000', '-png', str(pdf), str(folder / 'page')], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
        pages = []
        for image in sorted(folder.glob('page-*.png')):
            data = base64.b64encode(image.read_bytes()).decode('ascii')
            pages.append('<img alt="Document page" src="data:image/png;base64,' + data + '">')
        if not pages:
            raise ValueError('No preview pages rendered')
        return ''.join(pages)


if __name__ == '__main__':
    source = pathlib.Path(sys.argv[1])
    content = preview(source)
    print('<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#eef1f5;color:#172033;font:16px Georgia,serif}main{max-width:1050px;margin:24px auto;padding:24px;background:white}img{display:block;width:100%;height:auto;margin:16px 0;border:1px solid #ddd}table{border-collapse:collapse;display:block;overflow:auto}td{border:1px solid #ccc;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.slide-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}.slide{position:relative;box-sizing:border-box;aspect-ratio:16/9;overflow:hidden;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:20px;font:14px system-ui,sans-serif}.slide:before{content:"";position:absolute;top:0;left:0;right:0;height:6px;background:#247ba0}.slide h2{font-size:19px;line-height:1.2;margin:16px 24px 12px 0}.slide ul{padding-left:18px;line-height:1.35}.slide-number{position:absolute;right:16px;top:14px;font-weight:bold;color:#64748b}</style></head><body><main><h1>' + html.escape(source.name) + '</h1><p>Preview of the completed file. Download the original for the full document.</p>' + content + '</main></body></html>')
