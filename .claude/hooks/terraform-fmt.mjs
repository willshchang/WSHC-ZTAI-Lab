// PostToolUse hook for Edit|Write: run `terraform fmt` on the edited .tf file.
//
// The tool has already run, so this hook cannot block. Exit 2 only shows
// stderr to Claude, which is used when terraform cannot format the file.

import { spawnSync } from 'node:child_process';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}

const filePath = input?.tool_input?.file_path;
if (typeof filePath !== 'string' || !filePath.toLowerCase().endsWith('.tf')) {
  process.exit(0);
}

// Argument array and no shell, so the file name is never parsed as a command.
const result = spawnSync('terraform', ['fmt', filePath], { encoding: 'utf8' });

// Terraform is not installed: nothing to do.
if (result.error) process.exit(0);

if (result.status !== 0) {
  process.stderr.write(`terraform-fmt hook: terraform fmt failed on ${filePath}\n${result.stderr ?? ''}`);
  process.exit(2);
}

process.exit(0);
