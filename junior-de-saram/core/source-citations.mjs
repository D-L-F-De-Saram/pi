export function sourceCitationText(text) {
  try {
    const data = JSON.parse(text);
    const records = data.records || (data.record ? [data.record] : []);
    return records.filter((record) => record.source_title && /^https?:\/\//.test(record.source_url || '')).map((record, index) => `[^db-${index + 1}]: [${String(record.source_title).replace(/[\[\]\r\n]/g, ' ')}](${record.source_url})${record.start_page ? `, p. ${record.start_page}` : ''}`).join('\n');
  } catch { return ''; }
}
