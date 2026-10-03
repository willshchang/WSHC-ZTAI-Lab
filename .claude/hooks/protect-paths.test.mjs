// Checks for protect-paths.mjs. Run from the repo root: node --test .claude/hooks/
//
// Every case spawns the real hook with the JSON Claude Code would send on stdin.
// Sample paths use a made-up user folder; this repo is public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('./protect-paths.mjs', import.meta.url));
const WIN_ROOT = 'C:\\Users\\sample\\repo';
const POSIX_ROOT = '/home/sample/repo';

function runRaw(stdin, { projectDir } = {}) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== undefined) env.CLAUDE_PROJECT_DIR = projectDir;
  return spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8', env });
}

function run(filePath, { root = WIN_ROOT, tool = 'Edit' } = {}) {
  const stdin = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    cwd: root,
    tool_input: { file_path: filePath },
  });
  return runRaw(stdin, { projectDir: root });
}

function assertBlocked(result, label) {
  assert.equal(result.status, 2, `${label}: expected exit 2, got ${result.status}`);
  assert.match(result.stderr, /^protect-paths hook: blocked/, `${label}: stderr should carry the hook prefix`);
}

function assertAllowed(result, label) {
  assert.equal(result.status, 0, `${label}: expected exit 0, got ${result.status} (${result.stderr.trim()})`);
  assert.equal(result.stderr, '', `${label}: stderr should be empty`);
}

function blocked(name, paths, options) {
  test(`blocks: ${name}`, () => {
    for (const p of paths) assertBlocked(run(p, options), p);
  });
}

function allowed(name, paths, options) {
  test(`allows: ${name}`, () => {
    for (const p of paths) assertAllowed(run(p, options), p);
  });
}

// One group per protected pattern, each with a root-level and a nested path.

blocked('.env', ['.env', '03-agents/.env']);
blocked('.env.*', ['.env.local', '03-agents/.env.example']);
blocked('*.tfstate', ['terraform.tfstate', '01-identity/terraform/terraform.tfstate']);
blocked('*.tfstate.*', ['terraform.tfstate.backup', '02-network/terraform/terraform.tfstate.1700000000.backup']);
blocked('*.tfvars', ['terraform.tfvars', '01-identity/terraform/prod.tfvars']);
blocked('data folders', ['data/users.csv', '01-identity/data/hr/export.csv', '03-agents/jml/data/x.json']);
blocked('03-agents/traces', ['03-agents/traces/run.jsonl', '03-agents/traces/2026/run.jsonl']);
blocked('tenant.local.json', ['03-agents/jml/tenant.local.json']);

allowed('ordinary files', [
  'README.md',
  'CLAUDE.md',
  '03-agents/core/engine.ts',
  '03-agents/package.json',
  '01-identity/terraform/main.tf',
  '.claude/settings.json',
]);

allowed('near misses', [
  '.envrc',
  '03-agents/env.ts',
  'database/x.ts',
  '03-agents/core/data',
  '03-agents/core/data.ts',
  '03-agents/tracesx/run.jsonl',
  '03-agents/examples/sample-traces/run.jsonl',
  '03-agents/jml/tenant.example.json',
  'jml/tenant.local.json',
  '01-identity/terraform/tfvars.md',
  '01-identity/terraform/tfstate.md',
]);

test('blocks the Write tool the same way', () => {
  assertBlocked(run('03-agents/.env', { tool: 'Write' }), 'Write .env');
});

// Windows path forms.

blocked('backslash relative paths', [
  '03-agents\\traces\\run.jsonl',
  '01-identity\\terraform\\terraform.tfvars',
]);
allowed('backslash relative paths', [
  '03-agents\\core\\engine.ts',
  '01-identity\\terraform\\main.tf',
]);

blocked('full drive paths', [
  'C:\\Users\\sample\\repo\\03-agents\\.env',
  'C:\\Users\\sample\\repo\\02-network\\terraform\\terraform.tfstate.backup',
]);
allowed('full drive paths', [
  'C:\\Users\\sample\\repo\\README.md',
  'C:\\Users\\sample\\repo\\03-agents\\core\\engine.ts',
]);

