import readline from 'node:readline';
import { previewMarkup } from '../core/preview.mjs';
import { retrieveSource } from '../core/source-retrieval.mjs';
import { sourceTool, artifactTool, codeTool } from '../core/tool-definitions.mjs';
import { publishArtifact, localPreview } from '../core/artifacts.mjs';
import { runDataCode } from '../core/code-runner.mjs';
import { deepPublicWebResearch } from '../core/deep-search.mjs';

const definitions = [
  sourceTool, artifactTool, codeTool,
  { name: 'firm_research', description: 'Synthesise legal analysis from the firm’s indexed documents, books, Acts and regulations. Returns the researcher’s source-grounded answer, footnote definitions, linked authorities and page references. It establishes what the indexed holdings support, but cannot by itself rule out a later Gazette, NMRA notice, amendment or other public development. Choose public source tools as well when the answer depends on present status or developments beyond those holdings; preserve citations and the user’s source scope.', inputSchema: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1 }, context: { type: 'string', description: 'Relevant prior context, if needed.' } } } },
  { name: 'document_drafter', description: 'Ask the firm drafter to prepare or revise a substantial legal instrument using firm drafting templates, such as an agreement, pleading, petition or written submission. The service produces legal DOCX documents; use the document skills and built-in tools for presentations, spreadsheets or formatting supplied content as PDF/DOCX. A clarification, template or branding question must go to the user; pass their actual answer with the earlier drafter conversation on the next call. Preserve completed DOCX links and consider a preview. Simple emails and ordinary chat writing do not need this service.', inputSchema: { type: 'object', additionalProperties: false, required: ['messages'], properties: { messages: { type: 'array', minItems: 1, description: 'Relevant user and drafter messages in chronological order, ending with the user’s current request or answer.', items: { type: 'object', additionalProperties: false, required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } } } } } },
  { name: 'public_web_search', description: 'Search Google results through Serper for quick discovery of current public sources, including official Gazettes, regulator and NMRA pages, government notices, amendments and recent announcements. Returns titles, URLs, snippets and available dates; a snippet does not establish the complete operative text or current legal effect. Choose this, deeper Exa public research, firm research or direct indexed retrieval according to the question and evidence needed; combine them when useful.', inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 1 }, max_results: { type: 'integer', minimum: 1, maximum: 10 } } } },
  { name: 'deep_public_web_research', description: 'Use Exa Deep Search to discover and compare relevant passages from multiple public web sources. Useful for evolving regulatory questions, Gazette and regulator developments, conflicting publications, or questions where short search snippets cannot establish what changed and when. Returns source titles, URLs, publication dates when available and page highlights. This provides public-web evidence, not a determination of operative law from a snippet. Choose it alone or alongside firm research, direct indexed retrieval or quick Serper search as the task warrants.', inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 1 }, max_results: { type: 'integer', minimum: 1, maximum: 10 } } } },
  { name: 'prepare_document_preview', description: 'Prepare a safe LibreChat canvas preview of a completed local PDF, PPTX, XLSX, DOCX or text deliverable, or an external drafter DOCX /files path. Prefer a preview for a final document unless already included by workbench_publish_artifact or the user requested download only. A preview supplements the original download; do not use intermediate files.', inputSchema: { type: 'object', additionalProperties: false, required: ['file_path'], properties: { file_path: { type: 'string', description: 'Completed local workspace file, or the /files/...docx path returned by the firm drafter.' } } } },
];
const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
function env(name) { const value = process.env[name]; if (!value) throw Error(`Missing ${name} configuration`); return value; }
function progress(token, message) { if (token !== undefined) output({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: 0, message } }); }
function progressText(name, text) {
  const safe = String(text).toLowerCase();
  if (name === 'firm_research') return /search|retriev|source|document/.test(safe) ? 'Searching the firm’s legal sources and checking relevant documents…' : /cit|answer|synth|summari/.test(safe) ? 'Checking source links and preparing the legal answer…' : undefined;
  if (name === 'document_drafter') return /template|format|style/.test(safe) ? 'Selecting and formatting the firm document template…' : /draft|document|writ|revis/.test(safe) ? 'Preparing the requested legal document…' : undefined;
}
async function chat(base, key, model, messages, name, token) {
  const response = await fetch(`${env(base).replace(/\/$/, '')}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env(key)}` }, body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }), signal: AbortSignal.timeout(1200000) });
  if (!response.ok) throw Error(`Service returned HTTP ${response.status}`);
  let answer = ''; let buffer = ''; let statusBuffer = ''; let lastProgress = '';
  let usage;
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    buffer += done ? '\n' : decoder.decode(value, { stream: true });
    for (const line of buffer.split(/\r?\n/).slice(0, -1)) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
      let event; try { event = JSON.parse(raw); } catch { continue; }
      if (event.error) throw Error('Service reported a streaming error');
      if (event.usage) usage = event.usage;
      const content = event.choices?.[0]?.delta?.content || '';
      if (!content) continue;
      answer += content;
      statusBuffer += content;
      const statuses = [...statusBuffer.matchAll(/<think>([\s\S]*?)<\/think>/gi)];
      for (const status of statuses) {
        const label = progressText(name, status[1]);
        if (label && label !== lastProgress) { progress(token, label); lastProgress = label; }
      }
      if (statuses.length) { const last = statuses.at(-1); statusBuffer = statusBuffer.slice(last.index + last[0].length); }
      if (statusBuffer.length > 8192) statusBuffer = statusBuffer.slice(-8192);
    }
    buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
    if (done) break;
  }
  const cleanAnswer = answer.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
  if (!cleanAnswer) throw Error('Service returned no answer');
  return { text: cleanAnswer, usage };
}
function previewResult(value) {
  const previewReady = typeof value.artifact_markup === 'string' && value.artifact_markup.startsWith(':::artifact{');
  return {
    // Pi only needs to know that the final file is ready. The renderer-owned
    // markup is structured data so the delivery extension can append it exactly
    // once, without asking the model to reproduce signed image URLs.
    text: JSON.stringify({ status: 'completed', filename: value.filename, download_url: value.download_url, preview_ready: previewReady }),
    structuredContent: { ...value, ...(value.download_url ? { artifact: value } : {}) },
  };
}
async function call(name, args, token) {
  if (name === 'legal_source_retrieve_details') { progress(token, 'Reading selected records from the firm’s indexed sources…'); return JSON.stringify(await retrieveSource(args)); }
  if (name === 'workbench_publish_artifact') { progress(token, 'Preparing the completed file for download and preview…'); return previewResult(await publishArtifact(args.file_path)); }
  if (name === 'code_runner_data_transform') return JSON.stringify(runDataCode(args));
  if (name === 'firm_research') return chat('DESARAM_RESEARCH_URL', 'DESARAM_RESEARCH_KEY', 'junior-de-saram-01', [{ role: 'user', content: args.context ? `${args.context}\n\n${args.question}` : args.question }], name, token);
  if (name === 'document_drafter') { if (args.messages?.at(-1)?.role !== 'user') throw Error('Last drafter message must be from the user'); return chat('DESARAM_DRAFTER_URL', 'DESARAM_DRAFTER_KEY', 'document-drafter-01-preview', args.messages, name, token); }
  if (name === 'public_web_search') { const response = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'content-type': 'application/json', 'X-API-KEY': env('SERPER_API_KEY') }, body: JSON.stringify({ q: args.query, num: args.max_results || 10 }), signal: AbortSignal.timeout(30000) }); if (!response.ok) throw Error(`Search returned HTTP ${response.status}`); const data = await response.json(); return JSON.stringify({ results: (data.organic || []).map(({ title, link, snippet, date }) => ({ title, link, snippet, date })) }); }
  if (name === 'deep_public_web_research') return JSON.stringify(await deepPublicWebResearch(args));
  if (name === 'prepare_document_preview') {
    const filePath = String(args.file_path || '');
    if (!filePath.startsWith('/files/')) return previewResult({ artifact_markup: await localPreview(filePath), file_path: filePath });
    if (!/^\/files\/[A-Za-z0-9/_\-.]+\.docx$/.test(filePath) || filePath.includes('..')) throw Error('Expected a drafter DOCX /files path');
    const response = await fetch(`${env('DESARAM_DRAFTER_URL').replace(/\/$/, '')}${filePath}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('Completed document is unavailable');
    const size = Number(response.headers.get('content-length') || 0); if (size > 40000000) throw Error('Document is too large for preview');
    const bytes = Buffer.from(await response.arrayBuffer());
    return previewResult({ artifact_markup: previewMarkup(bytes, filePath), file_path: filePath });
  }
  throw Error('Unknown tool');
}
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => { void (async () => {
  let req; try {
    req = JSON.parse(line); if (!Object.hasOwn(req, 'id')) return;
    if (req.method === 'initialize') return output({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: req.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'de-saram-legal', version: '0.2.0' } } });
    if (req.method === 'tools/list') return output({ jsonrpc: '2.0', id: req.id, result: { tools: definitions } });
    if (req.method === 'tools/call') { try { const value = await call(req.params.name, req.params.arguments || {}, req.params?._meta?.progressToken); const structuredContent = value?.structuredContent || (value?.usage ? { usage: value.usage } : undefined); return output({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: typeof value === 'string' ? value : value.text }], ...(structuredContent ? { structuredContent } : {}) } }); } catch (error) { return output({ jsonrpc: '2.0', id: req.id, result: { isError: true, content: [{ type: 'text', text: error.message }] } }); } }
    return output({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } });
  } catch { return output({ jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32700, message: 'Invalid request' } }); }
})().catch((error) => console.error('[de-saram-mcp]', error.message)); });
