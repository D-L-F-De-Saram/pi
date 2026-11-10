import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { restoreCitations } from '../core/citations.mjs';
import { createTrace } from '../core/trace.mjs';
import { startChatStream, streamChatDelta as delta, finishChatStream as finish } from '../core/chat-stream.mjs';
import { runtimeArgs } from '../core/runtime.mjs';
import { artifactDownload, workspaceRoot } from '../core/artifacts.mjs';
import { sourceCitationText } from '../core/source-citations.mjs';

const port = Number(process.env.JUNIOR_DE_SARAM_PORT || 8160);
const modelName = process.env.JUNIOR_DE_SARAM_MODEL_NAME || 'junior-de-saram-pi';
const sessions = path.resolve(process.env.JUNIOR_DE_SARAM_SESSION_DIR || './junior-de-saram/sessions');
const cli = path.resolve('./packages/coding-agent/dist/bundle/cli.js');
const serial = new Map();

function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function authorised(req) { const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, '')); const expected = Buffer.from(process.env.JUNIOR_DE_SARAM_API_KEY || ''); return !!expected.length && given.length === expected.length && timingSafeEqual(given, expected); }
function textOf(content) { return typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n') : ''; }
function signedPath(filePath) { return createHmac('sha256', process.env.JUNIOR_DE_SARAM_API_KEY).update(filePath).digest('hex'); }
function localDownloads(text) { return text.replace(/https:\/\/www\.dev\.desaram\.ai(\/files\/[A-Za-z0-9/_\-.]+\.docx)/g, (_, filePath) => `${process.env.JUNIOR_DE_SARAM_PUBLIC_URL || 'http://127.0.0.1:8160'}${filePath}?token=${signedPath(filePath)}`); }
async function download(req, res) {
  const url = new URL(req.url, 'http://localhost'); const filePath = url.pathname;
  if (!/^\/files\/[A-Za-z0-9/_\-.]+\.docx$/.test(filePath) || filePath.includes('..')) return json(res, 404, { error: { message: 'Not found' } });
  const supplied = Buffer.from(url.searchParams.get('token') || ''); const expected = Buffer.from(signedPath(filePath));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json(res, 403, { error: { message: 'Forbidden' } });
  const upstream = await fetch(`${process.env.DESARAM_DRAFTER_URL}${filePath}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!upstream.ok) return json(res, 502, { error: { message: 'Document unavailable' } });
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (bytes.length > 50000000) return json(res, 502, { error: { message: 'Document too large' } });
  res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-length': bytes.length, 'content-disposition': `attachment; filename="${filePath.split('/').at(-1)}"` }); res.end(bytes);
}
function labelForTool(name) {
  if (/legal_source_retrieve_details$/.test(name)) return 'Reading the selected records and passages from the firm’s indexed sources…';
  if (/workbench_publish_artifact$/.test(name)) return 'Preparing the completed file for download and preview…';
  if (/code_runner_data_transform$/.test(name)) return 'Calculating and checking the legal work data…';
  if (/^(bash|write|edit)$/.test(name)) return 'Creating the requested legal work product and checking its output…';
  if (/^(read|grep|find|ls)$/.test(name)) return 'Reading the relevant material and document instructions…';
  if (/firm_research$/.test(name)) return 'Searching the firm’s knowledge base and checking legal sources…';
  if (/document_drafter$/.test(name)) return 'Preparing the requested legal document with the firm drafter…';
  if (/public_web_search$/.test(name)) return 'Checking current public sources for relevant developments…';
  if (/prepare_document_preview$/.test(name)) return 'Preparing a preview of the completed document…';
  return 'Checking the legal work before responding…';
}
function citedResult(event) { return textOf(event.result?.content || event.result?.message?.content || event.result); }
function structuredResult(event) {
  const value = event.result?.structuredContent || event.result?.message?.structuredContent;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const nested = value.structuredContent;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : value;
}
function previewResult(event) {
  const structured = structuredResult(event);
  if (typeof structured?.artifact_markup === 'string') return structured;
  try { return JSON.parse(citedResult(event)); } catch { return undefined; }
}
function thoughtController(send) {
  let phase = 'request'; let since = Date.now(); let last = ''; const emitted = new Set(); const milestones = new Set();
  const publish = (message) => { if (message !== last) { last = message; send(message); } };
  return {
    event(event) {
      if (event.type === 'agent_start') { if (!emitted.has('start')) { emitted.add('start'); publish('I’m reviewing your request and planning the legal work…'); } }
      if (event.type === 'tool_execution_start') { phase = event.toolName || 'legal work'; since = Date.now(); milestones.clear(); if (!emitted.has(phase)) { emitted.add(phase); publish(labelForTool(phase)); } }
      if (event.type === 'tool_execution_end' && event.isError) publish('A source or document step needs another approach. I’m checking the available options…');
      if (event.type === 'tool_execution_end' && !event.isError && /firm_research$/.test(event.toolName || '')) publish('The firm’s researcher has returned source material; I’m checking its cited authorities…');
    },
    tick() { const elapsed = Date.now() - since; const milestone = [20000, 60000, 120000].find((n) => elapsed >= n && !milestones.has(n)); if (!milestone) return; milestones.add(milestone); const subject = /document_drafter|preview/.test(phase) ? 'document' : /research|web_search/.test(phase) ? 'source check' : 'legal work'; publish(milestone === 20000 ? `The ${subject} is still being prepared…` : milestone === 60000 ? `The ${subject} is taking longer than usual; I’m continuing the checks…` : `Still working on the ${subject}; I’ll continue when this step finishes…`); },
  };
}
async function run(body, sessionId, onProgress, trace) {
  await mkdir(sessions, { recursive: true });
  const workspace = path.join(workspaceRoot(), sessionId);
  await mkdir(workspace, { recursive: true });
  const provider = process.env.PI_PROVIDER || 'google'; const model = process.env.PI_MODEL || 'gemini-3.7-flash';
  const user = [...(body.messages || [])].reverse().find((item) => item.role === 'user'); if (!user) throw Error('Missing user message');
  const args = [cli, '--mode', 'json', '--session-id', sessionId, '--session-dir', sessions, ...runtimeArgs(), `Use this conversation workspace for generated files: ${workspace}\n\nUser request:\n${textOf(user.content)}`];
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env, PI_SKIP_VERSION_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const thoughts = thoughtController(onProgress); const ticker = setInterval(() => thoughts.tick(), 5000); ticker.unref();
  let stderr = ''; child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-4000); });
  let answer = ''; const research = []; const previews = []; let deliverablePrepared = false; let researchFailed = false; const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const lines = readline.createInterface({ input: child.stdout });
  const closed = new Promise((resolve) => child.on('close', resolve));
  for await (const line of lines) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    trace?.event(event); thoughts.event(event);
    if (event.type === 'tool_execution_end' && event.isError && /firm_research$|legal_source_retrieve_details$/.test(event.toolName || '')) researchFailed = true;
    if (event.type === 'tool_execution_end' && !event.isError) {
      const name = event.toolName || '';
      if (/firm_research$/.test(name)) research.push(citedResult(event));
      if (/legal_source_retrieve_details$/.test(name)) research.push(sourceCitationText(citedResult(event)));
      if (/prepare_document_preview$|workbench_publish_artifact$/.test(name)) { const preview = previewResult(event); if (typeof preview?.artifact_markup === 'string' && preview.artifact_markup.startsWith(':::artifact{')) previews.push(preview.artifact_markup); deliverablePrepared = true; }
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const message = event.message; const content = textOf(message.content);
      if (content.trim()) answer = content;
      if (message.usage) { usage.prompt_tokens += Number(message.usage.input || 0); usage.completion_tokens += Number(message.usage.output || 0); usage.total_tokens += Number(message.usage.input || 0) + Number(message.usage.output || 0); }
    }
  }
  const code = await closed; clearInterval(ticker);
  if (code !== 0 || !answer.trim()) throw Error(`Pi did not complete this request (${code}); ${stderr.slice(-300)}`);
  if (researchFailed && !research.length && !deliverablePrepared) answer = 'I could not reach the firm’s legal sources for this request, so I cannot give a sourced answer yet. Please retry once the research service is connected.';
  answer = restoreCitations(answer, research, { fallbackToResearch: !deliverablePrepared });
  for (const markup of previews) if (!answer.includes(markup)) answer += `\n\n${markup}`;
  return { answer: localDownloads(answer), usage };
}
function inConversation(key, task) { const previous = serial.get(key) || Promise.resolve(); const next = previous.catch(() => undefined).then(task); serial.set(key, next); next.finally(() => { if (serial.get(key) === next) serial.delete(key); }).catch(() => undefined); return next; }

const server = createServer(async (req, res) => {
  if (req.url === '/health') return json(res, 200, { ok: true, model: modelName });
  if (req.method === 'GET' && req.url?.startsWith('/artifacts/')) { try { return await artifactDownload(req, res); } catch { return json(res, 404, { error: { message: 'Artifact unavailable' } }); } }
  if (req.method === 'GET' && req.url?.startsWith('/files/')) { try { return await download(req, res); } catch { return json(res, 502, { error: { message: 'Document unavailable' } }); } }
  if (!authorised(req)) return json(res, 401, { error: { message: 'Unauthorized' } });
  if (req.method === 'GET' && req.url === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: modelName, object: 'model' }] });
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: { message: 'Not found' } });
  let trace; let heartbeat;
  try {
    let raw = ''; for await (const part of req) { raw += part; if (raw.length > 2000000) throw Error('Request too large'); }
    const body = JSON.parse(raw); const key = String(req.headers['x-librechat-conversation-id'] || body.conversation_id || randomUUID()).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
    const id = `chatcmpl-${randomUUID()}`; const user = [...(body.messages || [])].reverse().find((item) => item.role === 'user');
    trace = createTrace({ id, key, query: textOf(user?.content), model: modelName, provider: process.env.PI_PROVIDER || 'google', thinking: process.env.PI_THINKING || 'low' });
    const streaming = body.stream === true;
    if (streaming) { startChatStream(res, id); heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000); }
    const onProgress = (message) => { if (streaming) delta(res, id, 'reasoning_content', `${message}\n`); };
    const result = await inConversation(key, () => run(body, key, onProgress, trace));
    await trace.finish({ answer: result.answer, usage: result.usage }); clearInterval(heartbeat);
    if (streaming) finish(res, id, result.answer, body.stream_options?.include_usage ? result.usage : undefined);
    else json(res, 200, { id, object: 'chat.completion', model: modelName, choices: [{ index: 0, message: { role: 'assistant', content: result.answer }, finish_reason: 'stop' }], usage: result.usage });
  } catch (error) {
    clearInterval(heartbeat); await trace?.finish({ error: error.message }); console.error('[junior-de-saram]', error.message);
    const message = 'Junior De Saram could not complete this request. Please retry or contact the administrator.';
    if (res.headersSent) { if (!res.writableEnded) { delta(res, `chatcmpl-${randomUUID()}`, 'content', message); res.end('data: [DONE]\n\n'); } }
    else json(res, 500, { error: { message, type: 'server_error' } });
  }
});
server.listen(port, '0.0.0.0', () => console.log(`junior-de-saram listening on ${port}`));
