import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCitations } from '../core/citations.mjs';

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
