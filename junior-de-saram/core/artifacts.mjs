import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chatFolders, currentChat, readChatFile } from './chat-scope.mjs';

const execute = promisify(execFile);
const types = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json' };
const downloadTypes = { ...types, '.png': 'image/png' };
export const workspaceRoot = () => path.resolve(process.env.JUNIOR_DE_SARAM_WORKSPACE_ROOT || './junior-de-saram/workspaces');
const artifactRoot = () => currentChat().folders.artifacts;
const requestPreviews = new WeakMap();
function signature(userHash, chatHash, operationId, filename, expiresAt) {
  const secret = process.env.JUNIOR_DE_SARAM_ARTIFACT_SECRET;
  if (!secret) throw Error('Artifact signing secret is missing');
  return createHmac('sha256', secret).update(['download', userHash, chatHash, operationId, filename, expiresAt].join('\0')).digest('hex');
}
function signedUrl(operationId, filename) {
  const chat = currentChat();
  if (chat.native) return undefined;
  const expiresAt = Math.floor(Date.now() / 1000) + Number(process.env.DS_LINK_TTL_HOURS || 168) * 3600;
  const token = signature(chat.userHash, chat.chatHash, operationId, filename, expiresAt);
  const base = (process.env.JUNIOR_DE_SARAM_PUBLIC_URL || 'http://127.0.0.1:8160').replace(/\/$/, '');
  return `${base}/artifacts/${token}/${chat.userHash}/${chat.chatHash}/${operationId}/${encodeURIComponent(filename)}?exp=${expiresAt}`;
}

async function localPath(file, only = ['workspace']) {
  const source = await readChatFile(file, { only });
  if (!types[path.extname(source.name).toLowerCase()]) throw Error('Unsupported deliverable format');
  return source;
}

export async function materializePreviewImages(html, operationId) {
  const images = [...html.matchAll(/<img\b[^>]*\bsrc="data:image\/png;base64,([A-Za-z0-9+/=]+)"[^>]*>/gi)];
  if (!images.length) return html;
  const fragments = [];
  let cursor = 0;
  for (const [index, image] of images.entries()) {
    const bytes = Buffer.from(image[1], 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw Error('Preview image exceeds the allowed size');
    const dir = path.join(artifactRoot(), operationId);
    await mkdir(dir, { recursive: true });
    const filename = `preview-${index + 1}.png`;
    await writeFile(path.join(dir, filename), bytes, { flag: 'wx', mode: 0o600 });
    const url = signedUrl(operationId, filename);
    fragments.push(html.slice(cursor, image.index), `<figure><img alt="Document page ${index + 1}" src="${url || path.join(dir, filename)}"></figure>`);
    cursor = image.index + image[0].length;
  }
  return `${fragments.join('')}${html.slice(cursor)}`;
}

async function renderPreview(source, name) {
  const operationId = `preview-${randomUUID()}`;
  const dir = path.join(artifactRoot(), operationId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const resolved = path.join(dir, name);
  await writeFile(resolved, source.bytes, { flag: 'wx', mode: 0o600 });
  const { stdout } = await execute('python3', [fileURLToPath(new URL('../documents/preview.py', import.meta.url)), resolved], { timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const title = path.basename(resolved).replace(/["\r\n<>]/g, ' ');
  const id = createHash('sha256').update(resolved).digest('hex').slice(0, 20);
  const html = await materializePreviewImages(stdout.trim(), operationId);
  return `:::artifact{identifier="de-saram-${id}" type="text/html" title="${title} — Preview"}\n\`\`\`\`html\n${html}\n\`\`\`\`\n:::`;
}

function previewsForRequest() {
  const chat = currentChat();
  let previews = requestPreviews.get(chat);
  if (!previews) {
    previews = { renders: new Map(), publishedPaths: new Map() };
    requestPreviews.set(chat, previews);
  }
  return previews;
}

function previewIdentity(source, digest) {
  return createHash('sha256').update(source.realPath).update('\0').update(digest).digest('hex');
}

async function previewFor(source, name, preview_key, previews) {
  if (!previews.renders.has(preview_key)) {
    // Share the in-flight render as well. A failed render can be retried.
    previews.renders.set(preview_key, renderPreview(source, name).catch((error) => {
      previews.renders.delete(preview_key);
      throw error;
    }));
  }
  return { preview_key, artifact_markup: await previews.renders.get(preview_key) };
}

export async function localPreview(file) {
  const source = await localPath(file, ['workspace', 'artifacts']);
  const previews = previewsForRequest();
  const digest = createHash('sha256').update(source.bytes).digest('hex');
  const published = previews.publishedPaths.get(source.realPath);
  const key = published?.digest === digest ? published.key : previewIdentity(source, digest);
  return { ...await previewFor(source, source.name, key, previews), file_path: source.absolute };
}

export async function publishArtifact(file) {
  const source = await localPath(file);
  const operationId = `artifact-${randomUUID()}`;
  const dir = path.join(artifactRoot(), operationId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = source.name.replace(/[^A-Za-z0-9._-]/g, '_');
  const resolved = path.join(dir, name);
  await writeFile(resolved, source.bytes, { flag: 'wx', mode: 0o600 });
  let validation;
  if (/\.(pdf|docx|pptx|xlsx)$/i.test(resolved)) {
    const { stdout } = await execute('python3', [fileURLToPath(new URL('../documents/validate.py', import.meta.url)), resolved], { timeout: 120000, maxBuffer: 100000 });
    validation = JSON.parse(stdout);
    if (!validation.valid) throw Error(validation.error || 'Document validation failed');
  } else if (path.extname(resolved) === '.json') JSON.parse(await readFile(resolved, 'utf8'));
  const bytes = source.bytes;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const preview_key = previewIdentity(source, sha256);
  const previews = previewsForRequest();
  previews.publishedPaths.set(resolved, { digest: sha256, key: preview_key });
  const download_url = signedUrl(operationId, name);
  let artifact_markup; let preview_warning;
  try { ({ artifact_markup } = await previewFor(source, name, preview_key, previews)); } catch { preview_warning = 'The validated original is downloadable; a preview could not be rendered.'; }
  return { file_path: resolved, filename: name, bytes: bytes.length, sha256, download_url, validation, preview_key, artifact_markup, preview_warning };
}

export async function artifactDownload(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const match = /^\/artifacts\/([a-f0-9]{64})\/([a-f0-9]{32})\/([a-f0-9]{32})\/((?:artifact|preview)-[0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  const expiresAt = url.searchParams.get('exp');
  if (!match || !/^\d+$/.test(expiresAt || '') || !downloadTypes[path.extname(match[5])]) { res.writeHead(404); return res.end(); }
  const [, token, userHash, chatHash, operationId, name] = match;
  const expected = Buffer.from(signature(userHash, chatHash, operationId, name, expiresAt));
  const supplied = Buffer.from(token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(404); return res.end(); }
  if (Number(expiresAt) * 1000 <= Date.now()) { res.writeHead(410); return res.end(); }
  const file = path.join(chatFolders({ userHash, chatHash }).artifacts, operationId, name);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined);
  if (!handle) { res.writeHead(404); return res.end(); }
  let bytes;
  try { if (!(await handle.stat()).isFile()) { res.writeHead(404); return res.end(); } bytes = await handle.readFile(); }
  finally { await handle.close(); }
  res.writeHead(200, { 'content-type': downloadTypes[path.extname(name)], 'content-length': bytes.length, 'content-disposition': `${name.endsWith('.png') ? 'inline' : 'attachment'}; filename="${name}"`, 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' });
  res.end(bytes);
}
