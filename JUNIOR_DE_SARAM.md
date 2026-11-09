# Junior De Saram local operation

Junior De Saram is a separate Pi 1.5 checkout. Its specialist MCP tools are `firm_research`, `document_drafter`, `public_web_search`, and the optional `prepare_document_preview`. The final-answer skill is in `.agents/skills/de-saram-legal-final-answer/SKILL.md`; the context extension is `.pi/extensions/junior-de-saram-context.ts`. The delivery extension `.pi/extensions/de-saram-delivery.ts` restores linked researcher footnotes and delivers preview artifacts.

The OpenAI-compatible service is `junior-de-saram/server/openai.mjs`, listening on container port 8160 and Windows loopback port 8160. Local LibreChat shows **Junior De Saram Pi** in the **De Saram AI** group. The firm researcher and drafter remain separate available models in that group.

## Start

From WSL in this directory:

```sh
docker compose up -d --no-deps junior-de-saram
docker compose ps
```

The local `.env` is ignored by Git. Fill it from `.env.example` if setting up elsewhere. `DESARAM_RESEARCH_URL` and `DESARAM_DRAFTER_URL` currently point to SSH forwards on this computer's WSL virtual interface. The SSH alias is `desaram-ai-dev-hetzner-paralegaluser`. The research forward targets development port 8123 and the drafter forward targets development port 9124. If WSL is restarted, check its IP with `hostname -I`, re-establish the forwards and update the URLs in `.env` if the IP changed, then recreate this container. Do not commit the keys or tunnel settings as universal defaults.

To use Pi as an interactive CLI in the running container, run `./Start-JuniorDeSaram.sh` from WSL or `./Start-JuniorDeSaram.ps1` from Windows PowerShell. The launchers keep general file and shell tools disabled and load the De Saram MCP, context and answer skill.

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
