"""Replace exact DOCX template placeholders while retaining paragraph/run styles.

Usage:
  python3 fill-template-docx.py --inspect SOURCE.docx
  python3 fill-template-docx.py SOURCE.docx replacements.json OUTPUT.docx

The JSON maps exact placeholder text to its replacement. It must contain only
facts established for this draft. The script never writes to SOURCE.docx.
"""

import json
import re
import sys
from pathlib import Path

from docx import Document


MARKER = re.compile(
    r"\{\{[^{}\n]{1,60}\}\}|\[(?:NAME|DATE|ADDRESS|AMOUNT|PARTY|CLIENT|INSERT|FILL|TO BE COMPLETED)[^\]\n]{0,60}\]|_{4,}|\.{6,}",
    re.IGNORECASE,
)


def paragraphs(container):
    for paragraph in container.paragraphs:
        yield paragraph
    for table in container.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from paragraphs(cell)


def document_paragraphs(document):
    yield from paragraphs(document)
    for section in document.sections:
        yield from paragraphs(section.header)
        yield from paragraphs(section.footer)


def replace_exact(paragraph, old, new):
    runs = paragraph.runs
    combined = "".join(run.text for run in runs)
    positions = []
    start = 0
    while (index := combined.find(old, start)) >= 0:
        positions.append(index)
        start = index + len(old)
    if not positions:
        return 0

    def locate(position):
        cursor = 0
        for number, run in enumerate(runs):
            end = cursor + len(run.text)
            if position < end or (position == end and number == len(runs) - 1):
                return number, position - cursor
            cursor = end
        raise ValueError("Placeholder position is outside runs")

    for index in reversed(positions):
        first, start_offset = locate(index)
        last, end_offset = locate(index + len(old) - 1)
        end_offset += 1
        if first == last:
            text = runs[first].text
            runs[first].text = text[:start_offset] + new + text[end_offset:]
        else:
            prefix = runs[first].text[:start_offset]
            suffix = runs[last].text[end_offset:]
            runs[first].text = prefix + new
            for number in range(first + 1, last):
                runs[number].text = ""
            runs[last].text = suffix
    return len(positions)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--inspect":
        source = Path(sys.argv[2])
        document = Document(source)
        counts = {}
        for paragraph in document_paragraphs(document):
            for marker in MARKER.findall(paragraph.text):
                counts[marker] = counts.get(marker, 0) + 1
        print(json.dumps({"markers": [{"text": key, "count": count} for key, count in list(counts.items())[:100]], "marker_types": len(counts)}))
        return
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    source, mapping_file, destination = map(Path, sys.argv[1:])
    if source.resolve() == destination.resolve():
        raise SystemExit("Output must differ from the source copy")
    mapping = json.loads(mapping_file.read_text(encoding="utf-8"))
    if not isinstance(mapping, dict) or not mapping:
        raise SystemExit("Replacement JSON must map exact placeholders to known values")
    for old, new in mapping.items():
        if not isinstance(old, str) or not old or not isinstance(new, str) or not new.strip():
            raise SystemExit("Replacement keys and values must be nonempty strings")
        if any(char in old + new for char in "\r\n\x00"):
            raise SystemExit("Replacement keys and values must be single-line text")
    document = Document(source)
    counts = {}
    for old, new in mapping.items():
        counts[old] = sum(replace_exact(paragraph, old, new) for paragraph in document_paragraphs(document))
    missing = [key for key, count in counts.items() if not count]
    if missing:
        raise SystemExit(f"Exact placeholders not found: {missing}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    document.save(destination)
    print(json.dumps({"output": str(destination), "replacement_counts": counts, "source_unchanged": True}))


if __name__ == "__main__":
    main()
