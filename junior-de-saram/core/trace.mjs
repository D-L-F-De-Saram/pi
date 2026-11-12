import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = () => path.resolve(process.env.JUNIOR_DE_SARAM_LOG_ROOT || './junior-de-saram/logs');
const maxBytes = Math.max(1024, Number(process.env.JUNIOR_DE_SARAM_LOG_MAX_VALUE_BYTES || 262144));
const secretKeys = /(?:^|_)(?:key|api_key|authorization|secret|password|credential|cookie|signature|access_token|refresh_token|id_token|bearer_token|token)(?:$|_)/i;
const inlineSecrets = /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{16,})\b/g;
// Stop before HTML / JSON delimiters as well as URI delimiters. Otherwise a
// signed preview URL in a logged HTML fragment could consume the following
// image tags and make an otherwise valid preview look malformed in the trace.
const querySecrets = /([?&](?:api[_-]?key|authorization|secret|token|password|signature)=)[^&#\s"'<>\\]+/gi;
const safeMetadataKeys = new Set(['conversation_key']);

function clean(value, key = '') {
  if (!safeMetadataKeys.has(key) && secretKeys.test(String(key).replace(/([a-z])([A-Z])/g, '$1_$2'))) return '[REDACTED]';
  if (typeof value === 'string') {
    let text = value;
    for (const [envKey, secret] of Object.entries(process.env)) if (secretKeys.test(envKey) && secret?.length >= 8) text = text.split(secret).join('[REDACTED]');
    text = text.replace(inlineSecrets, '[REDACTED]').replace(querySecrets, '$1[REDACTED]');
    return Buffer.byteLength(text) <= maxBytes ? text : { truncated: true, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), preview: Buffer.from(text).subarray(0, maxBytes).toString('utf8') };
  }
  if (Array.isArray(value)) return value.map((item) => clean(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, clean(item, name)]));
  return value;
}

export function createTrace({ id = `chatcmpl-${randomUUID()}`, key, query, attachments = [], model, provider, thinking }) {
  const start = Date.now();
  const stamp = new Date(start).toISOString();
  const dir = path.join(root(), 'traces', stamp.slice(0, 10), id);
  const trace = { schema_version: 1, trace: { request_id: id, session_id: `junior-de-saram-${key}`, conversation_key: `junior-de-saram-${key}`, source: 'junior-de-saram', started_at: stamp, outcome: 'running' }, request: { model, provider, thinking, original_query: clean(query), attachments: attachments.map((file) => ({ stored_path: file })) }, timeline: [], llm_calls: [], tool_calls: [], final: undefined };
  const pending = new Map();
  let queue = Promise.resolve();
  const save = (record) => { queue = queue.then(async () => { await mkdir(dir, { recursive: true }); if (record) await appendFile(path.join(dir, 'events.jsonl'), `${JSON.stringify(clean(record))}\n`); await writeFile(path.join(dir, 'trace.json'), `${JSON.stringify(clean(trace), null, 2)}\n`); }).catch((error) => console.error('[junior-de-saram][trace]', error.message)); return queue; };
  const event = (type, details = {}) => { const record = { sequence: trace.timeline.length + 1, at: new Date().toISOString(), type, ...details }; trace.timeline.push(record); return save(record); };
  event('request_started');
  return {
    event(eventData) {
      if (eventData.type === 'tool_execution_start') {
        const item = { id: eventData.toolCallId, name: eventData.toolName, started_at: new Date().toISOString(), status: 'running', request: clean(eventData.args), updates: [] };
        trace.tool_calls.push(item); pending.set(item.id, item); event('tool_started', { tool: item.name, tool_call_id: item.id });
      } else if (eventData.type === 'tool_execution_update') {
        const item = pending.get(eventData.toolCallId);
        if (item) { item.updates.push(clean(eventData.partialResult)); event('tool_updated', { tool: item.name, tool_call_id: item.id }); }
      } else if (eventData.type === 'tool_execution_end') {
        const item = pending.get(eventData.toolCallId);
        if (item) { item.status = eventData.isError ? 'error' : 'completed'; item.ended_at = new Date().toISOString(); item.duration_ms = Date.now() - Date.parse(item.started_at); item.response = clean(eventData.result); event(item.status === 'error' ? 'tool_error' : 'tool_completed', { tool: item.name, tool_call_id: item.id, duration_ms: item.duration_ms }); }
      } else if (eventData.type === 'message_end' && eventData.message?.role === 'assistant') {
        const message = eventData.message;
        trace.llm_calls.push({ at: new Date().toISOString(), provider: message.provider, model: message.model, stop_reason: message.stopReason, usage: clean(message.usage), response: clean(message) });
        event('llm_response', { provider: message.provider, model: message.model });
      }
    },
    async finish({ answer, usage, error }) {
      trace.trace.ended_at = new Date().toISOString(); trace.trace.elapsed_ms = Date.now() - start; trace.trace.outcome = error ? 'error' : 'completed';
      trace.final = clean({ answer, usage, error, artifacts: [...String(answer || '').matchAll(/https?:\/\/[^\s)]+\.(?:docx|pdf|pptx|xlsx|md|txt|json)(?:\?[^\s)]*)?/g)].map((match) => ({ download_url: match[0] })), previews: String(answer || '').includes(':::artifact{') ? [{ status: 'completed' }] : [] });
      event(error ? 'request_error' : 'request_completed', { elapsed_ms: trace.trace.elapsed_ms, tool_count: trace.tool_calls.length, llm_call_count: trace.llm_calls.length });
      await queue;
    },
  };
}
