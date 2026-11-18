#!/usr/bin/env node
// Non-destructive, explicit migration of one pre-isolation LibreChat conversation.
// The legacy volumes must be mounted read-only at /legacy/{uploads,workspaces,sessions}.
import { createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';

const userId = process.env.DS_MIGRATE_USER_ID || '';
const chatId = process.env.DS_MIGRATE_CHAT_ID || '';
const oldSecret = process.env.DS_LEGACY_API_KEY || process.env.JUNIOR_DE_SARAM_API_KEY || '';
const newSecret = process.env.DS_IDENTITY_SECRET || '';
const legacy = process.env.DS_LEGACY_ROOT || '/legacy';
const data = process.env.JUNIOR_DE_SARAM_DATA_ROOT || '/data';
if (!/^[a-f0-9]{24}$/.test(userId) || !/^[A-Za-z0-9_-]{8,128}$/.test(chatId) || oldSecret.length < 16 || newSecret.length < 32) {
  throw Error('Set valid DS_MIGRATE_USER_ID, DS_MIGRATE_CHAT_ID, DS_LEGACY_API_KEY, and DS_IDENTITY_SECRET');
}
const hash = (secret, text) => createHmac('sha256', secret).update(text).digest('hex').slice(0, 32);
const oldKey = hash(oldSecret, `${userId}:${chatId}`);
const userHash = hash(newSecret, `user\0${userId}`);
const chatHash = hash(newSecret, `chat\0${userId}\0${chatId}`);
const oldSessionId = `junior-de-saram-${oldKey}`;
const newSessionId = `junior-de-saram-${chatHash}`;
const oldWorkspace = path.join(legacy, 'workspaces', oldSessionId);
const oldUploads = path.join(legacy, 'uploads', oldKey);
const newRoot = path.join(data, 'users', userHash, 'chats', chatHash);
const replacements = [
  [`/data/workspaces/${oldSessionId}`, `${newRoot}/workspace`],
  [`/data/uploads/${oldKey}`, `${newRoot}/uploads`],
];

async function existingDirectory(directory) {
  try { return (await lstat(directory)).isDirectory(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function copyTree(source, target, budget) {
  if (!await existingDirectory(source)) return 0;
  await mkdir(target, { recursive: true, mode: 0o700 });
  let count = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) count += await copyTree(from, to, budget);
    else if (entry.isFile()) {
      const info = await lstat(from);
      budget.bytes += info.size;
      if (budget.bytes > 1024 * 1024 * 1024) throw Error('The selected chat exceeds the 1 GB migration limit');
      await copyFile(from, to);
      count += 1;
    } else throw Error('Legacy chat contains a symlink or special file; inspect it manually');
  }
  return count;
}

async function legacySessionFiles() {
  const directory = path.join(legacy, 'sessions');
  const found = [];
  for (const filename of await readdir(directory)) {
    if (!filename.endsWith('.jsonl')) continue;
    const file = path.join(directory, filename);
    if (!(await lstat(file)).isFile()) throw Error('Legacy session directory contains a non-regular JSONL file');
    const handle = createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: handle, crlfDelay: Infinity });
    const first = await lines[Symbol.asyncIterator]().next();
    lines.close(); handle.destroy();
    try { if (JSON.parse(first.value)?.id === oldSessionId) found.push(file); } catch { /* Not this chat's session. */ }
  }
  return found;
}

async function copySession(source, target) {
  const replacePaths = (value) => {
    if (typeof value === 'string') {
      let updated = value;
      for (const [oldPath, newPath] of replacements) updated = updated.replaceAll(oldPath, newPath);
      return updated;
    }
    if (Array.isArray(value)) return value.map(replacePaths);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replacePaths(item)]));
    return value;
  };
  const input = readline.createInterface({ input: createReadStream(source, { encoding: 'utf8' }), crlfDelay: Infinity });
  const output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
  try {
    for await (const line of input) {
      if (!line.trim()) continue;
      const record = replacePaths(JSON.parse(line));
      if (record.type === 'session' && record.id === oldSessionId) record.id = newSessionId;
      if (!output.write(`${JSON.stringify(record)}\n`)) await once(output, 'drain');
    }
    output.end();
    await once(output, 'finish');
  } finally { input.close(); output.destroy(); }
}

const sessionFiles = await legacySessionFiles();
const plan = { old_key: oldKey, user_hash: userHash, chat_hash: chatHash, session_files: sessionFiles.length, uploads_available: await existingDirectory(oldUploads), workspace_available: await existingDirectory(oldWorkspace), destination: newRoot };
if (process.env.DS_MIGRATE_APPLY !== '1') {
  console.log(JSON.stringify({ ...plan, mode: 'dry-run' }, null, 2));
} else {
  if (sessionFiles.length > 1) throw Error('More than one legacy session has this ID; inspect them before migrating');
  for (const folder of ['uploads', 'workspace', 'sessions', 'artifacts']) {
    const dest = path.join(newRoot, folder);
    if (await existingDirectory(dest) && (await readdir(dest)).length) throw Error(`Destination ${folder} is not empty; no migration was performed`);
  }
  const budget = { bytes: 0 };
  const uploads = await copyTree(oldUploads, path.join(newRoot, 'uploads'), budget);
  const workspace = await copyTree(oldWorkspace, path.join(newRoot, 'workspace'), budget);
  await mkdir(path.join(newRoot, 'sessions'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(newRoot, 'artifacts'), { recursive: true, mode: 0o700 });
  for (const file of sessionFiles) await copySession(file, path.join(newRoot, 'sessions', path.basename(file).replace(oldSessionId, newSessionId)));
  console.log(JSON.stringify({ ...plan, mode: 'copied', uploads, workspace_files: workspace, bytes: budget.bytes, note: 'Old volumes were not changed. Global legacy artifact links were not migrated.' }, null, 2));
}
