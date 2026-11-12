import assert from 'node:assert/strict';
import test from 'node:test';
import { deepPublicWebResearch } from '../core/deep-search.mjs';

test('Exa deep research returns linked and bounded public evidence', async () => {
  process.env.EXA_API_KEY = 'test-exa-key';
  const result = await deepPublicWebResearch({ query: 'Sri Lankan legal reform', max_results: 4 }, async (url, options) => {
    assert.equal(url, 'https://api.exa.ai/search');
    assert.equal(options.headers['x-api-key'], 'test-exa-key');
    assert.deepEqual(JSON.parse(options.body), { query: 'Sri Lankan legal reform', type: 'deep', numResults: 4, contents: { highlights: true } });
    return new Response(JSON.stringify({ results: [{ title: 'Official Gazette', url: 'https://example.test/gazette', publishedDate: '2026-10-01', highlights: ['Relevant provision'] }] }), { status: 200 });
  });
  assert.deepEqual(result.results, [{ title: 'Official Gazette', url: 'https://example.test/gazette', publishedDate: '2026-10-01', highlights: ['Relevant provision'] }]);
});

test('Exa failure does not silently become an invented result', async () => {
  process.env.EXA_API_KEY = 'test-exa-key';
  await assert.rejects(deepPublicWebResearch({ query: 'something' }, async () => new Response('', { status: 429 })), /HTTP 429/);
});
