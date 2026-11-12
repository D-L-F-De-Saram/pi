import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { restoreCitations } from '../../junior-de-saram/core/citations.mjs';
import { publicCitationText, sourceCitationText } from '../../junior-de-saram/core/source-citations.mjs';

type Artifact = { download_url?: unknown };

function structured(event: ToolResultEvent): Record<string, unknown> | undefined {
  if (event.isError || !event.structuredContent || typeof event.structuredContent !== 'object' || Array.isArray(event.structuredContent)) return undefined;
  const outer = event.structuredContent as Record<string, unknown>;
  const nested = outer.structuredContent;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested as Record<string, unknown> : outer;
}

function previewResults(event: ToolResultEvent): string[] {
  const value = structured(event);
  if (!value) return [];
  const values = [value.artifact_markup, ...(Array.isArray(value.artifact_markups) ? value.artifact_markups : [])];
  return values.filter((markup): markup is string => typeof markup === 'string' && markup.startsWith(':::artifact{'));
}

function artifactRows(event: ToolResultEvent): Array<{ label: string; url: string }> {
  const value = structured(event);
  if (!value) return [];
  const artifact = value.artifact && typeof value.artifact === 'object' ? value.artifact as Artifact : undefined;
  const url = typeof artifact?.download_url === 'string' ? artifact.download_url : '';
  return /^https?:\/\//i.test(url) ? [{ label: 'Download completed file', url }] : [];
}

function isPreviewTool(name: string) {
  return ['prepare_document_preview', 'workbench_publish_artifact'].some((tool) => name === tool || name.endsWith(`/${tool}`) || name.endsWith(`__${tool}`));
}

function removeUntrustedHtmlPreview(text: string) {
  // Only renderer-produced :::artifact markup may drive the LibreChat canvas.
  return text.replace(/:::artifact\{[\s\S]*?\n:::/g, '').replace(/<!doctype\s+html[\s\S]*?<\/html>/gi, '')
    .split('\n').filter((line) => !/(?:local_path|file_uri|\/data\/(?:artifacts|uploads|workspace)|\/app\/)/i.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Pi chooses whether a preview is useful. If it does, this extension delivers
// the renderer-generated markup verbatim rather than asking the model to copy
// signed image URLs from a tool response.
export default function deSaramDelivery(pi: ExtensionAPI) {
  let research: string[] = [];
  let pending: string[] = [];
  let downloads: Array<{ label: string; url: string }> = [];
  let deliverablePrepared = false;
  let sourceCall = 0;
  pi.on('agent_start', () => { research = []; pending = []; downloads = []; deliverablePrepared = false; sourceCall = 0; });
  pi.on('tool_result', (event) => {
    if (event.isError) return;
    const text = event.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n');
    if (event.toolName.endsWith('firm_research')) research.push(text);
    if (event.toolName.endsWith('legal_source_retrieve_details')) research.push(sourceCitationText(text, `db-${++sourceCall}`));
    if (event.toolName.endsWith('public_web_search') || event.toolName.endsWith('deep_public_web_research')) research.push(publicCitationText(text, `public-${++sourceCall}`));
    if (!isPreviewTool(event.toolName)) return;
    deliverablePrepared = true;
    for (const markup of previewResults(event)) if (!pending.includes(markup)) pending.push(markup);
    for (const row of artifactRows(event)) if (!downloads.some((item) => item.url === row.url)) downloads.push(row);
  });
  pi.on('message_end', (event) => {
    if (event.message.role !== 'assistant') return;
    const text = event.message.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n');
    if (!text.trim()) return;
    const answer = restoreCitations(text, research, { fallbackToResearch: !deliverablePrepared });
    const safeText = removeUntrustedHtmlPreview(answer);
    const links = downloads.filter((item) => !safeText.includes(item.url)).map((item) => `- [${item.label}](${item.url})`);
    const delivery = links.length ? `## Files\n\n${links.join('\n')}` : '';
    const previews = pending.filter((markup) => !safeText.includes(markup)).join('\n\n');
    const delivered = [safeText, delivery, previews].filter(Boolean).join('\n\n').trim();
    if (delivered !== text) return { message: { ...event.message, content: [{ type: 'text', text: delivered }] } };
  });
}
