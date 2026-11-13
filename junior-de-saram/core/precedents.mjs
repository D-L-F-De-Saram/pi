import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspaceRoot } from './artifacts.mjs';
import { retrieveSource } from './source-retrieval.mjs';

const seedRoot = () => path.resolve(process.env.JUNIOR_DE_SARAM_KB_ROOT || './junior-de-saram/private-wiki');
const cacheRoot = () => path.resolve(process.env.JUNIOR_DE_SARAM_KB_CACHE_ROOT || './junior-de-saram/private-wiki/imported');
const words = (text) => [...new Set(String(text || '').toLowerCase().match(/[a-z]{3,}/g) || [])];
const sourceHash = (value) => createHash('sha256').update(value).digest('hex');
const titleSlug = (value) => String(value || 'firm-precedent').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 75).replace(/-$/g, '') || 'firm-precedent';

async function localRecords(root, prefix) {
  let names;
  try { names = await readdir(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const records = [];
  for (const name of names.filter((item) => /^[a-z0-9][a-z0-9_-]{0,100}\.md$/i.test(item))) {
    const filename = path.join(root, name);
    const metadata = JSON.parse(await readFile(`${filename}.json`, 'utf8'));
    records.push({ id: `${prefix}:${name.slice(0, -3)}`, title: metadata.title, document_type: metadata.document_type, practice_area: metadata.practice_area, source_record_id: metadata.source_record_id, source_path: metadata.source_path, filename });
  }
  return records;
}

export async function searchPrecedents(args) {
  const query = String(args.query || '').trim();
  if (!query || query.length > 300) throw Error('Supply a drafting topic or document type under 300 characters.');
  const terms = words(query);
  const records = [...await localRecords(seedRoot(), 'wiki'), ...await localRecords(cacheRoot(), 'cache')];
  const local = records.map(({ filename, source_path, ...record }) => {
    const haystack = words(`${record.title} ${record.document_type} ${record.practice_area}`).join(' ');
    return { ...record, relevance: terms.filter((term) => haystack.includes(term)).length };
  }).filter((record) => record.relevance).sort((a, b) => b.relevance - a.relevance || a.title.localeCompare(b.title)).slice(0, 8);
  const result = { query, local, firm_candidates: [], note: 'Private precedents guide structure and style, not legal propositions. Read only relevant examples and do not copy their client facts.' };
  if (local.length && !args.include_firm_index) return result;
  const seen = new Set();
  let found;
  for (let page = 1; page <= 4 && result.firm_candidates.length < 8; page += 1) {
    found = await retrieveSource({ source: 'firm_document', operation: 'find', query, fields: ['document_id', 'document_name', 'title_of_document', 'document_type', 'practice_area', 'markdown_path', 'short_summary'], page, page_size: 30, max_field_characters: 1200 });
    for (const record of found.records) {
      if (!record.markdown_path || seen.has(record.markdown_path)) continue;
      seen.add(record.markdown_path);
      result.firm_candidates.push({ id: `firm:${record.id}`, title: record.source_title, document_type: record.document_type, practice_area: record.practice_area, summary: record.short_summary, source_record_id: record.id });
      if (result.firm_candidates.length >= 8) break;
    }
    if (!found.has_more) break;
  }
  result.firm_index_searched = true;
  result.more_indexed_chunks = found.has_more;
  return result;
}

async function storedRecord(id) {
  const match = /^(wiki|cache):([a-z0-9][a-z0-9_-]{0,100})$/i.exec(id);
  if (!match) throw Error('Select an ID returned by precedent search.');
  const root = match[1] === 'wiki' ? seedRoot() : cacheRoot();
  const file = path.join(root, `${match[2]}.md`);
  let actual;
  try { actual = await realpath(file); }
  catch (error) {
    if (error.code !== 'ENOENT' || match[1] !== 'cache' || !/^[a-f0-9]{24}$/.test(match[2])) throw error;
    const alias = (await localRecords(root, 'cache')).find((item) => item.source_path && sourceHash(item.source_path).slice(0, 24) === match[2]);
    if (!alias) throw error;
    return storedRecord(alias.id);
  }
  const base = await realpath(root);
  if (!actual.startsWith(`${base}${path.sep}`)) throw Error('Precedent is outside the private wiki.');
  return { text: await readFile(actual, 'utf8'), metadata: JSON.parse(await readFile(`${actual}.json`, 'utf8')), id };
}

async function saveImportedRecord(text, metadata) {
  const root = cacheRoot();
  await mkdir(root, { recursive: true });
  const basename = titleSlug(metadata.title);
  const suffix = sourceHash(metadata.source_path).slice(0, 8);
  for (const name of [basename, `${basename}-${suffix}`]) {
    const file = path.join(root, `${name}.md`);
    let existing;
    try { existing = JSON.parse(await readFile(`${file}.json`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing?.source_path === metadata.source_path) {
      await writeFile(file, text, { flag: 'wx', mode: 0o600 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      return storedRecord(`cache:${name}`);
    }
    if (existing) continue;
    try { await stat(file); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await writeFile(`${file}.json`, JSON.stringify(metadata, null, 2), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    await writeFile(file, text, { flag: 'wx', mode: 0o600 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    return storedRecord(`cache:${name}`);
  }
  throw Error('Could not choose a unique private wiki filename.');
}

export async function migrateLegacyCache(legacyRoot) {
  let names;
  try { names = await readdir(legacyRoot); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const migrated = [];
  for (const name of names.filter((item) => /^[a-f0-9]{24}\.md$/.test(item))) {
    const filename = path.join(legacyRoot, name);
    const metadata = JSON.parse(await readFile(`${filename}.json`, 'utf8'));
    if (!metadata.source_path || !metadata.title) throw Error(`Legacy precedent has incomplete metadata: ${name}`);
    const record = await saveImportedRecord(await readFile(filename, 'utf8'), metadata);
    migrated.push({ old_id: `cache:${name.slice(0, -3)}`, new_id: record.id });
  }
  return migrated;
}

async function importFirmRecord(recordId) {
  if (!/^[a-z0-9_-]{1,160}$/i.test(recordId)) throw Error('Select a firm record ID returned by precedent search.');
  const record = (await retrieveSource({ source: 'firm_document', operation: 'retrieve', record_id: recordId, fields: ['document_id', 'document_name', 'title_of_document', 'document_type', 'practice_area', 'markdown_path'] })).record;
  const sourcePath = record.markdown_path;
  if (!sourcePath || sourcePath.includes('://') || sourcePath.split('/').some((part) => !part || part === '.' || part === '..')) throw Error('Indexed document has no safe Markdown path.');
  const cached = (await localRecords(cacheRoot(), 'cache')).find((item) => item.source_path === sourcePath);
  if (cached) return storedRecord(cached.id);
  const base = process.env.DESARAM_FILE_SERVER_URL;
  if (!base) throw Error('The firm document server is not configured.');
  const url = `${base.replace(/\/$/, '')}/doc/${sourcePath.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Firm document server returned HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw Error('Precedent exceeds the private wiki import limit.'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) throw Error('Firm document is empty.');
  const metadata = { title: record.source_title || record.document_name || record.title_of_document, document_type: record.document_type || '', practice_area: record.practice_area || '', source_record_id: record.id, source_path: sourcePath, imported_at: new Date().toISOString() };
  return saveImportedRecord(text, metadata);
}

export async function readPrecedent(args) {
  const id = String(args.precedent_id || '');
  const record = id.startsWith('firm:') ? await importFirmRecord(id.slice(5)) : await storedRecord(id);
  const offset = args.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > record.text.length) throw Error('Invalid precedent offset.');
  const length = Math.min(Math.max(Number(args.max_characters || 18000), 1), 30000);
  return { precedent_id: record.id, metadata: record.metadata, excerpt: record.text.slice(offset, offset + length), offset, total_characters: record.text.length, next_offset: offset + length < record.text.length ? offset + length : null, private_drafting_example: true, instruction: 'Use for structure and style only. Do not carry across parties, identifiers, facts, figures, private addresses or unverified legal assertions.' };
}

export async function validateDraft(args) {
  const root = await realpath(workspaceRoot());
  const file = await realpath(path.resolve(String(args.file_path || '')));
  if (!file.startsWith(`${root}${path.sep}`) || !/\.(md|txt)$/i.test(file)) throw Error('Draft source must be Markdown or text inside the conversation workspace.');
  if ((await stat(file)).size > 2 * 1024 * 1024) throw Error('Draft source exceeds validation limit.');
  const text = await readFile(file, 'utf8');
  if (!text.trim()) throw Error('Draft source is empty.');
  const placeholders = [...text.matchAll(/\[(?:FILL|TODO|ASSUMED|NAME|DATE|ADDRESS|AMOUNT)(?::[^\]]*)?\]|\b(?:TBD|TO BE CONFIRMED)\b/gi)].map((match) => match[0]);
  return { file_path: file, word_count: (text.match(/[\p{L}\p{N}]+/gu) || []).length, headings: [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]), placeholders, instruction: 'Resolve or disclose placeholders and check all legal propositions against actual authorities before publishing.' };
}
