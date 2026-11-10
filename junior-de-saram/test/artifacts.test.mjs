import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishArtifact, artifactDownload, materializePreviewImages } from '../core/artifacts.mjs';

test('artifact publication signs downloads and rejects outside paths and invalid tokens', async () => {
  const folder = await mkdtemp(path.join(tmpdir(),'de-saram-test-'));
  process.env.JUNIOR_DE_SARAM_WORKSPACE_ROOT = path.join(folder,'work');
  process.env.JUNIOR_DE_SARAM_ARTIFACT_ROOT = path.join(folder,'published');
  process.env.JUNIOR_DE_SARAM_ARTIFACT_SECRET = 'test-artifact-secret';
  try {
    await mkdir(process.env.JUNIOR_DE_SARAM_WORKSPACE_ROOT);
    const file=path.join(process.env.JUNIOR_DE_SARAM_WORKSPACE_ROOT,'answer.txt');
    await writeFile(file,'A legal work product');
    const item=await publishArtifact(file);
    assert.match(item.download_url,/\/artifacts\/[a-f0-9]+\/answer.txt\?token=/);
    const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){this.bytes=bytes;}};
    const url=new URL(item.download_url);
    await artifactDownload({url:url.pathname+url.search},response);
    assert.equal(response.status,200); assert.equal(response.bytes.toString(),'A legal work product');
    await artifactDownload({url:url.pathname+'?token=invalid'},response); assert.equal(response.status,403);
    const outside=path.join(folder,'secret.txt'); await writeFile(outside,'private');
    await assert.rejects(publishArtifact(outside),/workspace/);
  } finally { await rm(folder,{recursive:true,force:true}); }
});

test('materializes every rendered preview page as a separate valid image element', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'de-saram-preview-'));
  process.env.JUNIOR_DE_SARAM_ARTIFACT_ROOT = path.join(folder, 'published');
  process.env.JUNIOR_DE_SARAM_ARTIFACT_SECRET = 'test-artifact-secret';
  process.env.JUNIOR_DE_SARAM_PUBLIC_URL = 'http://127.0.0.1:8160';
  try {
    const data = Buffer.from('preview page').toString('base64');
    const html = await materializePreviewImages(`<main><img alt="one" src="data:image/png;base64,${data}"><img alt="two" src="data:image/png;base64,${data}"></main>`);
    assert.equal((html.match(/<img\b/g) || []).length, 2);
    assert.equal((html.match(/\bsrc="http:\/\/127\.0\.0\.1:8160\/artifacts\/[a-f0-9]{64}\/preview\.png\?token=[a-f0-9]+"/g) || []).length, 2);
    assert.equal((html.match(/data:image\/png/g) || []).length, 0);
    assert.match(html, /<figure><img alt="Document page 1"[^>]*><\/figure><figure><img alt="Document page 2"[^>]*><\/figure>/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
