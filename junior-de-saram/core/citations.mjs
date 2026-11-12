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
  const byId = new Map(sources.map((source) => [source.id, source]));
  const numbered = new Map();
  const references = [];
  const body = String(answer).replace(definition, '').replace(/\[\^([^\]]+)\]/g, (match, id) => {
    const source = byId.get(id);
    if (!source?.links[0]) return match;
    if (!numbered.has(id)) {
      numbered.set(id, numbered.size + 1);
      references.push(`${numbered.get(id)}. ${source.text}`);
    }
    return `[[${numbered.get(id)}]](${source.links[0].url})`;
  }).trimEnd();
  return body + (references.length ? `\n\n### References\n\n${references.join('\n')}` : '');
}

function gazetteNumber(source) {
  const link = source.links[0];
  if (!link) return undefined;
  let filename;
  try { filename = decodeURIComponent(new URL(link.url).pathname.split('/').at(-1)); } catch { return undefined; }
  if (!/\.pdf$/i.test(filename)) return undefined;
  const match = filename.match(/(?:gazette(?:\s+extraordinary)?(?:\s+no\.?)?|no\.?)\s*([12]\d{3})\s*[/_ -]?\s*(\d{1,3})(?!\d)/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

export function restoreCitations(answer, researchAnswers, { fallbackToResearch = false } = {}) {
  const previewAt = String(answer).indexOf(':::artifact{');
  const preview = previewAt >= 0 ? String(answer).slice(previewAt) : '';
  const original = (previewAt >= 0 ? String(answer).slice(0, previewAt) : String(answer)).replace(/\[\[\^([^\]]+)\]\]/g, '[^$1]');
  const body = original.replace(definition, '').trimEnd();
  if ((/^### References\s*$/m.test(body) && /\[\[\d+\]\]\(https?:\/\/[^)]+\)/.test(body)) ||
      (/^### Sources consulted\s*$/m.test(body) && /^1\. \[[^\]]+\]\(https?:\/\/[^)]+\)/m.test(body))) {
    return preview ? `${body}\n\n${preview}` : body;
  }
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
  // Convert source links in the answer into numbered references, while keeping
  // artifact downloads as downloads rather than legal citations.
  let linked = body;
  const synthetic = [];
  let nextSynthetic = 0;
  linked = linked.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, name, url) => {
    if (/\/artifacts\/|\/files\//i.test(url) || /^\[?\d+\]?$/.test(name)) return match;
    const id = `answer-source-${++nextSynthetic}`;
    synthetic.push(`[^${id}]: [${name}](${url})`);
    return `${name}[^${id}]`;
  });
  // A uniquely named source can be cited where the final answer mentions it
  // even if the model omitted the source URL.
  const namedLinks = new Map();
  for (const source of sources) for (const link of source.links) {
    const urls = namedLinks.get(link.name) || new Set();
    urls.add(link.url); namedLinks.set(link.name, urls);
  }
  const citedUrls = new Set();
  const genericNames = new Set(['price controls', 'legislation', 'guidelines', 'announcements', 'home', 'nmra', 'post']);
  for (const source of sources) {
    for (const { name, url } of source.links) {
      if (name.length < 8 || genericNames.has(name.trim().toLowerCase()) || namedLinks.get(name)?.size !== 1 || citedUrls.has(url) || linked.includes(url)) continue;
      if (/\bgazette\b/i.test(name) && /\b[12]\d{3}\/\d+\b/.test(name) && !gazetteNumber(source)) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?<!\\[)\\b${escaped}\\b(?!\\])`, 'i');
      if (!pattern.test(linked)) continue;
      const id = `named-source-${++nextSynthetic}`;
      synthetic.push(`[^${id}]: ${source.text}`);
      linked = linked.replace(pattern, (match) => `${match}[^${id}]`);
      citedUrls.add(url);
    }
  }
  const gazettes = new Map();
  for (const source of sources) {
    const number = gazetteNumber(source);
    if (!number) continue;
    const url = source.links[0].url;
    const score = (/\.pdf(?:\?|$)/i.test(url) ? 2 : 0) + (/\.gov\.lk(?:\/|$)/i.test(new URL(url).hostname) ? 4 : 0);
    if (!gazettes.has(number) || score > gazettes.get(number).score) gazettes.set(number, { source, score });
  }
  for (const [number, { source }] of gazettes) {
    if (synthetic.some((item) => item.includes(`](${source.links[0].url})`))) continue;
    const pattern = new RegExp(`\\b${number.replace('/', '\\/')}\\b(?!\\[\\^)`);
    if (!pattern.test(linked)) continue;
    const id = `gazette-source-${++nextSynthetic}`;
    synthetic.push(`[^${id}]: [Gazette No. ${number}](${source.links[0].url})`);
    linked = linked.replace(pattern, (match) => `${match}[^${id}]`);
  }
  const preserved = [...original.matchAll(definition)].map((match) => `[^${match[1]}]: ${match[2].trim()}`);
  const all = [...preserved, ...additions, ...synthetic];
  const delivered = all.length ? `${linked}\n\n${all.join('\n')}` : linked;
  const linkedAnswer = linkNumberedCitations(delivered);
  if (!linkedAnswer.includes('### References') && !/\[\[\d+\]\]\(https?:\/\//.test(linkedAnswer) && sources.length) {
    const selected = [...new Map(sources.flatMap((source) => source.links.map((link) => [link.url, link.name]))).entries()]
      .filter(([, name]) => name.length >= 12).slice(0, 5);
    if (selected.length) {
      const consulted = selected.map(([url, name], index) => `${index + 1}. [${name}](${url})`).join('\n');
      return `${linkedAnswer.trimEnd()}\n\n### Sources consulted\n\n${consulted}${preview ? `\n\n${preview}` : ''}`;
    }
  }
  return preview ? `${linkedAnswer.trimEnd()}\n\n${preview}` : linkedAnswer;
}
