# Junior De Saram verification

Test a changed capability first. Once it passes, check the existing features.

## Automated checks

Run `node --test junior-de-saram/test/*.test.mjs`, `python3 junior-de-saram/test/test_template_fill.py` and `npm run check`. In the separate source-service checkout, run `python -m unittest test_drafting_source_gateway` from its `upload-process/` directory after installing its Python dependencies. The full Pi check may depend on hydration of its ignored provider catalog (`npm run hydrate:model-data`). Do not commit generated provider data or credentials.

## New capabilities through normal Pi requests

- Ask for a document with a verified firm DOCX template. Check that Pi searches the private catalog, copies the original into this conversation's workspace, fills only established facts on the copy, validates and publishes the filled DOCX, and provides a preview. The repository original must remain unchanged.
- Ask for a document represented by a completed firm sample. Check that Pi reads relevant passages, authors a new draft, validates it, renders a DOCX, publishes it and offers a preview. It must not copy unrelated client particulars.
- Inspect the ignored `private-wiki/catalog.json`. It should list classifications and verified original availability without storing sample bodies. New indexed sources enter after incremental refresh; removed sources disappear on scheduled full reconciliation. Existing inactive Markdown examples must not be overwritten or deleted.
- Continue a draft after answering a clarification or uploading a supporting document. Check that Pi incorporates the new facts and that the same conversation trace records catalog search, sample read or template copy, validation, rendering and publication.
- Ask for Acts or regulations filtered by a year and authority. Check discovered field capabilities, label resolution, every requested filter, logical document identities and pagination.
- Ask for more detail from one cited document. Check record retrieval, actual full-text passages, source links and continuation offsets.
- Request a two-slide legal presentation, a formatted DOCX, a PDF brief and a spreadsheet with formulas. Check that Pi reads the skills, runs code, validates output and publishes downloads.
- Open actual outputs. Inspect page and slide renders for clipping and layout problems. Recalculate spreadsheets and inspect formula results.
- Download all artifact types; check bytes and MIME types. An invalid signed token and paths outside the workspace must fail.
- Check safe progress text and canvas previews in LibreChat.
- Inspect traces for both CLI and LibreChat: new tool names, arguments/results, duration, model usage, artifact links and previews; no secrets.

## Existing capability regression

- Firm research with linked footnotes and page references.
- Substantial drafting with user-owned clarification/template answers and DOCX downloads.
- Public web search and combined source research.
- Greeting, current time awareness and final-answer style.
- Same conversation continuation, legal scope and protected credential access.

## Local database connection

Set DESARAM_TYPESENSE_URL=http://127.0.0.1:18108 and DESARAM_FILE_SERVER_URL=http://127.0.0.1:17008 for the loopback-only development SSH forwards. After starting/recreating the container, run `sh ./Connect-DeSaramSources.sh` in WSL. It uses the host SSH alias and sudo/nsenter; SSH credentials never enter the image. Production on the same Docker network can instead use private service URLs without tunnels.
