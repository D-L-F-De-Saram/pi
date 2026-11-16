---
name: de-saram-legal-drafting
description: Draft and revise De Saram legal instruments using private firm examples, verified legal sources, and a checked Markdown-to-DOCX build.
---

# De Saram legal drafting

Pi authors legal drafts. The private wiki is now a metadata catalog of indexed firm documents, not a store of copied examples. It records whether a source appears to be a fillable template, a completed sample or uncertain, and whether its original DOCX was actually verified. A template can provide a formatted original to fill; a sample can guide a new draft. Neither establishes current law or authorizes copying another client's particulars.

Read the user's files and directions. In a revision, identify the original provisions, preserve appropriate wording and explain material changes. Consider `de_saram_precedent_search` when a firm document would improve the requested instrument. Compare the candidate's type, forum, purpose, classification and original availability. Use `de_saram_precedent_read` for a bounded source excerpt; it reads from the firm service without storing the private text in the catalog. Continue at `next_offset` only if needed. The catalog's classification may be uncertain; inspect before relying on it.

For a verified template with an available original DOCX, `de_saram_template_copy` copies the original into this conversation's workspace. Fill and revise **that copy**, retaining its headings, tables, tabs, run formatting and appropriate wording. The firm original is read only and must never be moved, edited or deleted. The helper below can inspect common blanks and replace exact placeholders across Word runs without replacing a whole paragraph; give it a JSON file of facts established for this matter. Use the DOCX skill and targeted code for layouts or blank fields the helper cannot safely identify. Do not fill a field by guessing. If the original is missing, is not DOCX, or classification is uncertain, treat the source as reference until verified; do not claim to have filled the firm original.

```bash
python3 .agents/skills/de-saram-legal-drafting/fill-template-docx.py --inspect /data/workspaces/<conversation>/source-templates/template-copy.docx
python3 .agents/skills/de-saram-legal-drafting/fill-template-docx.py /data/workspaces/<conversation>/source-templates/template-copy.docx /data/workspaces/<conversation>/known-facts.json /data/workspaces/<conversation>/filled-template.docx
```

For a completed sample, read only the relevant passages, then write a fresh document using the sample's useful structure and style. Do not copy the sample file as the deliverable or carry over its names, addresses, case numbers, amounts, facts or confidential positions. For an ordinary email or a drafting task that does not need a firm example, draft directly.

Use `firm_research`, `legal_source_retrieve_details`, public search or a combination according to the legal question. Verify legal propositions against sources; a precedent is not an authority. Do not transfer another client's names, addresses, case numbers, amounts, facts or confidential positions into the new document. Use clear placeholders or ask focused questions for missing material facts. An uploaded supporting document may answer a question. A user can ask for an interim draft with disclosed assumptions.

For a newly authored document, save a Markdown source in the conversation workspace. Check it with `de_saram_validate_draft`, resolve or disclose placeholders, and inspect the final source. For a DOCX, read the `docx` skill and use its workflow; this skill also supplies a firm legal renderer:

```bash
python3 .agents/skills/de-saram-legal-drafting/build-de-saram-docx.py /data/workspaces/<conversation>/draft.md /data/workspaces/<conversation>/draft.docx
```

Use `--brand` only when firm branding is appropriate for the specific document. The renderer uses Pandoc and the firm reference DOCX for headings, tables, lists and links. For both filled templates and new documents, inspect rendered pages and correct layout defects before delivery. Use the PDF skill for a PDF request. Publish each final file with `workbench_publish_artifact`; its protected URL is the download link. Supply a preview where useful. A local path is not a download.

For a simple email or ordinary chat response, draft directly unless the user asks for a formal file. Preserve the numbered linked citation format required by the De Saram final-answer skill in the accompanying explanation.
