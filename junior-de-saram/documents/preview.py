"""Build a self-contained, text-based LibreChat preview of a legal artifact."""
import html
import json
import pathlib
import statistics
import sys


MAX_PAGES = 10
MAX_TEXT_CHARS = 180_000


def escaped(value):
    return html.escape(str(value), quote=True)


def pdf_preview(source):
    import fitz

    document = fitz.open(source)
    pages = []
    remaining = MAX_TEXT_CHARS
    for index, page in enumerate(document):
        if index >= MAX_PAGES or remaining <= 0:
            break
        blocks = [block for block in page.get_text('dict', flags=fitz.TEXTFLAGS_TEXT)['blocks'] if block.get('type') == 0]
        sizes = [span['size'] for block in blocks for line in block['lines'] for span in line['spans'] if span['text'].strip()]
        ordinary_size = statistics.median(sizes) if sizes else 12
        lines = []
        for block in blocks:
            for line in block['lines']:
                spans = []
                for span in line['spans']:
                    text = span['text'][:remaining]
                    if not text:
                        continue
                    remaining -= len(text)
                    rendered = escaped(text)
                    if span['flags'] & 16:
                        rendered = '<strong>' + rendered + '</strong>'
                    if span['flags'] & 2:
                        rendered = '<em>' + rendered + '</em>'
                    if span['size'] >= ordinary_size * 1.22:
                        rendered = '<span class="large">' + rendered + '</span>'
                    spans.append(rendered)
                if spans:
                    lines.append('<div class="line">' + ''.join(spans) + '</div>')
            if lines:
                lines.append('<div class="block-gap"></div>')
        if not lines:
            lines.append('<p>No extractable text was found on this page. Read the downloadable PDF for its original content.</p>')
        pages.append('<section class="page"><h2>Page ' + str(index + 1) + '</h2>' + ''.join(lines) + '</section>')
    notice = '<p class="notice">Text preview of the first ' + str(len(pages)) + ' of ' + str(len(document)) + ' pages. Download the PDF for its complete page layout.</p>'
    if remaining <= 0:
        notice += '<p class="notice">Preview text was shortened for performance.</p>'
    return notice + ''.join(pages)


def paragraph_html(paragraph, max_characters):
    from docx.text.hyperlink import Hyperlink

    pieces = []
    remaining = max_characters
    for item in paragraph.iter_inner_content():
        runs = item.runs if isinstance(item, Hyperlink) else [item]
        for run in runs:
            text = run.text[:remaining]
            remaining -= len(text)
            rendered = escaped(text)
            if run.bold:
                rendered = '<strong>' + rendered + '</strong>'
            if run.italic:
                rendered = '<em>' + rendered + '</em>'
            if run.underline:
                rendered = '<u>' + rendered + '</u>'
            pieces.append(rendered)
            if remaining <= 0:
                break
        if remaining <= 0:
            break
    content = ''.join(pieces)
    if not content.strip():
        return ''
    style = paragraph.style.name.lower() if paragraph.style else ''
    tag = 'h2' if style.startswith(('heading', 'title')) else 'p'
    return '<' + tag + '>' + content + '</' + tag + '>'


def docx_preview(source):
    from docx import Document
    from docx.table import Table

    document = Document(source)
    sections = []
    remaining = MAX_TEXT_CHARS
    for item in document.iter_inner_content():
        if remaining <= 0:
            break
        if isinstance(item, Table):
            rows = []
            for row in item.rows[:60]:
                cells = []
                for cell in row.cells[:12]:
                    content = cell.text[:remaining]
                    remaining -= len(content)
                    cells.append('<td>' + escaped(content) + '</td>')
                rows.append('<tr>' + ''.join(cells) + '</tr>')
            sections.append('<div class="table-scroll"><table>' + ''.join(rows) + '</table></div>')
        else:
            rendered = paragraph_html(item, remaining)
            remaining -= min(len(item.text), remaining)
            if rendered:
                sections.append(rendered)
    notice = '<p class="notice">Content preview of the DOCX. Download the original for its complete Word formatting and comments.</p>'
    if remaining <= 0:
        notice += '<p class="notice">Preview text was shortened for performance.</p>'
    return notice + (''.join(sections) if sections else '<p>No extractable text was found in this document.</p>')


