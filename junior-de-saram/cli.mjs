import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { workspaceRoot } from './core/artifacts.mjs';
import { runtimeArgs } from './core/runtime.mjs';

await mkdir(workspaceRoot(), { recursive: true });
const child = spawn(process.execPath, ['packages/coding-agent/dist/bundle/cli.js', '--session-dir', process.env.JUNIOR_DE_SARAM_SESSION_DIR || '/data/sessions', ...runtimeArgs(), '--extension', '.pi/extensions/junior-de-saram-local-trace.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
