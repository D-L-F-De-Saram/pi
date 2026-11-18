import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { restoreCitations } from '../core/citations.mjs';
import { createTrace } from '../core/trace.mjs';
import { startChatStream, streamChatDelta as delta, finishChatStream as finish } from '../core/chat-stream.mjs';
import { runtimeArgs } from '../core/runtime.mjs';
import { artifactDownload } from '../core/artifacts.mjs';
import { publicCitationText, sourceCitationText } from '../core/source-citations.mjs';
import { conversationUploadPaths, fileCandidates, piPrompt, saveUploads, textUploads } from '../core/uploads.mjs';
import { syncCatalog } from '../core/drafting-catalog.mjs';
import { createChatFolders, currentChat, resolveChatScope, runInChat } from '../core/chat-scope.mjs';
import { loadModelChoices, modelChoice, piModelsCatalog } from './model-choice.mjs';
import { createSlotPool, piAddress, startContainerPi, startLocalPi } from './pi-executor.mjs';
import { createRunToken, revokeRunToken } from './run-tokens.mjs';
import { arrivedOnPiNetwork, startGateway } from './gateway.mjs';

const port = Number(process.env.JUNIOR_DE_SARAM_PORT || 8160);
const modelName = process.env.JUNIOR_DE_SARAM_MODEL_NAME || 'junior-de-saram-pi';
const cli = path.resolve('./packages/coding-agent/dist/bundle/cli.js');
const serial = new Map();
const executor = process.env.DS_PI_EXECUTOR || 'container';
if (!['container', 'local'].includes(executor)) throw Error('DS_PI_EXECUTOR must be container or local');
if (executor === 'local' && process.env.DS_ALLOW_LOCAL_PI !== '1') throw Error('Local Pi runs beside service credentials; set DS_ALLOW_LOCAL_PI=1 only for single-developer use');
if (String(process.env.DS_IDENTITY_SECRET || '').length < 32 || String(process.env.JUNIOR_DE_SARAM_ARTIFACT_SECRET || '').length < 32) throw Error('Identity and artifact signing secrets must each be at least 32 characters');
const choices = loadModelChoices();
const slotCount = Number(process.env.DS_SLOTS || 3);
if (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > 254) throw Error('DS_SLOTS must be between 1 and 254');
const slotPool = createSlotPool(slotCount, Number(process.env.DS_SLOT_WAIT_MS || 300000));
const runnerUrl = process.env.DS_RUNNER_URL || '';
const runnerSecret = process.env.DS_RUNNER_SECRET || '';
if (executor === 'container' && (!/^http:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/.test(runnerUrl) || runnerSecret.length < 32)) throw Error('A private runner URL and secret are required');

