import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { booksDir } from './lib.mjs';

const entries = await readdir(booksDir, { withFileTypes: true }).catch(() => []);
for (const entry of entries.filter(e => e.isDirectory())) {
  const result = spawnSync(process.execPath, ['scripts/build.mjs', entry.name], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
