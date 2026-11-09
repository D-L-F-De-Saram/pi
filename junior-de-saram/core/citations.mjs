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

export function restoreCitations(answer, researchAnswers) {
  const previewAt = String(answer).indexOf(':::artifact{');
  const preview = previewAt >= 0 ? String(answer).slice(previewAt) : '';
  const original = (previewAt >= 0 ? String(answer).slice(0, previewAt) : String(answer)).replace(/\[\[\^([^\]]+)\]\]/g, '[^$1]');
  const body = original.replace(definition, '').trimEnd();
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
  return preview ? `${delivered.trimEnd()}\n\n${preview}` : delivered;
}
