// PreToolUse hook for Edit|Write: block edits to protected paths.
//
// Exit 2 blocks the tool call and sends stderr to Claude. Exit 0 lets it through.
// Default deny: input that cannot be read or understood is blocked.
//
// The checks in protectedReason() must stay in step with the Read/Edit deny
// rules in .claude/settings.json.

import path from 'node:path';

const PREFIX = 'protect-paths hook:';

// Path handling is done on strings, not with the host's path rules, so a
// C:\ path is treated the same on Windows and on a Linux runner.
function normalise(p) {
  const forward = p.replace(/\\/g, '/');
  const collapsed = path.posix.normalize(forward);
  return collapsed.toLowerCase();
}

function isAbsolute(p) {
  return p.startsWith('/') || /^[a-z]:\//.test(p);
}

// Path relative to the repo root, or null when the file is outside the repo.
function relativeToRoot(filePath, rootDir) {
  const root = normalise(rootDir).replace(/\/+$/, '');
  let file = normalise(filePath);
  if (!isAbsolute(file)) file = normalise(`${root}/${file}`);
  if (!file.startsWith(`${root}/`)) return null;
  return file.slice(root.length + 1);
}

function protectedReason(rel) {
  const segments = rel.split('/');
  const name = segments[segments.length - 1];
  const folders = segments.slice(0, -1);

  if (name === '.env') return 'env file';
  if (name.startsWith('.env.')) return 'env file';
  if (name.endsWith('.tfstate')) return 'Terraform state';
  if (name.includes('.tfstate.')) return 'Terraform state';
  if (name.endsWith('.tfvars')) return 'Terraform variables';
  if (folders.includes('data')) return 'data folder';
  if (rel.startsWith('03-agents/traces/')) return 'real agent traces';
  if (rel === '03-agents/jml/tenant.local.json') return 'local tenant file';
  return null;
}

function block(message) {
  process.stderr.write(`${PREFIX} ${message}\n`);
  process.exit(2);
}

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  block('blocked, hook input is not valid JSON.');
}

const filePath = input?.tool_input?.file_path;
if (typeof filePath !== 'string' || filePath === '') {
  block('blocked, hook input has no tool_input.file_path.');
}

const rootDir = process.env.CLAUDE_PROJECT_DIR || input.cwd;
if (typeof rootDir !== 'string' || rootDir === '') {
  block('blocked, project directory is unknown.');
}

const rel = relativeToRoot(filePath, rootDir);
if (rel !== null) {
  const reason = protectedReason(rel);
  if (reason) {
    block(`blocked edit to ${rel} (${reason}). This path is protected by CLAUDE.md. Ask Will for a safe view instead.`);
  }
}

process.exit(0);
