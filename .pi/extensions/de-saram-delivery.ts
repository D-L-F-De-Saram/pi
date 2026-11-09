import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { restoreCitations } from '../../junior-de-saram/core/citations.mjs';

export default function deSaramDelivery(pi: ExtensionAPI) {
  let research: string[] = [];
  let previews: string[] = [];
  pi.on('agent_start', () => { research = []; previews = []; });
  pi.on('tool_result', (event) => {
    if (event.isError) return;
    const text = event.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n');
    if (event.toolName.endsWith('firm_research')) research.push(text);
    if (event.toolName.endsWith('prepare_document_preview')) {
      try {
        const result = JSON.parse(text);
        if (typeof result.artifact_markup === 'string' && result.artifact_markup.startsWith(':::artifact{')) previews.push(result.artifact_markup);
      } catch { /* An unsuccessful preview never changes the legal answer. */ }
    }
  });
  pi.on('message_end', (event) => {
    if (event.message.role !== 'assistant') return;
    const text = event.message.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n');
    if (!text.trim()) return;
    let delivered = restoreCitations(text, research);
    for (const markup of previews) if (!delivered.includes(markup)) delivered += `\n\n${markup}`;
    if (delivered !== text) return { message: { ...event.message, content: [{ type: 'text', text: delivered }] } };
  });
}
