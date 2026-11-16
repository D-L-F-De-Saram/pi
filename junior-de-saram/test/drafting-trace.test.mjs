import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTrace } from '../core/trace.mjs';

test('conversation trace retains the selected sample and the copied-template provenance', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'de-saram-drafting-trace-'));
  const previous = process.env.JUNIOR_DE_SARAM_LOG_ROOT;
  process.env.JUNIOR_DE_SARAM_LOG_ROOT = directory;
  try {
    const trace = createTrace({ id: 'trace-drafting-test', key: 'conversation-test', query: 'Draft a petition', model: 'test-model', provider: 'test', thinking: 'medium' });
    const calls = [
      { id: 'sample', name: 'de_saram_precedent_read', response: { source_use: 'sample_reference', source_record_id: 'sample-1', title: 'Petition sample' } },
      { id: 'template', name: 'de_saram_template_copy', response: { source_use: 'template_copy', source_record_id: 'template-1', copied_to: '/data/workspaces/conversation-test/source-templates/template.docx', sha256: 'a'.repeat(64), original_unchanged: true } },
    ];
    for (const call of calls) {
      trace.event({ type: 'tool_execution_start', toolCallId: call.id, toolName: call.name, args: { precedent_id: `firm:${call.response.source_record_id}` } });
      trace.event({ type: 'tool_execution_end', toolCallId: call.id, toolName: call.name, result: { content: [{ type: 'text', text: JSON.stringify(call.response) }] } });
    }
    await trace.finish({ answer: 'Completed', usage: { prompt_tokens: 20, completion_tokens: 10 } });
    const [date] = await readdir(path.join(directory, 'traces'));
    const data = JSON.parse(await readFile(path.join(directory, 'traces', date, 'trace-drafting-test', 'trace.json'), 'utf8'));
    assert.deepEqual(data.tool_calls.map((call) => call.name), ['de_saram_precedent_read', 'de_saram_template_copy']);
    assert.match(JSON.stringify(data.tool_calls[0].response), /sample_reference/);
    assert.match(JSON.stringify(data.tool_calls[1].response), /original_unchanged/);
  } finally {
    if (previous === undefined) delete process.env.JUNIOR_DE_SARAM_LOG_ROOT;
    else process.env.JUNIOR_DE_SARAM_LOG_ROOT = previous;
  }
});
