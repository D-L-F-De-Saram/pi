import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCitations } from '../core/citations.mjs';
import { publicCitationText } from '../core/source-citations.mjs';

const research = `## Divorce procedure\n\nA petition is filed in the District Court.[^1]\n\n[^1]: [**Matrimonial Jurisdiction Act**](https://example.test/mja)`;

test('uses the single firm research answer when a final research response drops its required footnotes', () => {
  const result = restoreCitations('A petition is filed in the District Court.', [research], { fallbackToResearch: true });
  assert.match(result, /\[\[1\]\]\(https:\/\/example\.test\/mja\)/);
  assert.match(result, /^1\. \[\*\*Matrimonial Jurisdiction Act\*\*\]/m);
});

test('renumbers citations from multiple independently numbered firm research answers', () => {
  const second = 'A second legal finding.[^1]\n\n[^1]: [Second Act](https://example.test/second)';
  const result = restoreCitations('Uncited synthesis.', [research, second], { fallbackToResearch: true });
  assert.match(result, /\[\[1\]\]\(https:\/\/example\.test\/mja\)/);
  assert.match(result, /\[\[2\]\]\(https:\/\/example\.test\/second\)/);
  assert.doesNotMatch(result, /\[\^1\]/);
});

test('does not replace a document delivery with a research fallback', () => {
  const answer = 'The requested presentation is ready.\n\n:::artifact{identifier="deck"}\n```html\n<main>deck</main>\n```\n:::';
  assert.match(restoreCitations(answer, [research], { fallbackToResearch: false }), /requested presentation is ready/i);
});

test('numbers a Gazette citation recovered from a public search result', () => {
  const publicSources = publicCitationText(JSON.stringify({ results: [
    { title: 'Broken search hit', link: 'not a URL' },
    { title: 'Original Gazette PDF', link: 'https://nmra.example/No%20244634_E.pdf' },
  ] }), 'public-1');
  const result = restoreCitations('Gazette No. 2446/34 sets the pricing mechanism.', [publicSources]);
  assert.match(result, /2446\/34\[\[1\]\]\(https:\/\/nmra\.example\/No%20244634_E\.pdf\)/);
  assert.match(result, /^1\. \[Gazette No\. 2446\/34\]\(https:\/\/nmra\.example\/No%20244634_E\.pdf\)/m);
});

test('turns explicit source links into sequential numbered citations but leaves downloads intact', () => {
  const answer = 'See [NMRA guidance](https://nmra.example/guidance) and [the Gazette](https://nmra.example/gazette).\n\n[Download PDF](http://localhost:8160/artifacts/123/report.pdf?token=test)';
  const result = restoreCitations(answer, []);
  assert.match(result, /NMRA guidance\[\[1\]\]\(https:\/\/nmra\.example\/guidance\)/);
  assert.match(result, /the Gazette\[\[2\]\]\(https:\/\/nmra\.example\/gazette\)/);
  assert.match(result, /\[Download PDF\]\(http:\/\/localhost:8160\/artifacts\/123\/report\.pdf\?token=test\)/);
  assert.match(result, /^1\. \[NMRA guidance\]/m);
  assert.match(result, /^2\. \[the Gazette\]/m);
});

test('keeps a numbered consulted-sources list when no source can be tied to a claim', () => {
  const publicSources = publicCitationText(JSON.stringify({ results: [
    { title: 'Official drug-pricing notice', url: 'https://nmra.example/notice' },
  ] }), 'public-2');
  const result = restoreCitations('The regulatory position needs checking.', [publicSources]);
  assert.match(result, /### Sources consulted/);
  assert.match(result, /^1\. \[Official drug-pricing notice\]\(https:\/\/nmra\.example\/notice\)/m);
  assert.equal(restoreCitations(result, [publicSources]), result);
});

test('does not attach a Gazette citation to an unrelated page', () => {
  const publicSources = publicCitationText(JSON.stringify({ results: [
    { title: 'Gazette No. 2429/12', url: 'https://slpma.example/launching-our-website' },
    { title: 'Official Gazette PDF', url: 'https://nmra.example/No%20244634_E.pdf' },
  ] }), 'public-3');
  const result = restoreCitations('Gazette No. 2429/12 preceded Gazette No. 2446/34.', [publicSources]);
  assert.doesNotMatch(result, /2429\/12\[\[\d+\]\]/);
  assert.match(result, /2446\/34\[\[1\]\]\(https:\/\/nmra\.example\/No%20244634_E\.pdf\)/);
});

test('preserves a complete numbered answer without appending another reference list', () => {
  const answer = 'The Act applies [[1]](https://law.example/act).\n\n### References\n\n1. [The Act](https://law.example/act)';
  const publicSources = publicCitationText(JSON.stringify({ results: [
    { title: 'Other search result', url: 'https://news.example/unrelated' },
  ] }), 'public-4');
  assert.equal(restoreCitations(answer, [publicSources]), answer);
});
