import readline from 'node:readline';
import { previewMarkup } from '../core/preview.mjs';

const definitions = [
  { name: 'firm_research', description: 'Search the firm knowledge base, including indexed firm documents, books, Acts and regulations. Returns the researcher’s source-grounded answer, footnote definitions, linked authorities and page references. Use for firm holdings and legal questions; preserve relevant citations and the user’s source scope.', inputSchema: { type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1 }, context: { type: 'string', description: 'Relevant prior context, if needed.' } } } },
  { name: 'document_drafter', description: 'Ask the firm drafter to prepare, format or revise a substantial legal document. A clarification, template or branding question must go to the user; pass their actual answer with the earlier drafter conversation on the next call. Preserve completed DOCX links. Consider preparing a browser preview after a completed DOCX. Simple chat-only writing does not need this tool.', inputSchema: { type: 'object', additionalProperties: false, required: ['messages'], properties: { messages: { type: 'array', minItems: 1, description: 'Relevant user and drafter messages in chronological order, ending with the user’s current request or answer.', items: { type: 'object', additionalProperties: false, required: ['role', 'content'], properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } } } } } },
  { name: 'public_web_search', description: 'Search public sources for current developments or information beyond firm holdings. Results have titles, URLs and snippets; verify a source before treating its snippet as the complete document.', inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 1 }, max_results: { type: 'integer', minimum: 1, maximum: 10 } } } },
  { name: 'prepare_document_preview', description: 'Prepare a LibreChat canvas text preview of a completed DOCX returned by the firm document drafter. Supply only its /files/...docx path. The preview is optional and supplements the DOCX download; use after the drafter has produced a final file, not during a clarification.', inputSchema: { type: 'object', additionalProperties: false, required: ['file_path'], properties: { file_path: { type: 'string', description: 'The /files/...docx path from the completed drafter download link.' } } } },
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
  const response = await fetch(`${env(base).replace(/\/$/, '')}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env(key)}` }, body: JSON.stringify({ model, messages, stream: true }), signal: AbortSignal.timeout(1200000) });
  if (!response.ok) throw Error(`Service returned HTTP ${response.status}`);
  let answer = ''; let buffer = ''; let statusBuffer = ''; let lastProgress = '';
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    buffer += done ? '\n' : decoder.decode(value, { stream: true });
    for (const line of buffer.split(/\r?\n/).slice(0, -1)) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
      let event; try { event = JSON.parse(raw); } catch { continue; }
      if (event.error) throw Error('Service reported a streaming error');
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
  return cleanAnswer;
}
async function call(name, args, token) {
  if (name === 'firm_research') return chat('DESARAM_RESEARCH_URL', 'DESARAM_RESEARCH_KEY', 'junior-de-saram-01', [{ role: 'user', content: args.context ? `${args.context}\n\n${args.question}` : args.question }], name, token);
  if (name === 'document_drafter') { if (args.messages?.at(-1)?.role !== 'user') throw Error('Last drafter message must be from the user'); return chat('DESARAM_DRAFTER_URL', 'DESARAM_DRAFTER_KEY', 'document-drafter-01-preview', args.messages, name, token); }
  if (name === 'public_web_search') { const response = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'content-type': 'application/json', 'X-API-KEY': env('SERPER_API_KEY') }, body: JSON.stringify({ q: args.query, num: args.max_results || 10 }), signal: AbortSignal.timeout(30000) }); if (!response.ok) throw Error(`Search returned HTTP ${response.status}`); const data = await response.json(); return JSON.stringify({ results: (data.organic || []).map(({ title, link, snippet, date }) => ({ title, link, snippet, date })) }); }
  if (name === 'prepare_document_preview') {
    const filePath = String(args.file_path || '');
    if (!/^\/files\/[A-Za-z0-9/_\-.]+\.docx$/.test(filePath) || filePath.includes('..')) throw Error('Expected a drafter DOCX /files path');
    const response = await fetch(`${env('DESARAM_DRAFTER_URL').replace(/\/$/, '')}${filePath}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('Completed document is unavailable');
    const size = Number(response.headers.get('content-length') || 0); if (size > 40000000) throw Error('Document is too large for preview');
    const bytes = Buffer.from(await response.arrayBuffer());
    return JSON.stringify({ artifact_markup: previewMarkup(bytes, filePath), file_path: filePath });
  }
  throw Error('Unknown tool');
}
readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => { void (async () => {
  let req; try {
    req = JSON.parse(line); if (!Object.hasOwn(req, 'id')) return;
    if (req.method === 'initialize') return output({ jsonrpc: '2.0', id: req.id, result: { protocolVersion: req.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'de-saram-legal', version: '0.2.0' } } });
    if (req.method === 'tools/list') return output({ jsonrpc: '2.0', id: req.id, result: { tools: definitions } });
    if (req.method === 'tools/call') { try { return output({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: await call(req.params.name, req.params.arguments || {}, req.params?._meta?.progressToken) }] } }); } catch (error) { return output({ jsonrpc: '2.0', id: req.id, result: { isError: true, content: [{ type: 'text', text: error.message }] } }); } }
    return output({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Method not found' } });
  } catch { return output({ jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32700, message: 'Invalid request' } }); }
})().catch((error) => console.error('[de-saram-mcp]', error.message)); });
