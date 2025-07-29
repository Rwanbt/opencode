#!/usr/bin/env bun

import { $ } from 'bun';
import fs from 'fs/promises';
import path from 'path';

console.log('=== Generating SDKs ===');
console.log();

const dir = new URL('..', import.meta.url).pathname;

await fs.rm(path.join(dir, 'js'), { recursive: true, force: true });
await fs.rm(path.join(dir, 'go'), { recursive: true, force: true });

await $`bun run ../opencode/src/index.ts generate > openapi.json`.cwd(dir);
await $`stl builds create --branch dev --pull --allow-empty --+target go --+target typescript`.cwd(dir);

await $`mv opencode-go/ go`;
await fs.rm(path.join(dir, 'go', '.git'), { recursive: true, force: true });
await $`mv opencode-typescript/ js`;
await fs.rm(path.join(dir, 'js', '.git'), { recursive: true, force: true });