blocked('mixed capital letters', [
  'c:\\USERS\\Sample\\Repo\\03-Agents\\JML\\Tenant.Local.json',
  '01-Identity\\Data\\Users.CSV',
  '.ENV',
  'Prod.TFVARS',
  '03-AGENTS\\Traces\\Run.jsonl',
  'Terraform.TFSTATE',
]);
allowed('mixed capital letters', [
  'c:\\USERS\\Sample\\Repo\\03-Agents\\Core\\Engine.ts',
  'ReadMe.MD',
]);

blocked('mixed separators', ['C:\\Users\\sample\\repo/03-agents/traces\\x.jsonl']);
allowed('mixed separators', ['C:\\Users\\sample\\repo/03-agents/core\\x.ts']);

allowed('paths outside the repo', [
  'C:\\Users\\sample\\other\\.env',
  'C:\\Users\\sample\\repo-two\\.env',
  'D:\\Users\\sample\\repo\\.env',
]);

// "." and ".." segments.

blocked('dot segments', [
  '03-agents\\core\\..\\.env',
  '03-agents/./traces/x.jsonl',
  '03-agents/core/../traces/x.jsonl',
  '01-identity/terraform/modules/../terraform.tfvars',
  'C:\\Users\\sample\\repo\\docs\\..\\03-agents\\jml\\tenant.local.json',
  'C:\\Users\\sample\\other\\..\\repo\\03-agents\\.env',
]);
allowed('dot segments', [
  '03-agents/traces/../core/x.ts',
  'data/../README.md',
  '..\\other\\.env',
  'C:\\Users\\sample\\repo\\..\\other\\.env',
]);

// POSIX roots, as on a Linux runner.

blocked('posix root', [
  '/home/sample/repo/03-agents/.env',
  '/home/sample/repo/01-identity/data/users.csv',
  '03-agents/traces/run.jsonl',
], { root: POSIX_ROOT });
allowed('posix root', [
  '/home/sample/repo/README.md',
  '/home/sample/other/.env',
], { root: POSIX_ROOT });

test('a trailing slash on the project dir changes nothing', () => {
  assertBlocked(run('C:\\Users\\sample\\repo\\03-agents\\.env', { root: 'C:\\Users\\sample\\repo\\' }), 'blocked');
  assertAllowed(run('C:\\Users\\sample\\repo\\README.md', { root: 'C:\\Users\\sample\\repo\\' }), 'allowed');
});

// Project directory lookup.

test('falls back to cwd when CLAUDE_PROJECT_DIR is not set', () => {
  const stdin = (p) => JSON.stringify({ cwd: WIN_ROOT, tool_input: { file_path: p } });
  assertBlocked(runRaw(stdin('C:\\Users\\sample\\repo\\03-agents\\.env')), 'blocked');
  assertAllowed(runRaw(stdin('C:\\Users\\sample\\repo\\README.md')), 'allowed');
});

// Default deny.

test('fails closed on input it cannot use', () => {
  assertBlocked(runRaw('', { projectDir: WIN_ROOT }), 'empty stdin');
  assertBlocked(runRaw('not json', { projectDir: WIN_ROOT }), 'invalid JSON');
  assertBlocked(runRaw('null', { projectDir: WIN_ROOT }), 'JSON null');
  assertBlocked(runRaw(JSON.stringify({ tool_input: {} }), { projectDir: WIN_ROOT }), 'no file_path');
  assertBlocked(runRaw(JSON.stringify({ tool_input: { file_path: '' } }), { projectDir: WIN_ROOT }), 'empty file_path');
  assertBlocked(runRaw(JSON.stringify({ tool_input: { file_path: 42 } }), { projectDir: WIN_ROOT }), 'non-string file_path');
  assertBlocked(runRaw(JSON.stringify({ tool_input: { file_path: 'README.md' } })), 'no project dir');
});
