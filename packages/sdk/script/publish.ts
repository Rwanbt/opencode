#!/usr/bin/env bun

import { $ } from 'bun';
import fs from 'fs/promises';
import path from 'path';

console.log('=== Generating SDKs ===');
console.log();

import { createClient, defaultPlugins } from '@hey-api/openapi-ts';

const dir = new URL('..', import.meta.url).pathname;
await $`bun run ../opencode/src/index.ts generate > openapi.json`.cwd(dir);

await createClient({
  input: './openapi.json',
  output: './js',
  plugins: [
    {
      name: '@hey-api/typescript',
      exportFromIndex: false,
    },
    {
      name: '@hey-api/sdk',
      asClass: true,
      exportFromIndex: false,
      auth: false,
    },
    {
      name: '@hey-api/client-fetch',
      exportFromIndex: false,
      baseUrl: 'http://localhost:4096',
    },
  ],
});

/*
await fs.rm(path.join(dir, 'js'), { recursive: true, force: true });
await fs.rm(path.join(dir, 'go'), { recursive: true, force: true });

await $`stl builds create --branch dev --pull --allow-empty --+target go --+target typescript`.cwd(dir);

await $`mv opencode-go/ go`;
await fs.rm(path.join(dir, 'go', '.git'), { recursive: true, force: true });

await $`mv opencode-typescript/ js`;
await $`rm -rf js/.git`.cwd(dir);
await $`rm -rf js/yarn.lock`.cwd(dir);
*/
