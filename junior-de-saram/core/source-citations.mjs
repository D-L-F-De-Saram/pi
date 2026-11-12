export function sourceCitationText(text, prefix = 'db') {
  try {
    const data = JSON.parse(text);
    const records = data.records || (data.record ? [data.record] : []);
    return records.filter((record) => record.source_title && /^https?:\/\//.test(record.source_url || '')).map((record, index) => `[^${prefix}-${index + 1}]: [${String(record.source_title).replace(/[\[\]\r\n]/g, ' ')}](${record.source_url})${record.start_page ? `, p. ${record.start_page}` : ''}`).join('\n');
  } catch { return ''; }
}

export function publicCitationText(text, prefix) {
  try {
    const data = JSON.parse(text);
    const results = Array.isArray(data.results) ? data.results : [];
    return results.flatMap((result, index) => {
      const title = String(result.title || '').replace(/[\[\]\r\n]/g, ' ').trim();
      const raw = result.url || result.link;
      if (!title || typeof raw !== 'string') return [];
      let url;
      try { url = new URL(raw); } catch { return []; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
      return [`[^${prefix}-${index + 1}]: [${title}](${url.href})`];
    }).join('\n');
  } catch { return ''; }
}
