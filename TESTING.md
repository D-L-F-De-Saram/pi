# Junior De Saram verification

Test a changed capability first. Once it passes, check the existing features.

## Automated checks

Run `node --test junior-de-saram/test/*.test.mjs` and `npm run check`. The full Pi check may depend on hydration of its ignored provider catalog (`npm run hydrate:model-data`). Do not commit generated provider data or credentials.

## New capabilities through normal Pi requests

- Ask for a lease or writ draft. Check that Pi uses a private wiki example when helpful, writes its own Markdown, validates it, renders a DOCX, publishes a download and offers a preview. It must not call the former `document_drafter` tool or copy unrelated client particulars.
- Ask for a legal document type absent from the seed wiki. Check indexed firm candidate discovery, a title-named Markdown and `.md.json` under the host wiki's `imported/` folder, and a repeat request that reads the imported copy without fetching it again. The source Markdown and imported files must remain outside Git.
- Continue a draft after answering a clarification or uploading a supporting document. Check that Pi incorporates the new facts and that the same conversation trace records precedent lookup, draft validation, rendering and publication.
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
