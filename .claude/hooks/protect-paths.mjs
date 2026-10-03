// PreToolUse hook for Edit|Write: block edits to protected paths.
//
// Exit 2 blocks the tool call and sends stderr to Claude. Exit 0 lets it through.
// Default deny: input that cannot be read or understood is blocked, and so is
// any path written in a form Windows would quietly resolve to another file.
//
// The checks in protectedName() and protectedInRepo() must stay in step with
// the Read/Edit deny rules in .claude/settings.json. The name checks are
// stricter than those rules on purpose: they apply outside the repo too.

import path from 'node:path';

const PREFIX = 'protect-paths hook:';

// Path handling is done on strings, not with the host's path rules, so a
// C:\ path is treated the same on Windows and on a Linux runner.
function normalise(p) {
  const forward = p.replace(/\\/g, '/');
  // \\?\C:\... and \\.\C:\... name the same file as C:\...
  const bare = forward.replace(/^\/\/[?.]\//, '');
  const collapsed = path.posix.normalize(bare);
  const lower = collapsed.toLowerCase();
  // Git Bash writes C:\ as /c/
  return lower.replace(/^\/([a-z])\//, '$1:/');
}

function isAbsolute(p) {
  return p.startsWith('/') || /^[a-z]:\//.test(p);
}

// Windows drops a trailing dot or space from a name, and "name:stream" opens
// a stream of "name". Either would let a protected file slip past the checks
// below, so a path with such a segment is refused outright.
function oddSegment(segments) {
  for (const [index, segment] of segments.entries()) {
    if (segment.endsWith('.')) return segment;
    if (segment.endsWith(' ')) return segment;
    const isDrive = index === 0 && /^[a-z]:$/.test(segment);
    if (segment.includes(':') && !isDrive) return segment;
  }
  return null;
}

// Checked on every path, inside or outside the repo.
function protectedName(name) {
  if (name === '.env') return 'env file';
  if (name.startsWith('.env.')) return 'env file';
  if (name.endsWith('.tfstate')) return 'Terraform state';
  if (name.includes('.tfstate.')) return 'Terraform state';
  if (name.endsWith('.tfvars')) return 'Terraform variables';
  return null;
}

// Checked on the path relative to the repo root.
function protectedInRepo(rel) {
  const folders = rel.split('/').slice(0, -1);
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

const root = normalise(rootDir).replace(/\/+$/, '');
let file = normalise(filePath);
if (!isAbsolute(file)) file = normalise(`${root}/${file}`);

const segments = file.split('/').filter((segment) => segment !== '');
const name = segments[segments.length - 1] ?? '';
// Path relative to the repo root, or null when the file is outside the repo.
const rel = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : null;

const odd = oddSegment(segments);
if (odd !== null) {
  block(`blocked edit to ${file}. The segment "${odd}" ends in a dot or space, or contains a colon, so the real target cannot be checked.`);
}

const tail = 'This path is protected by CLAUDE.md. Ask Will for a safe view instead.';

const nameReason = protectedName(name);
if (nameReason) {
  block(`blocked edit to ${rel ?? file} (${nameReason}). ${tail}`);
}

if (rel !== null) {
  const repoReason = protectedInRepo(rel);
  if (repoReason) {
    block(`blocked edit to ${rel} (${repoReason}). ${tail}`);
  }
}

process.exit(0);
