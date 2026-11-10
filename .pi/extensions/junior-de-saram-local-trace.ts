import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createTrace } from '../../junior-de-saram/core/trace.mjs';

export default function localTrace(pi: ExtensionAPI) {
  let query = '';
  let trace: ReturnType<typeof createTrace> | undefined;
  let answer = '';
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  pi.on('input', event => { query = event.text; return { action: 'continue' }; });
  pi.on('agent_start', (_event, ctx) => {
    usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }; answer = '';
    trace = createTrace({ key: ctx.sessionManager.getSessionId(), query, model: ctx.model?.id, provider: ctx.model?.provider, thinking: process.env.PI_THINKING });
  });
  pi.on('tool_execution_start', event => trace?.event(event));
  pi.on('tool_execution_update', event => trace?.event(event));
  pi.on('tool_execution_end', event => trace?.event(event));
  pi.on('message_end', event => {
    trace?.event(event);
    if (event.message.role !== 'assistant') return;
    answer = event.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
    usage.prompt_tokens += event.message.usage.input;
    usage.completion_tokens += event.message.usage.output;
    usage.total_tokens += event.message.usage.input + event.message.usage.output;
  });
  pi.on('agent_end', async () => { await trace?.finish({ answer, usage }); trace = undefined; });
}
