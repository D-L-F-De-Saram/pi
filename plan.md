# Junior De Saram: Pi-based assistant plan

## Approved hosted security migration (2026-11-17)

The hosted service will adopt Junior Silva's security boundaries while preserving De Saram research, drafting, catalog, document generation, and logging behavior. This section records the approved implementation plan; it does not authorize changing firm databases or source documents.

1. Require trusted LibreChat user and conversation headers. Reject missing, placeholder, or mismatched identities. Use a separate identity secret to derive user and chat folders. Migrate existing sessions deliberately and verify the trust boundary at LibreChat.
2. Split the hosted runtime into a credential-holding bridge, a Docker runner with no application credentials, and a minimal Pi image with no bridge code or credentials. Use De Saram-specific secrets, host data path, labels, ports, slot networks, and subnets. Harden bridge and runner containers.
3. Start one gVisor (`runsc`) Pi container per message. Mount only that chat's uploads and artifacts read-only and workspace and sessions read-write. Give each message a request folder and fresh in-memory Pi settings. Keep the private drafting catalog out of Pi's mounts.
4. Forward Pi tool requests to bridge-side handlers through a short-lived run token bound to the chat and the originating slot. Make every file-taking handler use server-owned chat context, not a Pi-supplied workspace path. Preserve read-only source access and copy original DOCX templates into the chat workspace without altering the originals.
5. Proxy model requests through the bridge. Keep real provider keys there; allow only tested provider/model routes and request shapes. Route firm research, Typesense, the file server, source gateway, Serper, and Exa through the bridge. Pi's slot network has no direct external or host access.
6. Bind artifact links to user, chat, operation, file, and expiry. Preserve previews and administrator traces with protected storage, redaction, and retention. Add request and tool-call limits, CPU, memory, process, and time limits. Treat in-process `node:vm` as untrusted and move code evaluation to a restricted execution boundary or replace it.
7. Port the unit and live isolation checks, including cross-user file access, template copies, artifact links, provider secrets, network reachability, model switching, cancellation, concurrency, and document generation. Scan images and build history for secrets. Run disruptive checks only in a maintenance window.

The reference implementation is `D:/Intern/Work/Untouched/pi`. Its hosted architecture uses a bridge, runner, and per-message gVisor Pi container. Its identities, filesystem checks, token-bound gateway, model proxy, signed links, resource limits, and image isolation are described in the accompanying code. The reference's live isolation script marks the answer filter, public document fetch, disk watchdog, and some functional/browser checks as later; they are not assumed to be implemented.

Junior De Saram initially runs Pi as a child of its API process with inherited service environment and shared mounts. Its current conversation key permits an anonymous fallback. Its full traces contain prompt and tool content, and its `node:vm` data runner is not a security sandbox. These gaps drive this migration. Native CLI use remains a separate single-developer path; hosted security claims apply to the container executor.

### Implementation map and verification

| Security boundary | Junior De Saram implementation | Check |
| --- | --- | --- |
| Trusted user/chat identity | `core/chat-scope.mjs`; HMAC using `DS_IDENTITY_SECRET`; strict LibreChat headers | Missing/placeholder IDs fail; two users sharing a chat ID get different folders |
| Per-chat storage | `core/chat-scope.mjs`, `core/uploads.mjs`, `core/artifacts.mjs`; `DS_HOST_DATA_ROOT/users/<user-hash>/chats/<chat-hash>/` | A file-taking tool cannot read a second chat's file |
| Split services | `Dockerfile`, `docker-compose.yml`; bridge, Docker runner, minimal Pi image | Inspect image contents, mounts, networks, and environment |
| Pi sandbox | `runner/docker-args.mjs`, `runner/slots.mjs`, `deploy/pi-entrypoint.sh`; `runsc`, private isolated slot, per-message tmpfs, read-only root, resource limits | Runner health and live Docker/inside-sandbox checks |
| Token-bound tools and models | `server/run-tokens.mjs`, `server/gateway.mjs`, `server/model-proxy.mjs`, `mcp/sandbox-launcher.mjs` | Wrong token/address/provider/model refused; server tools and remote file references refused |
| Bridge-owned source handling | `mcp/server.mjs`, `core/precedents.mjs`, `core/drafting-catalog.mjs`; source catalog only in bridge | Template copy stays in chat workspace; original repository unchanged |
| Artifact delivery | `core/artifacts.mjs`, `server/openai.mjs`; HMAC link with user/chat/operation/file/expiry | Link succeeds and tampered/expired link fails |
| Limits | `DS_SLOTS`, `DS_MAX_RUNS_PER_USER`, slot wait and run timeout; runner Docker CPU/memory/PID caps | Concurrency, cancellation, and cleanup checks |
| Logging | `core/trace.mjs`; bridge-only full trace, redact secrets, identify user hash and source use | Research/sample/template calls and token usage visible to admin |

The code migration is complete, with targeted Linux unit tests and a tested one-chat legacy migration utility. On 2026-11-17, the laptop's native WSL Docker Engine was configured with `runsc`; an ephemeral gVisor container passed the runtime check without restarting existing containers. Local `.env`, the active LibreChat model allowlist, and the private host data directory are configured. A Docker image build and live gVisor/LibreChat tests remain for the operator, who asked to perform rebuild/restart personally. `SECURITY_DEPLOYMENT.md` gives the environment, build, start, verification, and optional explicit old-chat migration steps. The old named volumes are retained; never delete them during this rollout.

### Historical initial plan (superseded by later work)

The new Junior De Saram would be a separate Pi-based legal assistant, modelled on Junior Silva’s architecture but initially given only three specialist capabilities: the firm’s existing researcher, the existing document drafter, and public web search. The firm’s indexed data would remain on the De Saram server; there would be no need to recreate it locally.

