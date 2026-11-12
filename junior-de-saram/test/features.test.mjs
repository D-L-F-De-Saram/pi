import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { restoreCitations, sourceDefinitions } from '../core/citations.mjs';
import { docxXml, previewMarkup } from '../core/preview.mjs';

test('research footnotes retain their original linked definitions and page references', () => {
  const researcher = 'A finding[^2].\n\n[^2]: [Companies Act](https://example.test/companies-act) p. 17';
  const final = restoreCitations('The Act says so [[^2]].', [researcher]);
  assert.match(final, /The Act says so \[\[1\]\]\(https:\/\/example\.test\/companies-act\)\./);
  assert.match(final, /^1\. \[Companies Act\]\(https:\/\/example\.test\/companies-act\) p\. 17/m);
  assert.equal(sourceDefinitions(researcher).length, 1);
});

test('conflicting footnote numbers are not attributed to the wrong source', () => {
  const sources = ['Claim[^1].\n\n[^1]: [Act A](https://example.test/a)', 'Claim[^1].\n\n[^1]: [Act B](https://example.test/b)'];
  const final = restoreCitations('Claim[^1].', sources);
  assert.doesNotMatch(final, /^\[\^1\]:/m);
});

test('only a uniquely identified named source is linked in a combined answer', () => {
  const source = 'Claim[^1].\n\n[^1]: [Companies Act](https://example.test/companies-act)';
  const final = restoreCitations('The Companies Act is relevant.', [source]);
  assert.match(final, /Companies Act\[\[1\]\]\(https:\/\/example\.test\/companies-act\)/);
  assert.match(final, /^1\. \[Companies Act\]\(https:\/\/example\.test\/companies-act\)/m);
});

function zipDocument(xml) {
  const name = Buffer.from('word/document.xml');
  const contents = Buffer.from(xml);
  const compressed = deflateRawSync(contents);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(contents.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(contents.length, 24); central.writeUInt16LE(name.length, 28);
  const offset = local.length + name.length + compressed.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

test('completed DOCX becomes a safe LibreChat canvas preview', () => {
  const input = zipDocument('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>De Saram &amp; Co</w:t></w:r></w:p></w:body></w:document>');
  assert.match(docxXml(input), /De Saram/);
  const preview = previewMarkup(input, '/files/legal-note.docx');
  assert.match(preview, /^:::artifact\{identifier=/);
  assert.match(preview, /De Saram &amp; Co/);
  assert.match(preview, /<\/html>/);
  assert.throws(() => docxXml(Buffer.from('not a zip')));
});
