import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, realpath, copyFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const types = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json' };
const downloadTypes = { ...types, '.png': 'image/png' };
export const workspaceRoot = () => path.resolve(process.env.JUNIOR_DE_SARAM_WORKSPACE_ROOT || './junior-de-saram/workspaces');
const artifactRoot = () => path.resolve(process.env.JUNIOR_DE_SARAM_ARTIFACT_ROOT || './junior-de-saram/artifacts');
function signature(route) { const secret = process.env.JUNIOR_DE_SARAM_ARTIFACT_SECRET || process.env.JUNIOR_DE_SARAM_API_KEY; if (!secret) throw Error('Artifact signing secret is missing'); return createHmac('sha256', secret).update(route).digest('hex'); }

async function localPath(file) {
  const root = await realpath(workspaceRoot());
  const resolved = await realpath(path.resolve(file));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('File must be inside the legal workspace');
  if (!types[path.extname(resolved).toLowerCase()]) throw Error('Unsupported deliverable format');
  if ((await stat(resolved)).size > 50 * 1024 * 1024) throw Error('Artifact exceeds 50 MB');
  return resolved;
}

export async function materializePreviewImages(html) {
  const images = [...html.matchAll(/<img\b[^>]*\bsrc="data:image\/png;base64,([A-Za-z0-9+/=]+)"[^>]*>/gi)];
  if (!images.length) return html;
  {
    const fragments = [];
    let cursor = 0;
    for (const [index, image] of images.entries()) {
      const bytes = Buffer.from(image[1], 'base64');
      if (!bytes.length) continue;
    const digest = createHash('sha256').update(bytes).digest('hex');
    const dir = path.join(artifactRoot(), digest);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, 'preview.png'), bytes);
    const route = `/artifacts/${digest}/preview.png`;
    const url = `${(process.env.JUNIOR_DE_SARAM_PUBLIC_URL || 'http://127.0.0.1:8160').replace(/\/$/, '')}${route}?token=${signature(route)}`;
      fragments.push(html.slice(cursor, image.index), `<figure><img alt="Document page ${index + 1}" src="${url}"></figure>`);
      cursor = image.index + image[0].length;
    }
    html = `${fragments.join('')}${html.slice(cursor)}`;
  }
  return html;
}

export async function localPreview(file) {
  const resolved = await localPath(file);
  const { stdout } = await execute('python3', [new URL('../documents/preview.py', import.meta.url).pathname, resolved], { timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const title = path.basename(resolved).replace(/["\r\n<>]/g, ' ');
  const id = createHash('sha256').update(resolved).digest('hex').slice(0, 20);
  const html = await materializePreviewImages(stdout.trim());
  return `:::artifact{identifier="de-saram-${id}" type="text/html" title="${title} — Preview"}\n\`\`\`\`html\n${html}\n\`\`\`\`\n:::`;
}

export async function publishArtifact(file) {
  const resolved = await localPath(file);
  let validation;
  if (/\.(pdf|docx|pptx|xlsx)$/i.test(resolved)) {
    const { stdout } = await execute('python3', [new URL('../documents/validate.py', import.meta.url).pathname, resolved], { timeout: 120000, maxBuffer: 100000 });
    validation = JSON.parse(stdout);
    if (!validation.valid) throw Error(validation.error || 'Document validation failed');
  } else if (path.extname(resolved) === '.json') JSON.parse(await readFile(resolved, 'utf8'));
  const bytes = await readFile(resolved);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const name = path.basename(resolved).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(artifactRoot(), digest);
  await mkdir(dir, { recursive: true });
  await copyFile(resolved, path.join(dir, name));
  const route = `/artifacts/${digest}/${encodeURIComponent(name)}`;
  const download_url = `${(process.env.JUNIOR_DE_SARAM_PUBLIC_URL || 'http://127.0.0.1:8160').replace(/\/$/, '')}${route}?token=${signature(route)}`;
  let artifact_markup; let preview_warning;
  try { artifact_markup = await localPreview(resolved); } catch { preview_warning = 'The validated original is downloadable; a preview could not be rendered.'; }
  return { file_path: resolved, filename: name, bytes: bytes.length, download_url, validation, artifact_markup, preview_warning };
}

export async function artifactDownload(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const match = /^\/artifacts\/([a-f0-9]{64})\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  if (!match || match[2] === '..' || !downloadTypes[path.extname(match[2])]) { res.writeHead(404); return res.end(); }
  const token = Buffer.from(url.searchParams.get('token') || '');
  const expected = Buffer.from(signature(url.pathname));
  if (token.length !== expected.length || !timingSafeEqual(token, expected)) { res.writeHead(403); return res.end(); }
  const bytes = await readFile(path.join(artifactRoot(), match[1], match[2]));
  res.writeHead(200, { 'content-type': downloadTypes[path.extname(match[2])], 'content-length': bytes.length, 'content-disposition': `${match[2] === 'preview.png' ? 'inline' : 'attachment'}; filename="${match[2]}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' });
  res.end(bytes);
}