function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function authorised(req) { const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, '')); const expected = Buffer.from(process.env.JUNIOR_DE_SARAM_API_KEY || ''); return !!expected.length && given.length === expected.length && timingSafeEqual(given, expected); }
function textOf(content) { return typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n') : ''; }
function signedPath(filePath, userHash, chatHash, expiresAt) {
  return createHmac('sha256', process.env.JUNIOR_DE_SARAM_ARTIFACT_SECRET).update(['draft', filePath, userHash, chatHash, expiresAt].join('\0')).digest('hex');
}
function localDownloads(text, allowedPaths) {
  const { userHash, chatHash } = currentChat();
  const expiresAt = Math.floor(Date.now() / 1000) + Number(process.env.DS_LINK_TTL_HOURS || 168) * 3600;
  return text.replace(/https:\/\/www\.dev\.desaram\.ai(\/files\/[A-Za-z0-9/_\-.]+\.docx)/g, (fullUrl, filePath) => {
    if (!allowedPaths.has(filePath)) return fullUrl;
    const url = new URL(`${process.env.JUNIOR_DE_SARAM_PUBLIC_URL || 'http://127.0.0.1:8160'}${filePath}`);
    url.searchParams.set('user', userHash);
    url.searchParams.set('chat', chatHash);
    url.searchParams.set('exp', String(expiresAt));
    url.searchParams.set('token', signedPath(filePath, userHash, chatHash, String(expiresAt)));
    return url.href;
  });
}
async function download(req, res) {
  const url = new URL(req.url, 'http://localhost'); const filePath = url.pathname;
  if (!/^\/files\/[A-Za-z0-9/_\-.]+\.docx$/.test(filePath) || filePath.includes('..')) return json(res, 404, { error: { message: 'Not found' } });
  const userHash = url.searchParams.get('user') || '';
  const chatHash = url.searchParams.get('chat') || '';
  const expiresAt = url.searchParams.get('exp') || '';
  if (!/^[a-f0-9]{32}$/.test(userHash) || !/^[a-f0-9]{32}$/.test(chatHash) || !/^\d{10}$/.test(expiresAt)) return json(res, 404, { error: { message: 'Not found' } });
  if (Number(expiresAt) * 1000 <= Date.now()) return json(res, 410, { error: { message: 'Link expired' } });
  const supplied = Buffer.from(url.searchParams.get('token') || ''); const expected = Buffer.from(signedPath(filePath, userHash, chatHash, expiresAt));
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
  if (/de_saram_precedent_search$/.test(name)) return 'Searching the firm’s drafting catalog for a suitable source…';
  if (/de_saram_precedent_read$/.test(name)) return 'Reading the selected drafting source…';
  if (/de_saram_template_copy$/.test(name)) return 'Copying a verified template before filling this draft…';
  if (/de_saram_validate_draft$/.test(name)) return 'Checking the completed draft for gaps and placeholders…';
  if (/public_web_search$/.test(name)) return 'Checking current public sources for relevant developments…';
  if (/deep_public_web_research$/.test(name)) return 'Comparing public sources and reading the relevant passages…';
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
    tick() { const elapsed = Date.now() - since; const milestone = [20000, 60000, 120000].find((n) => elapsed >= n && !milestones.has(n)); if (!milestone) return; milestones.add(milestone); const subject = /precedent|validate_draft|preview/.test(phase) ? 'document' : /research|web_search/.test(phase) ? 'source check' : 'legal work'; publish(milestone === 20000 ? `The ${subject} is still being prepared…` : milestone === 60000 ? `The ${subject} is taking longer than usual; I’m continuing the checks…` : `Still working on the ${subject}; I’ll continue when this step finishes…`); },
  };
}
async function run(chat, requestId, prompt, onProgress, trace, choice, signal) {
  const sessionId = `junior-de-saram-${chat.chatHash}`;
  const workspace = path.join(chat.folders.workspace, 'requests', requestId);
  const timeoutMs = Number(process.env.DS_RUN_TIMEOUT_MS || process.env.JUNIOR_DE_SARAM_PI_TIMEOUT_MS || 1200000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) throw Error('DS_RUN_TIMEOUT_MS must be between 1000 and 3600000');
  let slot; let runToken; let pi;
  try {
    signal.throwIfAborted();
    if (executor === 'container') {
      slot = await slotPool.take(signal);
      runToken = createRunToken({ ...chat, requestWorkspace: workspace }, timeoutMs, piAddress(slot), { provider: choice.provider, id: choice.model });
      pi = startContainerPi({ runnerUrl, runnerSecret, run: { requestId, userHash: chat.userHash, chatHash: chat.chatHash, slot, runToken, provider: choice.provider, model: choice.model, thinking: choice.thinking }, prompt: piPrompt(prompt.instruction, prompt.files, workspace) });
    } else {
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      pi = startLocalPi({ command: process.execPath, args: [cli, '--mode', 'json', '--session-id', sessionId, '--session-dir', chat.folders.sessions, ...runtimeArgs({ provider: choice.provider, model: choice.model, thinking: choice.thinking })], cwd: process.cwd(), environment: { ...process.env, DS_NATIVE_DEV: '1', JUNIOR_DE_SARAM_ACTIVE_WORKSPACE: workspace }, prompt: piPrompt(prompt.instruction, prompt.files, workspace) });
    }
    const abortRun = () => pi.stop();
    signal.addEventListener('abort', abortRun, { once: true });
    const timer = setTimeout(abortRun, timeoutMs);
    try {
      return await collectRun(pi, onProgress, trace);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abortRun);
    }
  } finally {
    if (runToken) revokeRunToken(runToken);
    if (slot) slotPool.release(slot);
  }
}

async function collectRun(pi, onProgress, trace) {
  const thoughts = thoughtController(onProgress); const ticker = setInterval(() => thoughts.tick(), 5000); ticker.unref();
  let answer = ''; const research = []; const previews = []; const trustedDraftPaths = new Set(); let deliverablePrepared = false; let researchFailed = false; let sourceCall = 0; const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const lines = readline.createInterface({ input: pi.stdout });
  for await (const line of lines) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    trace?.event(event); thoughts.event(event);
    if (event.type === 'tool_execution_end' && event.isError && /firm_research$|legal_source_retrieve_details$/.test(event.toolName || '')) researchFailed = true;
    if (event.type === 'tool_execution_end' && !event.isError) {
      const name = event.toolName || '';
      if (/firm_research$/.test(name)) research.push(citedResult(event));
      if (/legal_source_retrieve_details$/.test(name)) research.push(sourceCitationText(citedResult(event), `db-${++sourceCall}`));
      if (/public_web_search$|deep_public_web_research$/.test(name)) research.push(publicCitationText(citedResult(event), `public-${++sourceCall}`));
      if (/de_saram_document_drafter$/.test(name)) {
        for (const match of citedResult(event).matchAll(/https:\/\/www\.dev\.desaram\.ai(\/files\/[A-Za-z0-9/_\-.]+\.docx)/g)) trustedDraftPaths.add(match[1]);
      }
      if (/prepare_document_preview$|workbench_publish_artifact$/.test(name)) { const preview = previewResult(event); if (typeof preview?.artifact_markup === 'string' && preview.artifact_markup.startsWith(':::artifact{')) previews.push(preview.artifact_markup); deliverablePrepared = true; }
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      const message = event.message; const content = textOf(message.content);
      if (content.trim()) answer = content;
      if (message.usage) { usage.prompt_tokens += Number(message.usage.input || 0); usage.completion_tokens += Number(message.usage.output || 0); usage.total_tokens += Number(message.usage.input || 0) + Number(message.usage.output || 0); }
    }
  }
  const ending = await pi.done; clearInterval(ticker);
  if (ending.exitCode !== 0 || !answer.trim()) throw Error(`Pi did not complete this request (${ending.exitCode ?? ending.reason})`);
  if (researchFailed && !research.length && !deliverablePrepared) answer = 'I could not reach the firm’s legal sources for this request, so I cannot give a sourced answer yet. Please retry once the research service is connected.';
  answer = restoreCitations(answer, research, { fallbackToResearch: !deliverablePrepared });
  for (const markup of previews) if (!answer.includes(markup)) answer += `\n\n${markup}`;
  return { answer: localDownloads(answer, trustedDraftPaths), usage };
}
function inConversation(key, task) { const previous = serial.get(key) || Promise.resolve(); const next = previous.catch(() => undefined).then(task); serial.set(key, next); next.finally(() => { if (serial.get(key) === next) serial.delete(key); }).catch(() => undefined); return next; }

