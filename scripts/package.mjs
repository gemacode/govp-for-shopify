import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const staging = mkdtempSync(join(tmpdir(), 'govp-shopify-'));
const target = join(staging, 'govp-for-shopify');
const excluded = new Set(['.git', 'node_modules', '.wrangler', 'dist']);
cpSync(root, target, { recursive: true, filter: (source) => !source.split('/').some((part) => excluded.has(part)) && !source.endsWith('.dev.vars') });
mkdirSync(resolve(root, 'dist'), { recursive: true });
const output = resolve(root, 'dist/govp-for-shopify-0.1.0-source.zip');
rmSync(output, { force: true });
const result = spawnSync('zip', ['-q', '-r', output, 'govp-for-shopify'], { cwd: staging, encoding: 'utf8' });
rmSync(staging, { recursive: true, force: true });
if (result.status !== 0) throw new Error(result.stderr || 'Unable to create source ZIP.');
console.log(output);

