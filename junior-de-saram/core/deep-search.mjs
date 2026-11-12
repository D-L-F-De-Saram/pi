export async function deepPublicWebResearch(args, fetcher = fetch) {
  const key = process.env.EXA_API_KEY;
  if (!key) throw Error('Missing EXA_API_KEY configuration');
  const response = await fetcher('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query: args.query, type: 'deep', numResults: args.max_results || 6, contents: { highlights: true } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw Error(`Deep search returned HTTP ${response.status}`);
  const data = await response.json();
  return { results: (data.results || []).map(({ title, url, publishedDate, highlights }) => ({
    title,
    url,
    publishedDate,
    highlights: Array.isArray(highlights) ? highlights.map((item) => String(item).slice(0, 1200)).slice(0, 4) : [],
  })) };
}
