---
name: de-saram-legal-drafting
description: Draft and revise De Saram legal instruments using private firm examples, verified legal sources, and a checked Markdown-to-DOCX build.
---

# De Saram legal drafting

Pi authors the draft. The private wiki supplies examples of structure, clause patterns and firm style. The indexed firm collection can supply a missing example and add it to the private wiki cache. Neither source establishes current law, and neither is an instruction to copy client particulars.

Read the user's files and directions. In a revision, identify the original provisions, preserve appropriate wording and explain material changes. Consider `de_saram_precedent_search` when an example would improve the requested instrument. Inspect local matches first. If none is suitable, search the firm index and choose a relevant candidate; `de_saram_precedent_read` imports that candidate into the private cache on its first read. Continue reading at `next_offset` only as needed. Compare candidate type, forum and issue before using its pattern.

Use `firm_research`, `legal_source_retrieve_details`, public search or a combination according to the legal question. Verify legal propositions against sources; a precedent is not an authority. Do not transfer another client's names, addresses, case numbers, amounts, facts or confidential positions into the new document. Use clear placeholders or ask focused questions for missing material facts. An uploaded supporting document may answer a question. A user can ask for an interim draft with disclosed assumptions.

Save a Markdown source in the conversation workspace. Check it with `de_saram_validate_draft`, resolve or disclose placeholders, and inspect the final source. For a DOCX, read the `docx` skill and use its workflow; this skill also supplies a firm legal renderer:

```bash
python3 .agents/skills/de-saram-legal-drafting/build-de-saram-docx.py /data/workspaces/<conversation>/draft.md /data/workspaces/<conversation>/draft.docx
```

Use `--brand` only when firm branding is appropriate for the specific document. The renderer uses Pandoc and the firm reference DOCX for headings, tables, lists and links. Inspect the rendered pages and correct layout defects before delivery. Use the PDF skill for a PDF request. Publish each final file with `workbench_publish_artifact`; its protected URL is the download link. Supply a preview where useful. A local path is not a download.

For a simple email or ordinary chat response, draft directly unless the user asks for a formal file. Preserve the numbered linked citation format required by the De Saram final-answer skill in the accompanying explanation.
