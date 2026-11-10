// Explicit opt-in smoke test; prints metadata only, never source contents or keys.
import { retrieveSource } from '../core/source-retrieval.mjs';

for (const source of ['firm_document', 'book', 'act', 'regulation']) {
  const capabilities = await retrieveSource({ source, operation: 'capabilities' });
  const found = await retrieveSource({ source, operation: 'find', page_size: 1 });
  if (!found.records.length) throw Error(`${source} returned no test record`);
  const id = found.records[0].id;
  const selected = await retrieveSource({ source, operation: 'retrieve', record_id: id, fields: ['text'] });
  const full = await retrieveSource({ source, operation: 'read_document', record_id: id, max_field_characters: 1000 });
  if (!selected.record.text || !full.text || !full.record.source_url) throw Error(`${source} text/link missing`);
  const facet = capabilities.fields.find((field) => field.facet && field.type === 'string');
  let filtered = 0;
  if (facet) {
    const values = await retrieveSource({ source, operation: 'facet_values', facet_field: facet.name });
    if (values.values.length) {
      const result = await retrieveSource({ source, operation: 'find', filters: [{field:facet.name,value:values.values[0].value}], page_size: 1 });
      if (!result.returned) throw Error(`${source} filtered query failed`);
      filtered = result.found_chunks;
    }
  }
  console.log(JSON.stringify({ source, schema: capabilities.schema_origin, total_chunks:found.found_chunks, retrieved:true, full_document_characters:full.total_characters, filtered_chunks:filtered, continuation:full.has_more }));
}
