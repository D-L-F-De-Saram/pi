#!/usr/bin/env python3
"""Build a legal DOCX from authored Markdown using the firm's reference styles."""

from pathlib import Path
import argparse
import subprocess

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches


def add_page_number(paragraph):
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    paragraph._p.append(field)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--brand", action="store_true", help="Add firm logo and website to the document")
    args = parser.parse_args()
    if not args.source.is_file() or args.source.suffix.lower() != ".md":
        parser.error("source must be an existing Markdown file")
    if args.output.suffix.lower() != ".docx":
        parser.error("output must end in .docx")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    assets = Path(__file__).parent / "assets"
    subprocess.run(
        ["pandoc", str(args.source), "--from=markdown", "--to=docx", "--standalone",
         f"--reference-doc={assets / 'reference.docx'}", "--output", str(args.output)],
        check=True, timeout=120,
    )
    document = Document(args.output)
    for section in document.sections:
        section.top_margin = Inches(0.85)
        section.bottom_margin = Inches(0.85)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        footer = section.footer.paragraphs[0]
        footer.clear()
        footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if args.brand:
            header = section.header.paragraphs[0]
            header.clear()
            header.add_run().add_picture(str(assets / "desaram-logo.png"), width=Inches(1.25))
            footer.add_run("www.desaram.com  |  ")
        add_page_number(footer)
    document.save(args.output)
    print(args.output)


if __name__ == "__main__":
    main()
