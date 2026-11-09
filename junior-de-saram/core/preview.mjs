import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

const maxDocxBytes = 40 * 1024 * 1024;
const maxXmlBytes = 12 * 1024 * 1024;
const maxHtmlChars = 180000;

function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function decodeXml(value) { return String(value).replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity]); }

// Read one known member from the ZIP central directory; never extract paths.
export function docxXml(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maxDocxBytes || bytes.length < 22) throw Error('Document is too large or invalid');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('Invalid DOCX archive');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('Invalid DOCX entry');
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === 'word/document.xml') {
      if (size > maxXmlBytes || compressed > maxXmlBytes) throw Error('DOCX content exceeds preview limit');
      const local = bytes.readUInt32LE(offset + 42);
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('Invalid DOCX member');
      const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (data + compressed > bytes.length) throw Error('Truncated DOCX member');
      const contents = bytes.subarray(data, data + compressed);
      const xml = method === 8 ? inflateRawSync(contents, { maxOutputLength: maxXmlBytes }) : method === 0 ? contents : undefined;
      if (!xml || xml.length !== size || /<!DOCTYPE|<!ENTITY/i.test(xml.toString('utf8', 0, 1000))) throw Error('Unsupported DOCX content');
      return xml.toString('utf8');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw Error('DOCX has no document body');
}

export function previewMarkup(bytes, filePath) {
  const xml = docxXml(bytes);
  const title = path.posix.basename(filePath, '.docx').replace(/[_-]+/g, ' ');
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((match) => {
    const content = [...match[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)].map((item) => item[1] === undefined ? ' ' : decodeXml(item[1])).join('');
    if (!content.trim()) return '';
    const heading = /<w:pStyle\b[^>]*w:val="(?:Heading|Title|Subtitle)/i.test(match[1]);
    return heading ? `<h2>${escapeHtml(content)}</h2>` : `<p>${escapeHtml(content)}</p>`;
  }).filter(Boolean);
  const body = paragraphs.join('\n').slice(0, maxHtmlChars) || '<p>No extractable text was found in this DOCX.</p>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#eef1f5;color:#172033;font-family:Georgia,serif;line-height:1.55}main{box-sizing:border-box;max-width:920px;margin:28px auto;padding:56px 64px;background:white;box-shadow:0 8px 28px #15263b22}h1,h2{line-height:1.25}p{margin:.7em 0;white-space:pre-wrap}.notice{font:14px system-ui;color:#475569;background:#f8fafc;border:1px solid #cbd5e1;padding:12px;border-radius:6px}@media(max-width:700px){main{margin:0;padding:25px}}</style></head><body><main><p class="notice">Text preview of the completed DOCX. Download the original for its full page layout and formatting.</p><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  const identifier = `de-saram-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 65)}-preview`;
  return `:::artifact{identifier="${identifier}" type="text/html" title="${escapeHtml(title)} — Preview"}\n\`\`\`\`html\n${html}\n\`\`\`\`\n:::`;
}