const server = createServer(async (req, res) => {
  if (arrivedOnPiNetwork(req.socket.localAddress)) return json(res, 403, { error: { message: 'Not allowed' } });
  if (req.url === '/health') return json(res, 200, { ok: true, model: modelName });
  if (req.method === 'GET' && req.url?.startsWith('/artifacts/')) { try { return await artifactDownload(req, res); } catch { return json(res, 404, { error: { message: 'Artifact unavailable' } }); } }
  if (req.method === 'GET' && req.url?.startsWith('/files/')) { try { return await download(req, res); } catch { return json(res, 502, { error: { message: 'Document unavailable' } }); } }
  if (!authorised(req)) return json(res, 401, { error: { message: 'Unauthorized' } });
  if (req.method === 'GET' && req.url === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: modelName, object: 'model' }] });
  if (req.method === 'GET' && req.url === '/v1/pi/models') return json(res, 200, piModelsCatalog(choices));
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: { message: 'Not found' } });
  let trace; let heartbeat;
  const stop = new AbortController();
  res.once('close', () => stop.abort());
  try {
    const chunks = []; let bodySize = 0;
    const maxBody = Number(process.env.JUNIOR_DE_SARAM_MAX_BODY_BYTES || 60 * 1024 * 1024);
    for await (const part of req) { bodySize += part.length; if (bodySize > maxBody) { const error = Error('Request exceeds the configured upload limit'); error.status = 413; throw error; } chunks.push(part); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const scope = resolveChatScope(req.headers, body);
    const choice = modelChoice(req.headers, choices);
    const uploads = textUploads(body.messages || []);
    const candidates = fileCandidates(body);
    if (!uploads.instruction && !uploads.files.length && !candidates.length) return json(res, 400, { error: { message: 'A user message or document is required' } });
    const id = `chatcmpl-${randomUUID()}`;
    const streaming = body.stream === true;
    if (streaming) { startChatStream(res, id); heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000); }
    const onProgress = (message) => { if (streaming) delta(res, id, 'reasoning_content', `${message}\n`); };
    const result = await inConversation(scope.chatHash, async () => {
      stop.signal.throwIfAborted();
      const chat = { ...scope, folders: await createChatFolders(scope) };
      return runInChat(chat, async () => {
        const files = await saveUploads(chat.folders.uploads, candidates, uploads.files);
        trace = createTrace({ id, key: scope.chatHash, userHash: scope.userHash, query: uploads.instruction, attachments: await conversationUploadPaths(chat.folders.uploads), model: choice.model, provider: choice.provider, thinking: choice.thinking });
        return run(chat, id, { instruction: uploads.instruction, files }, onProgress, trace, choice, stop.signal);
      });
    });
    await trace.finish({ answer: result.answer, usage: result.usage }); clearInterval(heartbeat);
    if (streaming) finish(res, id, result.answer, body.stream_options?.include_usage ? result.usage : undefined);
    else json(res, 200, { id, object: 'chat.completion', model: modelName, choices: [{ index: 0, message: { role: 'assistant', content: result.answer }, finish_reason: 'stop' }], usage: result.usage });
  } catch (error) {
    clearInterval(heartbeat); await trace?.finish({ error: error.message }); console.error('[junior-de-saram]', error.message);
    const message = 'Junior De Saram could not complete this request. Please retry or contact the administrator.';
    if (res.headersSent) { if (!res.writableEnded) { delta(res, `chatcmpl-${randomUUID()}`, 'content', message); res.end('data: [DONE]\n\n'); } }
    else json(res, error.status || 500, { error: { message: error.status === 413 ? error.message : message, type: 'server_error' } });
  }
});
await startGateway();
server.listen(port, '0.0.0.0', () => {
  console.log(`junior-de-saram listening on ${port}`);
  const refresh = () => syncCatalog().then((result) => console.log('[de-saram-catalog]', JSON.stringify(result))).catch((error) => console.error('[de-saram-catalog]', error.message));
  setTimeout(refresh, 10000).unref();
  setInterval(refresh, 10 * 60 * 1000).unref();
});
