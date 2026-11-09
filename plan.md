# Junior De Saram: Pi-based assistant plan

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
