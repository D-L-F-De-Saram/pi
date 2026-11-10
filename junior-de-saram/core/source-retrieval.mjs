import { readFile } from 'node:fs/promises';

const sources = { firm_document: 'legal_documents', book: 'legal_books', act: 'acts', regulation: 'regulations' };
const hidden = /embedding|hash|metadata_model|extractor_version/i;
const safeField = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const quote = (value) => { const text = String(value); if (/[`\\\r\n]/.test(text) || text.length > 500) throw Error('Invalid filter value'); return `\`${text}\``; };
const number = (value, fallback, maximum) => { const n = value ?? fallback; if (!Number.isInteger(n) || n < 1 || n > maximum) throw Error('Value outside supported range'); return n; };

async function request(suffix, parameters, fetcher) {
  const base = process.env.DESARAM_TYPESENSE_URL;
  const key = process.env.DESARAM_TYPESENSE_SEARCH_KEY;
  if (!base || !key) throw Error('Direct source retrieval needs its read-only database configuration.');
  const url = new URL(`${base.replace(/\/$/, '')}/${suffix}`);
  if (parameters) url.search = new URLSearchParams(parameters).toString();
  const response = await fetcher(url, { headers: { 'X-TYPESENSE-API-KEY': key }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Indexed source returned HTTP ${response.status}`);
  return response.json();
}

async function schemaFor(collection, fetcher) {
  try { return await request(`collections/${collection}`, undefined, fetcher); }
  catch (error) {
    if (!/HTTP 40[13]/.test(error.message)) throw error;
    const filename = { legal_documents: 'schema', legal_books: 'books_schema', acts: 'acts_schema', regulations: 'regulations_schema' }[collection];
    return { ...JSON.parse(await readFile(new URL(`../schemas/${filename}.json`, import.meta.url), 'utf8')), schema_origin: 'repository schema; live schema access unavailable' };
  }
}

function viewer(document, collection) {
  const base = process.env.DESARAM_DOCUMENT_VIEWER_URL;
  if (!base || !document.markdown_path) return undefined;
  const url = new URL(base);
  url.searchParams.set('view', 'document');
  url.searchParams.set('path', document.markdown_path.replace(/^\/+/, ''));
  url.searchParams.set('name', document.title_of_document || document.document_name || document.book_title || document.title || 'Document');
  if (document.practice_area) url.searchParams.set('area', document.practice_area);
  url.searchParams.set('collection', collection);
  if (document.start_page) url.searchParams.set('page', document.start_page);
  return url.toString();
}

function select(document, fields, maximum, collection) {
  const result = {};
  for (const field of fields) {
    const value = document[field] ?? field.split('.').reduce((part, name) => part?.[name], document);
    if (value === undefined) continue;
    result[field] = typeof value === 'string' && value.length > maximum ? { text: value.slice(0, maximum), truncated: true, total_characters: value.length } : value;
  }
  result.id = document.id;
  result.source_url = viewer(document, collection) || document.canonical_source_url || document.pdf_url;
  result.source_title = document.title_of_document || document.document_name || document.book_title || document.title;
  return result;
}

export async function retrieveSource(args, { fetcher = fetch } = {}) {
  const collection = sources[args.source];
  if (!collection) throw Error('Choose firm_document, book, act or regulation.');
  const schema = await schemaFor(collection, fetcher);
  const available = schema.fields.filter((field) => !hidden.test(field.name));
  const byName = new Map(available.map((field) => [field.name, field]));
  const fields = args.fields?.length ? args.fields : ['document_id', 'book_id', 'document_name', 'book_title', 'title', 'title_of_document', 'short_summary', 'text', 'pages', 'start_page', 'end_page', 'chunk_index', 'chunk_count', 'markdown_path', 'canonical_source_url', 'pdf_url'].filter((name) => byName.has(name));
  for (const field of fields) if (!byName.has(field)) throw Error(`Unsupported source field: ${field}`);
  const maximum = number(args.max_field_characters, 12000, 60000);
  const page = number(args.page, 1, 10000);
  const pageSize = number(args.page_size, 10, 30);
  if (args.operation === 'capabilities') return { source: args.source, schema_origin: schema.schema_origin || 'live', fields: available.map(({ name, type, facet, index }) => ({ name, type, facet: Boolean(facet), searchable: index !== false })), operations: ['capabilities', 'facet_values', 'find', 'retrieve', 'read_document'], note: 'Text is chunked. Page counts and hit counts can describe chunks; use logical document IDs and returned continuation data.' };
  const filters = [];
  for (const filter of args.filters || []) {
    if (!safeField.test(filter.field) || !byName.has(filter.field)) throw Error('Unsupported filter field');
    const definition = byName.get(filter.field);
    const operator = filter.operator || 'eq';
    const operators = { eq: ':=', gte: ':>=', lte: ':<=', gt: ':>', lt: ':<' };
    if (!operators[operator]) throw Error('Unsupported filter operator');
    if (/^int|^float/.test(definition.type)) {
      if (typeof filter.value !== 'number' || !Number.isFinite(filter.value)) throw Error('Numeric filter needs a finite number');
      filters.push(`${filter.field}${operators[operator]}${filter.value}`);
    } else if (definition.type === 'bool') {
      if (typeof filter.value !== 'boolean' || operator !== 'eq') throw Error('Boolean filters need true or false');
      filters.push(`${filter.field}:=${filter.value}`);
    } else {
      if (!definition.facet || operator !== 'eq') throw Error('Exact text filters require an indexed facet');
      filters.push(`${filter.field}:=${quote(filter.value)}`);
    }
  }
  const common = { filter_by: filters.join(' && '), exclude_fields: 'embedding' };
  if (args.operation === 'facet_values') {
    if (!byName.get(args.facet_field)?.facet) throw Error('Choose a returned facet field');
    const data = await request(`collections/${collection}/documents/search`, { ...common, q: '*', query_by: 'text', per_page: 0, facet_by: args.facet_field, max_facet_values: 250, ...(args.facet_query ? { facet_query: `${args.facet_field}:${args.facet_query}` } : {}) }, fetcher);
    const facet = data.facet_counts?.[0];
    return { source: args.source, field: args.facet_field, values: facet?.counts || [], matching_chunks: data.found, possibly_truncated: (facet?.counts?.length || 0) >= 250, note: 'Counts represent indexed chunks, not unique documents. Multiple labels may refer to different entities; do not silently discard alternatives.' };
  }
  let document;
  if (['retrieve', 'read_document'].includes(args.operation)) {
    if (!args.record_id || args.record_id.length > 500) throw Error('Supply a record_id returned by find');
    const selected = await request(`collections/${collection}/documents/search`, { q: '*', query_by: 'text', filter_by: `id:=${quote(args.record_id)}`, per_page: 1, exclude_fields: 'embedding' }, fetcher);
    document = selected.hits?.[0]?.document;
    if (!document) throw Error('Selected source record was not found');
    if (args.operation === 'retrieve') return { source: args.source, record: select(document, fields, maximum, collection) };
    if (!document.markdown_path || !process.env.DESARAM_FILE_SERVER_URL) throw Error('This record has no configured full-document route; retrieve its text chunks instead.');
    const parts = document.markdown_path.replace(/^\/+/, '').split('/');
    if (parts.some((part) => part === '..') || document.markdown_path.includes('://')) throw Error('Invalid indexed document path');
    const response = await fetcher(`${process.env.DESARAM_FILE_SERVER_URL.replace(/\/$/, '')}/doc/${parts.map(encodeURIComponent).join('/')}`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Document source returned HTTP ${response.status}`);
    const bytes = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) throw Error('Document exceeds the full-text reading limit; retrieve indexed chunks instead.'); bytes.push(chunk); }
    const text = Buffer.concat(bytes).toString('utf8');
    const offset = args.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw Error('Invalid document offset');
    return { source: args.source, record: select(document, fields.filter((name) => name !== 'text'), maximum, collection), text: text.slice(offset, offset + maximum), offset, total_characters: text.length, has_more: offset + maximum < text.length, next_offset: offset + maximum < text.length ? offset + maximum : null };
  }
  if (args.operation !== 'find') throw Error('Unsupported retrieval operation');
  const queryFields = ['title_of_document', 'document_name', 'book_title', 'title', 'short_summary', 'text'].filter((name) => byName.has(name)).join(',');
  const sort = args.sort_field;
  if (sort && (!byName.has(sort) || !/^int|^float/.test(byName.get(sort).type))) throw Error('Sort only by a numeric field returned by capabilities');
  const data = await request(`collections/${collection}/documents/search`, { ...common, q: args.query || '*', query_by: queryFields, include_fields: [...new Set([...fields, 'id', 'markdown_path', 'title_of_document', 'document_name', 'book_title', 'title'])].join(','), page, per_page: pageSize, ...(sort ? { sort_by: `${sort}:${args.sort_order === 'desc' ? 'desc' : 'asc'}` } : {}) }, fetcher);
  const records = (data.hits || []).map((hit) => select(hit.document, fields, maximum, collection));
  return { source: args.source, records, found_chunks: data.found || 0, returned: records.length, page, has_more: page * pageSize < data.found, next_page: page * pageSize < data.found ? page + 1 : null, applied_filters: args.filters || [], note: 'Results are chunks. Retain distinct logical document IDs and inspect later pages before claiming a complete document list.' };
}
