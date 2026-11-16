import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncCatalog } from '../core/drafting-catalog.mjs';
import { searchPrecedents, readPrecedent, copyTemplate, validateDraft } from '../core/precedents.mjs';

test('catalog records template/sample status and copies only verified originals into a conversation workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'de-saram-catalog-'));
  const catalogRoot = path.join(root, 'catalog');
  const workspaces = path.join(root, 'workspaces'); const conversation = path.join(workspaces, 'session-a');
  await mkdir(conversation, { recursive: true });
  const values = {
    JUNIOR_DE_SARAM_CATALOG_ROOT: catalogRoot, JUNIOR_DE_SARAM_WORKSPACE_ROOT: workspaces,
    JUNIOR_DE_SARAM_ACTIVE_WORKSPACE: conversation,
    DESARAM_TYPESENSE_URL: 'https://db.example', DESARAM_TYPESENSE_SEARCH_KEY: 'test-read-key',
    DESARAM_FILE_SERVER_URL: 'https://files.example', DESARAM_DRAFTING_SOURCE_URL: 'https://gateway.example',
    DESARAM_DRAFTING_SOURCE_TOKEN: 'test-gateway-key',
  };
  const previousEnv = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  const original = Buffer.from('PKoriginal-template');
  const originalHash = createHash('sha256').update(original).digest('hex');
  const records = [
    { id: 'template-0', document_id: 'template', document_name: 'Writ Petition Template', document_type: 'Court Filing', practice_area: 'Litigation', markdown_path: 'litigation/writ-template.md', source_document: '/data/repository/litigation/writ-template.docx', indexed_timestamp: 100, document_status: 'draft' },
    { id: 'sample-0', document_id: 'sample', document_name: 'Executed Lease Agreement', document_type: 'Agreement', practice_area: 'Property', markdown_path: 'property/lease-sample.md', source_document: '/data/repository/property/lease-sample.docx', indexed_timestamp: 100, document_status: 'executed' },
  ];
  let indexSearches = 0; let originalReads = 0;
  let templateAvailable = true;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.pathname === '/collections/legal_documents') return Response.json({ fields: [
      'id', 'text', 'document_id', 'document_name', 'title_of_document', 'document_type',
      'document_status', 'practice_area', 'markdown_path', 'source_document', 'indexed_timestamp',
    ].map((name) => ({ name, type: name === 'indexed_timestamp' ? 'int64' : 'string' })) });
    if (url.pathname.endsWith('/documents/search')) {
      indexSearches += 1;
      const exact = url.searchParams.get('filter_by')?.match(/^id:=`([^\x60]+)`$/);
      const cursor = url.searchParams.get('filter_by')?.match(/indexed_timestamp:>=(\d+)/);
      const matches = exact ? records.filter((row) => row.id === exact[1]) : cursor ? records.filter((row) => row.indexed_timestamp >= Number(cursor[1])) : records;
      return Response.json({ found: matches.length, hits: matches.map((document) => ({ document })) });
    }
    if (url.hostname === 'files.example') return new Response(url.pathname.includes('writ-template') ? '# Writ Petition Template\nName: [NAME]\n' : '# Executed Lease\nPrivate Client\n');
    if (url.pathname.endsWith('/status')) {
      const ids = JSON.parse(options.body).record_ids;
      return Response.json({ sources: ids.map((record_id) => ({ record_id, availability: record_id === 'template-0' && templateAvailable ? 'available' : 'missing', source_extension: '.docx', filename: `${record_id}.docx`, bytes: original.length })) });
    }
    if (url.pathname.endsWith('/template-0')) { originalReads += 1; return new Response(original, { headers: { 'x-source-sha256': originalHash } }); }
    throw Error(`Unexpected request: ${url}`);
  };
  try {
    const initial = await syncCatalog({ full: true });
    assert.equal(initial.logical_documents, 2);
    const catalog = JSON.parse(await readFile(path.join(catalogRoot, 'catalog.json'), 'utf8'));
    assert.equal(catalog.documents['litigation/writ-template.md'].classification, 'template');
    assert.equal(catalog.documents['litigation/writ-template.md'].original.availability, 'available');
    assert.equal(catalog.documents['property/lease-sample.md'].classification, 'sample');
    const matches = await searchPrecedents({ query: 'writ petition' });
    assert.equal(matches.candidates[0].classification, 'template');
    const sample = await searchPrecedents({ query: 'lease agreement' });
    const reference = await readPrecedent({ precedent_id: sample.candidates[0].id });
    assert.equal(reference.source_use, 'sample_reference');
    assert.match(reference.excerpt, /Private Client/);
    await assert.rejects(copyTemplate({ precedent_id: sample.candidates[0].id }), /Only a verified template/);
    const copy = await copyTemplate({ precedent_id: matches.candidates[0].id });
    assert.equal(copy.source_use, 'template_copy');
    assert.equal(copy.original_unchanged, true);
    assert.equal(originalReads, 1);
    assert.deepEqual(await readFile(copy.copied_to), original);
    assert.ok(copy.copied_to.startsWith(conversation));
    templateAvailable = false;
    await assert.rejects(copyTemplate({ precedent_id: matches.candidates[0].id }), /no verified, available original/);
    templateAvailable = true;
    records.push({ id: 'sample-1', document_id: 'sample-1', document_name: 'Updated Affidavit', document_type: 'Court Filing', practice_area: 'Litigation', markdown_path: 'litigation/affidavit.md', source_document: '/data/repository/litigation/affidavit.pdf', indexed_timestamp: 200 });
    const before = indexSearches;
    const update = await syncCatalog();
    assert.equal(update.mode, 'incremental');
    assert.equal(update.logical_documents, 3);
    assert.ok(indexSearches - before <= 2);
    records.splice(1, 1);
    const reconciled = await syncCatalog({ full: true });
    assert.equal(reconciled.logical_documents, 2);
    assert.equal(JSON.parse(await readFile(path.join(catalogRoot, 'catalog.json'), 'utf8')).documents['property/lease-sample.md'], undefined);
    process.env.JUNIOR_DE_SARAM_ACTIVE_WORKSPACE = root;
    await assert.rejects(copyTemplate({ precedent_id: matches.candidates[0].id }), /current conversation workspace/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('draft validator limits itself to the conversation workspace and reports unresolved facts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'de-saram-draft-'));
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  process.env.JUNIOR_DE_SARAM_WORKSPACE_ROOT = workspace;
  const file = path.join(workspace, 'petition.md');
  await writeFile(file, '# Petition\nParty: [FILL]\n');
  const result = await validateDraft({ file_path: file });
  assert.deepEqual(result.placeholders, ['[FILL]']);
  assert.deepEqual(result.headings, ['Petition']);
  await assert.rejects(validateDraft({ file_path: path.join(root, 'outside.md') }));
});
