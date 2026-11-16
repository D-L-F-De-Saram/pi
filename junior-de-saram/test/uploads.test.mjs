import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = await mkdtemp(path.join(os.tmpdir(), 'de-saram-uploads-'));
process.env.JUNIOR_DE_SARAM_UPLOAD_ROOT = root;
process.env.JUNIOR_DE_SARAM_API_KEY = 'test-session-key';
process.env.JUNIOR_DE_SARAM_ATTACHMENT_ORIGINS = 'http://api:3080';
const { conversationKey, conversationUploadPaths, fileCandidates, piPrompt, saveUploads, textUploads } = await import('../core/uploads.mjs');
test.after(async () => rm(root, { recursive: true, force: true }));

test('Upload as Text keeps the request outside the saved document, including multiple attachments', async () => {
  const message = 'Attached document(s):\n```md\n# "main.pdf"\nMain clauses\n\n---\n\n# "annex.docx"\nAnnex details\n```\nDraft an email about the IP risks in both documents.';
  const extracted = textUploads([{ role: 'user', content: message }]);
  assert.equal(extracted.instruction, 'Draft an email about the IP risks in both documents.');
  assert.equal(extracted.files.length, 2);
  const files = await saveUploads('text', [], extracted.files);
  assert.equal(files.length, 2);
  assert.equal(await readFile(files[0], 'utf8'), 'Main clauses');
  assert.match(piPrompt(extracted.instruction, files, '/workspace'), /Draft an email about the IP risks in both documents\./);
  assert.match(piPrompt(extracted.instruction, files, '/workspace'), /The user supplied these local document files/);
  assert.deepEqual(await saveUploads('text', [], extracted.files), []);
  assert.equal((await conversationUploadPaths('text')).length, 2);
});

test('Upload to Provider receives current-turn files, keeps original bytes and deduplicates later turns', async () => {
  const oldFile = { file_id: 'old', url: 'data:application/pdf;base64,b2xk', filename: 'old.pdf' };
  const current = { file_id: 'current', url: 'data:application/pdf;base64,JVBERi0=', filename: 'agreement.pdf' };
  const body = { messages: [{ role: 'user', files: [oldFile] }, { role: 'assistant', content: 'Earlier answer' }, { role: 'user', content: 'Review this as the developer', files: [current] }] };
  const candidates = fileCandidates(body);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceId, 'current');
  const files = await saveUploads('provider', candidates, []);
  assert.equal(files.length, 1);
  assert.equal((await readFile(files[0])).toString(), '%PDF-');
  assert.deepEqual(await saveUploads('provider', candidates, []), []);
  assert.equal(textUploads(body.messages).instruction, 'Review this as the developer');
  const next = await saveUploads('provider', [{ sourceId: 'new', url: 'data:application/pdf;base64,bmV3', name: 'agreement.pdf' }], []);
  assert.equal(next.length, 1);
  assert.notEqual(next[0], files[0]);
});

test('HTTP provider files use the allowlisted origin and other users have separate directories', async () => {
  const fetcher = async (url, options) => {
    assert.equal(url.origin, 'http://api:3080');
    assert.equal(options.redirect, 'error');
    return new Response(Buffer.from('provider document'), { status: 200, headers: { 'content-type': 'application/pdf' } });
  };
  const files = await saveUploads('http-file', [{ url: 'http://api:3080/api/files/test', name: 'source.pdf', sourceId: 'a' }], [], fetcher);
  assert.equal((await readFile(files[0])).toString(), 'provider document');
  await assert.rejects(saveUploads('blocked', [{ url: 'http://other:3080/private', name: 'source.pdf' }], [], fetcher), /not allowlisted/);
  const one = conversationKey({ headers: { 'x-librechat-user-id': 'user-one', 'x-librechat-conversation-id': 'shared-id' } }, {});
  const two = conversationKey({ headers: { 'x-librechat-user-id': 'user-two', 'x-librechat-conversation-id': 'shared-id' } }, {});
  assert.notEqual(one, two);
  assert.equal((await readdir(path.join(root, 'http-file'))).filter((name) => !name.startsWith('.')).length, 1);
});
