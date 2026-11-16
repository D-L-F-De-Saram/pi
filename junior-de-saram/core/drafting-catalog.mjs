import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { retrieveSource } from './source-retrieval.mjs';

const weekMs = 7 * 86400000;
const root = () => path.resolve(process.env.JUNIOR_DE_SARAM_CATALOG_ROOT || process.env.JUNIOR_DE_SARAM_KB_ROOT || './junior-de-saram/private-wiki');
export const catalogFile = () => path.join(root(), 'catalog.json');
const fresh = () => ({ version: 1, full_reconciled_at: null, updated_at: null, indexed_timestamp_cursor: 0, documents: {} });
const words = (value) => [...new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])];
const identity = (source) => `firm:${createHash('sha256').update(source).digest('hex').slice(0, 20)}`;
const templateHint = (value) => /\b(?:template|pro\s*forma|blank\s+form|fillable\s+form|model\s+form)\b/i.test(value);
const blankCount = (value) => (String(value).match(/_{4,}|\{\{[^{}\n]{1,60}\}\}|\[(?:NAME|DATE|ADDRESS|AMOUNT|PARTY|CLIENT|INSERT|FILL|TO BE COMPLETED)[^\]\n]{0,60}\]|\.{6,}/gi) || []).length;

export async function loadCatalog() {
  try {
    const value = JSON.parse(await readFile(catalogFile(), 'utf8'));
    if (value.version !== 1 || !value.documents || typeof value.documents !== 'object') throw Error('Unsupported drafting catalog version');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return fresh(); throw error; }
}
async function saveCatalog(value) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const temporary = `${catalogFile()}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, catalogFile());
}
function indexedEntry(record, previous) {
  const markdown = String(record.markdown_path || '');
  if (!markdown || markdown.includes('://') || markdown.split('/').some((part) => part === '..')) return undefined;
  const title = String(record.source_title || record.title_of_document || record.document_name || path.basename(markdown, '.md'));
  const hint = templateHint(`${title} ${markdown}`);
  const override = previous?.classification_override;
  return {
    id: identity(markdown), record_id: record.id, document_id: record.document_id || '',
    title, document_type: record.document_type || '', document_status: record.document_status || '',
    practice_area: record.practice_area || '', markdown_path: markdown,
    source_filename: path.basename(String(record.source_document || '')),
    source_extension: path.extname(String(record.source_document || '')).toLowerCase(),
    indexed_timestamp: Number(record.indexed_timestamp || 0),
    classification: override || (hint ? 'uncertain' : 'sample'),
    classification_basis: override ? 'manual override' : hint ? 'template-like title; source blanks not yet checked' : 'provisional sample; no template marker in metadata',
    ...(override ? { classification_override: override } : {}),
    placeholder_count: previous?.placeholder_count ?? null,
    original: previous?.original || { availability: 'unchecked', verified_at: null },
  };
}
export async function readIndexedText(entry) {
  const source = entry.markdown_path;
  const base = process.env.DESARAM_FILE_SERVER_URL;
  if (!base || !source || source.includes('://') || source.split('/').some((part) => !part || part === '.' || part === '..')) throw Error('Safe firm Markdown source unavailable');
  const url = `${base.replace(/\/$/, '')}/doc/${source.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Firm document server returned HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Error('Firm document exceeds bounded reading limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function inspectTemplate(entry) {
  if (entry.classification_override) return;
  const hint = templateHint(`${entry.title} ${entry.markdown_path}`);
  const completed = /\b(?:executed|completed|final|signed)\b/i.test(entry.document_status);
  try {
    entry.placeholder_count = blankCount(await readIndexedText(entry));
    if (hint && entry.placeholder_count && !completed) {
      entry.classification = 'template';
      entry.classification_basis = 'template-like metadata and blank fields in extracted source';
    } else if (hint || entry.placeholder_count >= 2) {
      entry.classification = 'uncertain';
      entry.classification_basis = completed ? 'completed status conflicts with template-like evidence' : 'source and metadata do not conclusively distinguish template from sample';
    } else {
      entry.classification = 'sample';
      entry.classification_basis = 'no strong template evidence in metadata or extracted source';
    }
  } catch {
    entry.classification = hint ? 'uncertain' : 'sample';
    entry.classification_basis = hint ? 'template-like metadata; extracted source unavailable for classification' : 'provisional sample; extracted source unavailable for classification';
  }
}
export async function checkOriginals(entries) {
  const base = process.env.DESARAM_DRAFTING_SOURCE_URL;
  const token = process.env.DESARAM_DRAFTING_SOURCE_TOKEN;
  if (!base || !token) return;
  for (let index = 0; index < entries.length; index += 40) {
    const group = entries.slice(index, index + 40);
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/internal/drafting-sources/status`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-drafting-source-token': token },
        body: JSON.stringify({ record_ids: group.map((entry) => entry.record_id) }),
        redirect: 'error', signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw Error(`Original source gateway returned HTTP ${response.status}`);
      const byId = new Map((await response.json()).sources.map((item) => [item.record_id, item]));
      for (const entry of group) {
        const item = byId.get(entry.record_id);
        if (item) entry.original = {
          availability: item.availability, filename: item.filename || entry.source_filename,
          extension: item.source_extension || entry.source_extension,
          bytes: item.bytes ?? null, modified_ns: item.modified_ns ?? null,
          verified_at: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.error('[de-saram-catalog] original status:', error.message);
      break;
    }
  }
}
const fields = ['document_id', 'document_name', 'title_of_document', 'document_type', 'document_status', 'practice_area', 'markdown_path', 'source_document', 'indexed_timestamp'];
let running;
export function syncCatalog({ full = false } = {}) {
  if (running) return running;
  running = (async () => {
    const catalog = await loadCatalog();
    full ||= !catalog.full_reconciled_at || Date.now() - Date.parse(catalog.full_reconciled_at) >= weekMs;
    const documents = full ? {} : { ...catalog.documents };
    const changed = new Map();
    const cursor = catalog.indexed_timestamp_cursor || 0;
    let highest = cursor; let page = 1; let scannedChunks = 0;
    while (page <= 1000) {
      const result = await retrieveSource({
        source: 'firm_document', operation: 'find', query: '*', fields,
        ...(full ? {} : { filters: [{ field: 'indexed_timestamp', operator: 'gte', value: cursor }] }),
        sort_field: 'indexed_timestamp', sort_order: 'desc', page, page_size: 30, max_field_characters: 1200,
      });
      scannedChunks = result.found_chunks;
      for (const record of result.records) {
        const key = String(record.markdown_path || '');
        if (!key || changed.has(key)) continue;
        const entry = indexedEntry(record, catalog.documents[key]);
        if (!entry) continue;
        documents[key] = entry; changed.set(key, entry);
        highest = Math.max(highest, entry.indexed_timestamp);
      }
      if (!result.has_more) break;
      page += 1;
    }
    if (page > 1000) throw Error('Drafting catalog scan exceeded page limit');
    // Full reconciliation removes deleted index records; ordinary starts inspect
    // only records at or above the last committed timestamp.
    const retryClassification = Object.values(documents).filter((entry) =>
      !changed.has(entry.markdown_path) && /extracted source unavailable/.test(entry.classification_basis)).slice(0, 40);
    const queue = [...changed.values(), ...retryClassification];
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) await inspectTemplate(queue.shift());
    }));
    const staleOriginals = Object.values(documents).filter((entry) =>
      !changed.has(entry.markdown_path) &&
      (!entry.original?.verified_at || Date.now() - Date.parse(entry.original.verified_at) > 86400000)).slice(0, 200);
    await checkOriginals([...changed.values(), ...staleOriginals]);
    catalog.documents = documents;
    catalog.indexed_timestamp_cursor = highest;
    catalog.updated_at = new Date().toISOString();
    if (full) catalog.full_reconciled_at = catalog.updated_at;
    await saveCatalog(catalog);
    return { mode: full ? 'full' : 'incremental', logical_documents: Object.keys(documents).length, changed_documents: changed.size, scanned_chunks: scannedChunks, catalog_file: catalogFile() };
  })().finally(() => { running = undefined; });
  return running;
}
export async function catalogEntry(id) {
  const catalog = await loadCatalog();
  const cached = Object.values(catalog.documents).find((entry) => entry.id === id || `firm:${entry.record_id}` === id);
  if (cached) return cached;
  const match = /^firm:([A-Za-z0-9_-]{1,160})$/.exec(String(id));
  if (!match) throw Error('Select a firm document ID returned by catalog search');
  const result = await retrieveSource({ source: 'firm_document', operation: 'retrieve', record_id: match[1], fields, max_field_characters: 1200 });
  const live = indexedEntry(result.record);
  if (!live) throw Error('Selected firm document is unavailable');
  await inspectTemplate(live); await checkOriginals([live]);
  return live;
}
export async function searchCatalog({ query, classification, limit = 10 }) {
  const term = String(query || '').trim();
  if (!term || term.length > 300) throw Error('Supply a drafting topic or document type under 300 characters');
  if (classification && !['template', 'sample', 'uncertain'].includes(classification)) throw Error('Choose template, sample or uncertain');
  const catalog = await loadCatalog();
  const terms = words(term);
  let candidates = Object.values(catalog.documents).map((entry) => {
    const title = words(entry.title); const other = words(`${entry.document_type} ${entry.practice_area} ${entry.markdown_path}`);
    const score = terms.reduce((sum, word) => sum + (title.some((value) => value.includes(word)) ? 4 : other.some((value) => value.includes(word)) ? 1 : 0), 0);
    return { entry, score };
  }).filter(({ entry, score }) => score && (!classification || entry.classification === classification))
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
    .slice(0, Math.min(Math.max(limit, 1), 20)).map(({ entry }) => entry);
  if (!candidates.length) {
    const found = await retrieveSource({ source: 'firm_document', operation: 'find', query: term, fields, page_size: 30, max_field_characters: 1200 });
    const seen = new Set();
    candidates = found.records.map((record) => indexedEntry(record))
      .filter((entry) => entry && !seen.has(entry.markdown_path) && seen.add(entry.markdown_path) && (!classification || entry.classification === classification)).slice(0, 10);
    // A fallback candidate is not yet in the durable catalog. Use its indexed
    // record ID so the read/copy operations can resolve it directly.
    for (const entry of candidates) entry.id = `firm:${entry.record_id}`;
  }
  return {
    query: term, catalog_updated_at: catalog.updated_at, catalog_documents: Object.keys(catalog.documents).length,
    candidates: candidates.map((entry) => ({
      id: entry.id, title: entry.title, document_type: entry.document_type, practice_area: entry.practice_area,
      classification: entry.classification, classification_basis: entry.classification_basis,
      original: entry.original, source_extension: entry.source_extension, source_record_id: entry.record_id,
    })),
    note: 'Templates are fillable originals; samples guide a new draft. Uncertain records need inspection. Original availability is checked again before copying.',
  };
}
