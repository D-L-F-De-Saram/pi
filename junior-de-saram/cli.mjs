import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { workspaceRoot } from './core/artifacts.mjs';
import { runtimeArgs } from './core/runtime.mjs';

await mkdir(workspaceRoot(), { recursive: true });
const activeWorkspace = path.join(workspaceRoot(), `cli-${randomUUID()}`);
await mkdir(activeWorkspace, { recursive: true, mode: 0o700 });
const child = spawn(process.execPath, ['packages/coding-agent/dist/bundle/cli.js', '--session-dir', process.env.JUNIOR_DE_SARAM_SESSION_DIR || '/data/sessions', ...runtimeArgs(), '--extension', '.pi/extensions/junior-de-saram-local-trace.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, JUNIOR_DE_SARAM_ACTIVE_WORKSPACE: activeWorkspace } });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
