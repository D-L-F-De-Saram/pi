# Junior De Saram local operation

Junior De Saram is a separate Pi 1.5 checkout. Its MCP tools are `firm_research`, `document_drafter`, `public_web_search`, `legal_source_retrieve_details`, `code_runner_data_transform`, `workbench_publish_artifact` and `prepare_document_preview`. Pi also has built-in read/write/edit/bash tools for document-skill scripts. The final-answer and source-retrieval skills are in `.agents/skills/de-saram-legal-final-answer/` and `.agents/skills/de-saram-source-retrieval/`; PDF, PPTX, XLSX and DOCX skills include their scripts and reference material. No fixed research or drafting sequence is imposed.

The context extension is `.pi/extensions/junior-de-saram-context.ts`. The delivery extension restores linked researcher/direct-source citations and delivers preview artifacts. The scope guard blocks known credential access patterns, and the local-trace extension logs CLI activity. These guards are not a complete sandbox for arbitrary code. Both CLI and hosted requests use `junior-de-saram/core/runtime.mjs` for consistent model, extension and skill options.

The OpenAI-compatible service is `junior-de-saram/server/openai.mjs`, listening on container port 8160 and Windows loopback port 8160. Local LibreChat shows **Junior De Saram Pi** in the **De Saram AI** group. The firm researcher and drafter remain separate available models in that group.

## Start

From WSL in this directory:

```sh
docker compose up -d --no-deps junior-de-saram
docker compose ps
```

The local `.env` is ignored by Git. Fill it from `.env.example` if setting up elsewhere. Local service URLs now use loopback forwards inside the container, established by `Connect-DeSaramSources.sh`, rather than depending on a changing WSL interface address. The SSH alias defaults to `desaram-ai-dev-hetzner-paralegaluser`. The helper forwards research port 18124 to development port 8123, drafter port 19125 to development port 9124, Typesense port 18108 to port 8108 and the document reader port 17008 to its private port 7008. SSH credentials stay on the host. Reconnect after container recreation. Do not commit `.env` or credentials.

To use Pi as an interactive CLI in the running container, run `sh ./Start-JuniorDeSaram.sh` from WSL or `./Start-JuniorDeSaram.ps1` from Windows PowerShell. Both use the provider/model/thinking configured in `.env`, enable document execution and load the same approved skills/extensions as the hosted model. Recreate the container after `.env` changes.

## Direct indexed sources and document execution

The direct adapter uses De Saram's read-only Typesense key, never an admin key. It supports firm documents, books, Acts and regulations, actual schema/facet discovery, selected-field retrieval, structured validated filters and bounded full-document Markdown reads through the existing file service. With search-only keys that cannot read collection schemas, it describes the checked-in schema and labels that fallback. Exact record retrieval uses an ID filter in a search request so search-only credentials suffice. Chunk counts are explicitly distinguished from document counts; continuation data is returned.

Configure `DESARAM_TYPESENSE_URL`, `DESARAM_TYPESENSE_SEARCH_KEY`, `DESARAM_FILE_SERVER_URL` and `DESARAM_DOCUMENT_VIEWER_URL` in `.env`. For local development with remote indexed data, use loopback URLs from `.env.example`, then run `sh ./Connect-DeSaramSources.sh` in WSL after container recreation. The helper keeps host SSH keys on the host and binds forwards only to loopback inside the container network namespace. It requires sudo/nsenter and an existing working SSH alias. On the deployed server, private Docker service URLs are preferable; join the relevant network if it differs from LibreChat's.

The Windows launcher reconnects those local forwards automatically using WSL root for the namespace operation and the normal WSL user's SSH identity. The Linux launcher uses sudo if needed. To connect from Windows without a sudo prompt: `wsl.exe -u root --cd "/mnt/d/Intern/Work/de saram/junior-de-saram" sh ./Connect-DeSaramSources.sh thant` (replace the path and SSH user for another machine). The helper checks existing forwards before starting another connection.

The Docker image includes Python/Node document libraries, LibreOffice Writer/Calc/Impress, Pandoc, Poppler, OCR and Chromium. Pi can read a skill, write code and run its scripts. The data-transform MCP tool is a bounded JSON calculator and cannot make files; document creation uses the built-in tools.

Hosted generated files live in `/data/workspaces/<conversation-id>/`. CLI files live under `/data/workspaces/`. Completed artifacts are copied to `/data/artifacts/` and delivered through signed links using `JUNIOR_DE_SARAM_ARTIFACT_SECRET` or the existing service API key. Both directories are persistent volumes. Image/PDF previews show up to six pages; spreadsheet previews show bounded sheet tables. Output validation remains Pi's responsibility before publication.

After source, dependency or skill changes:

```sh
docker compose build junior-de-saram
docker compose up -d --no-deps --force-recreate junior-de-saram
sh ./Connect-DeSaramSources.sh  # local SSH setup only
```

Docker uses cached layers by default. No LibreChat code or YAML changes are required for these capabilities. See [TESTING.md](TESTING.md) for the feature-first verification checklist.

## Local checks

```sh
docker inspect junior-de-saram --format '{{.State.Health.Status}}'
curl -s http://127.0.0.1:8160/health
docker logs --tail 50 junior-de-saram
```

The host accepts `POST /v1/chat/completions` and `GET /v1/models` with `Authorization: Bearer <JUNIOR_DE_SARAM_API_KEY>`. LibreChat sends the conversation ID header so Pi retains its own session across turns. The document drafter can ask a template or branding question. Answer it in the same chat; Pi then passes the user's answer and previous drafter messages to the service.

For local DOCX downloads, the host signs and proxies `/files/...docx` over the SSH tunnel. The public De Saram development hostname configured by the existing drafter did not resolve locally during testing; the signed local link was tested from Windows and returned a valid DOCX.

## Validation performed

- Docker image built; container healthy.
- Pi CLI invocation returned a greeting.
- OpenAI endpoint returned a greeting with token usage.
- Pi called `firm_research` and returned a linked Companies Act answer.
- Pi called `public_web_search` and returned a linked result.
- Pi called `document_drafter`, relayed a two-template choice, accepted the user's T1 reply in the same session and returned a DOCX.
- The signed DOCX link downloaded from Windows as a 31,712-byte DOCX ZIP.
- LibreChat container authenticated to `/v1/models` and received a streamed completion with usage and `[DONE]`.

## Live progress, citations, previews and logs

The host streams short safe progress updates in LibreChat while Pi researches, searches public sources or asks the firm drafter for a document. It does not expose tool arguments, credentials or raw service status. Research citations are reconciled with the researcher output: only linked footnote definitions with an unambiguous source are restored. A completed drafter DOCX can be previewed in LibreChat canvas when Pi selects the preview tool; the original DOCX download remains available. See [LOGGING.md](LOGGING.md) for persistent per-request JSON traces and the local viewer import command.

## Verification of this update

- The repository quality gate passed inside the built Docker image.
- Focused citation and DOCX preview tests passed.
- A live Companies Act question streamed four progress messages, returned two linked footnote definitions and token usage.
- The preview MCP tool rendered an existing drafter DOCX into HTML; a Pi request selected it and returned a canvas artifact together with the signed DOCX download link.
- The latest trace included the model calls, preview tool call, final answer and numeric token totals. The container was healthy after recreation.
