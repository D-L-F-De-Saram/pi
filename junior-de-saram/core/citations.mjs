// Restore only source links actually cited in Pi's final answer.
const definition = /^\[\^([^\]]+)\]:\s*(.+(?:\n(?!\[\^)[ \t]+.+)*)$/gm;

export function sourceDefinitions(answer) {
  const found = [];
  for (const match of String(answer).matchAll(definition)) {
    const links = [...match[2].matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+(?:\([^)]*\)[^\s)]*)*)\)/g)];
    if (links.length) found.push({ id: match[1], text: match[2].trim(), links: links.map((link) => ({ name: link[1], url: link[2] })) });
  }
  return found;
}

function sourceAnswerWithFootnotes(researchAnswers) {
  const candidates = researchAnswers.map((answer) => String(answer || '').trim()).filter((answer) => {
    const body = answer.replace(definition, '').trim();
    return /\[\^[^\]]+\]/.test(body) && sourceDefinitions(answer).length > 0;
  });
  // Research calls number their footnotes independently. Give each response
  // its own section and renumber every reference before combining them.
  let next = 1;
  const sections = candidates.map((answer, index) => {
    const sources = sourceDefinitions(answer);
    const ids = new Map(sources.map((source) => [source.id, String(next++)]));
    const body = answer.replace(definition, '').trim().replace(/\[\^([^\]]+)\]/g, (match, id) => ids.has(id) ? `[^${ids.get(id)}]` : match);
    const refs = sources.map((source) => `[^${ids.get(source.id)}]: ${source.text}`).join('\n');
    return `${candidates.length > 1 ? `## Firm research ${index + 1}\n\n` : ''}${body}\n\n${refs}`;
  });
  return sections.join('\n\n');
}

// LibreChat's markdown renderer does not reliably resolve footnote definitions.
// Link the numbered citation at the claim itself while retaining the firm's
// numbered reference list below the answer.
export function linkNumberedCitations(answer) {
  const sources = sourceDefinitions(answer);
  const byId = new Map(sources.map((source) => [source.id, source.links[0]?.url]));
  return String(answer).replace(definition, '').replace(/\[\^([^\]]+)\]/g, (match, id) => byId.has(id) ? `[[${id}]](${byId.get(id)})` : match)
    .trimEnd() + (sources.length ? `\n\n### References\n\n${sources.map((source) => `${source.id}. ${source.text}`).join('\n')}` : '');
}

export function restoreCitations(answer, researchAnswers, { fallbackToResearch = false } = {}) {
  const previewAt = String(answer).indexOf(':::artifact{');
  const preview = previewAt >= 0 ? String(answer).slice(previewAt) : '';
  const original = (previewAt >= 0 ? String(answer).slice(0, previewAt) : String(answer)).replace(/\[\[\^([^\]]+)\]\]/g, '[^$1]');
  const body = original.replace(definition, '').trimEnd();
  if (fallbackToResearch && !/\[\^[^\]]+\]/.test(body)) {
    const sourceAnswer = sourceAnswerWithFootnotes(researchAnswers);
    if (sourceAnswer) return preview ? `${linkNumberedCitations(sourceAnswer)}\n\n${preview}` : linkNumberedCitations(sourceAnswer);
  }
  const existing = new Set(sourceDefinitions(original).map((source) => source.id));
  const sources = researchAnswers.flatMap(sourceDefinitions);
  const additions = [];
  for (const id of [...new Set([...body.matchAll(/\[\^([^\]]+)\]/g)].map((match) => match[1]))]) {
    if (existing.has(id)) continue;
    const candidates = sources.filter((source) => source.id === id);
    // Two research calls may independently number different sources [^1].
    // In that case, never attach an arbitrary source to the model's claim.
    const urls = new Set(candidates.map((source) => source.links.map((link) => link.url).join('|')));
    if (urls.size === 1 && candidates.length) additions.push(`[^${id}]: ${candidates[0].text}`);
  }
  // Named sources can be linked even when the model omitted footnote markers.
  let linked = body;
  const namedLinks = new Map();
  for (const source of sources) for (const link of source.links) {
    const urls = namedLinks.get(link.name) || new Set();
    urls.add(link.url); namedLinks.set(link.name, urls);
  }
  for (const source of sources) {
    for (const { name, url } of source.links) {
      if (name.length < 8 || namedLinks.get(name)?.size !== 1 || linked.includes(url)) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      linked = linked.replace(new RegExp(`(?<!\\[)\\b${escaped}\\b(?!\\])`, 'i'), (match) => `[${match}](${url})`);
    }
  }
  const preserved = [...original.matchAll(definition)].map((match) => `[^${match[1]}]: ${match[2].trim()}`);
  const all = [...preserved, ...additions];
  const delivered = all.length ? `${linked}\n\n${all.join('\n')}` : linked;
  const linkedAnswer = linkNumberedCitations(delivered);
  return preview ? `${linkedAnswer.trimEnd()}\n\n${preview}` : linkedAnswer;
}