Pi would decide which capability to use based on the request and the tool descriptions. We would not prescribe a fixed research → drafting workflow.

## Proposed architecture

```text
Local Pi CLI                         LibreChat
     │                                  │
     │                         OpenAI-compatible host
     └───────────────┬──────────────────┘
                     │
              Junior De Saram Pi
         chooses tools based on the request
                     │
          ┌──────────┼───────────┐
          │          │           │
    Firm researcher  Drafter   Web search
          │          │           │
          └── Existing De Saram services
              and firm knowledge base
```

We would clone the original Pi repository into `D:\Intern\Work\de saram\junior-de-saram`, then add the De Saram-specific host, MCP server, extension and skill there. We would reuse suitable techniques from Junior Silva while keeping this as a separate project.

For local development, the existing De Saram services can be reached securely through a tunnel. For deployment on the De Saram server, the new agent can connect to the existing service containers over an appropriate Docker network. Neither approach requires copying or rebuilding the firm’s Typesense index.

## Tools

I propose a small MCP server with these three tools.

1. **Firm research tool**

   Calls the existing Junior De Saram researcher for questions involving the firm’s documents, precedents, books, Acts and regulations available in its knowledge base.

   Its description would explain the available source categories, that the answer may contain source links and page references, and that Pi should preserve relevant citations. The tool would return the researcher’s answer and available citation information; it would not pretend to expose raw database fields that the researcher does not return.

2. **Document drafter tool**

   Calls the existing De Saram document-drafter service when the user needs its document creation, formatting or revision capabilities. Its description would distinguish that from a short answer or simple email that Pi can write directly.

   The adapter would preserve the drafter’s actual conversation requirements. In particular, if the drafter asks the lawyer to choose a precedent, provide branding information or otherwise clarify a decision, Pi must relay the question and pass the user’s actual answer back. It must not select an answer on the user’s behalf. Returned document download links must remain usable.

3. **Public web search tool**

   Searches public sources when current information or external material would help, and returns source titles, URLs and available snippets. Pi can decide when to use it alongside firm research. The contract would distinguish public sources from private firm knowledge-base material and avoid presenting an unverified search snippet as the contents of a source.

These would be specialist service tools, not PDF, Word, reviewer, PowerPoint or general document-production tools. The existing drafter remains responsible for its own DOCX production.

## Skill and extensions

### Final-answer synthesis skill

The existing researcher’s synthesis prompt is in `desaram-ai-knowledge-base/rag-chat-server/scripts/simple_prompts.py`. It covers more than tone: source scope, source fidelity, conflicting sources, drafting versus research, citations, and CommonMark formatting.

Adapt those principles into one De Saram final-answer skill for Pi. It would cover:

- Direct answers, followed by appropriately structured analysis.
- Distinguishing firm documents, books, Acts, regulations and public web sources.
- Saying when the requested source category did not produce relevant material, rather than quietly substituting another category.
- Not turning summaries into purported quotations or inventing missing legal or procedural details.
- Identifying conflicts and explaining the basis for assessing whether material has been superseded or remains current.
- Preserving source links and page references when available, and not inventing citations.
- Clear CommonMark headings, spacing, lists and tables.
- For drafting, matching the requested scope and using placeholders for missing facts.

One part requires adaptation rather than literal copying: the researcher’s prompt asks its own synthesis model to output `.md` filename markers that its own post-processor converts into footnotes. Pi would receive the researcher’s processed response, so copying that marker instruction into Pi’s skill would be wrong. We would instead preserve and use the citations and links actually returned. Likewise, firm precedents would be treated as confidential work product and drafting models, not automatically as legal authority.

### Extension and host

Add a lightweight De Saram context extension for the assistant’s identity, runtime date in Sri Lanka, legal-assistant scope and the availability of the final-answer skill. It would describe the available capabilities without requiring Pi to call them in a predetermined order.

The OpenAI-compatible host would adapt Junior Silva’s relevant techniques for LibreChat: conversation handling, streamed responses and safe progress messages, usage information where available, and returning the drafter’s downloadable links. We would include appropriate credential handling and avoid exposing service addresses, secrets or tool arguments in visible progress messages.

We would not copy Junior Silva’s review, translation, direct Typesense/Lex, preview, document-creation or general writing skills into this first version. We would explicitly configure Pi’s tool/skill loading so that unwanted skills from the cloned Pi repository or the local machine do not silently appear. The exact built-in Pi tool set would also be checked: merely omitting specialist MCP tools does not necessarily remove Pi’s own file or shell tools.

## Implementation and testing plan

1. Clone the original Pi repository into the requested folder and record its upstream version and Git remotes.
2. Add a separate De Saram MCP server, the three service adapters, the context extension and the final-answer skill.
3. Add CLI and Docker/OpenAI-compatible launch paths, with a non-secret `.env.example`. Configure the existing researcher and drafter as remote services for local testing; configure server deployment separately.
4. Test each adapter’s success, authentication failure, timeout and unavailable-service handling. Verify that no keys or private service configuration appear in the response or progress messages.
5. Test Pi through the CLI and the OpenAI-compatible endpoint with realistic requests:
   - Firm-only research, checking the answer and its source links.
   - A current public-information question requiring web search.
   - A question for which Pi considers both firm and public sources.
   - A simple email, checking that Pi can answer without unnecessarily calling the drafter.
   - A substantial drafting request, checking that the drafter is usable and its download link opens.
   - A drafter follow-up or precedent-selection question, checking that the actual user’s reply is passed through.
   - A multi-turn follow-up, checking that relevant context is retained.
6. Test the final answer’s source fidelity, link preservation, formatting and handling of insufficient or conflicting sources.
7. Connect the new endpoint to local LibreChat and test there as well as in the CLI. Confirm the existing Paralegal models still work.