def pptx_preview(source):
    from pptx import Presentation

    deck = Presentation(source)
    slides = []
    for index, slide in enumerate(list(deck.slides)[:25], 1):
        lines = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                lines.extend(p.text.strip() for p in shape.text_frame.paragraphs if p.text.strip())
        title = escaped(lines[0] if lines else f'Slide {index}')
        details = ''.join('<li>' + escaped(line) + '</li>' for line in lines[1:11])
        slides.append(f'<article class="slide"><span class="slide-number">{index}</span><h2>{title}</h2><ul>{details}</ul></article>')
    return '<p>Slide gallery. Download the PowerPoint for its complete design and editable content.</p><section class="slide-gallery">' + ''.join(slides) + '</section>'


def preview(source):
    suffix = source.suffix.lower()
    if suffix == '.pptx':
        return pptx_preview(source)
    if suffix == '.pdf':
        return pdf_preview(source)
    if suffix == '.docx':
        return docx_preview(source)
    if suffix == '.xlsx':
        import openpyxl
        book = openpyxl.load_workbook(source, data_only=True, read_only=True)
        sections = []
        for sheet in list(book)[:6]:
            rows = []
            for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 60), max_col=min(sheet.max_column, 12), values_only=True):
                rows.append('<tr>' + ''.join('<td>' + escaped(v if v is not None else '') + '</td>' for v in row) + '</tr>')
            sections.append('<h2>' + escaped(sheet.title) + '</h2><div class="table-scroll"><table>' + ''.join(rows) + '</table></div>')
        return ''.join(sections)
    if suffix in ('.txt', '.md', '.json'):
        text = source.read_text(encoding='utf-8')[:100000]
        if suffix == '.json':
            text = json.dumps(json.loads(text), indent=2, ensure_ascii=False)
        return '<pre>' + escaped(text) + '</pre>'
    raise ValueError('Unsupported preview format: ' + suffix)


if __name__ == '__main__':
    source = pathlib.Path(sys.argv[1])
    content = preview(source)
    print('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#eef1f5;color:#172033;font:16px Georgia,serif;line-height:1.55}main{box-sizing:border-box;max-width:1050px;margin:24px auto;padding:36px;background:white}.notice{font:14px system-ui;color:#475569;background:#f8fafc;border:1px solid #cbd5e1;padding:12px;border-radius:6px}.page{max-width:760px;margin:24px auto;padding:36px 42px;border:1px solid #d1d5db;box-shadow:0 2px 10px #15263b16;overflow-wrap:anywhere}.page h2{font:14px system-ui;color:#64748b;border-bottom:1px solid #e2e8f0;padding-bottom:8px}.line{white-space:pre-wrap}.large{font-size:1.2em;font-weight:600}.block-gap{height:.65em}h1,h2{line-height:1.25}p{white-space:pre-wrap}.table-scroll{overflow:auto}table{border-collapse:collapse;margin:18px 0}td{border:1px solid #ccc;padding:8px;white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere}.slide-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}.slide{position:relative;box-sizing:border-box;aspect-ratio:16/9;overflow:hidden;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:20px;font:14px system-ui,sans-serif}.slide:before{content:"";position:absolute;top:0;left:0;right:0;height:6px;background:#247ba0}.slide h2{font-size:19px;line-height:1.2;margin:16px 24px 12px 0}.slide ul{padding-left:18px;line-height:1.35}.slide-number{position:absolute;right:16px;top:14px;font-weight:bold;color:#64748b}@media(max-width:700px){main{margin:0;padding:20px}.page{padding:20px}}</style></head><body><main><h1>' + escaped(source.name) + '</h1><p>Preview of the completed file. Download the original for the full document.</p>' + content + '</main></body></html>')
