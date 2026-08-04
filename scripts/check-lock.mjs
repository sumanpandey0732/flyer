#!/usr/bin/env node
/**
 * Guard against a lockfile that `npm ci` will reject on the EAS builder.
 *
 * eas.json pins the builder to node 20.18.0, which ships npm 10.8.2.
 * @firebase/auth declares an *optional* peer on
 * @react-native-async-storage/async-storage@^1.18.1, and our root pin of 2.1.2
 * does not satisfy it. npm 10 covers that by materializing nested 1.24.0 copies
 * under firebase/ and @firebase/auth-compat/, and records them in the lock.
 * npm 11 prunes them instead.
 *
 * The two locks are therefore not interchangeable: run `npm install` locally
 * under npm 11 and it rewrites the file, dropping those entries, and the next
 * build dies with
 *
 *   Missing: @react-native-async-storage/async-storage@1.24.0 from lock file
 *
 * That has now broken two builds. It is easy to miss because npm rewrites the
 * lock as a side effect of unrelated commands and `git add -A` will happily
 * commit it under someone else's message.
 *
 * Run via `npm run check:lock`, or in CI before submitting a build.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Nested copies npm 10 requires and npm 11 removes. */
const REQUIRED_NESTED = [
  'node_modules/firebase/node_modules/@react-native-async-storage/async-storage',
  'node_modules/@firebase/auth-compat/node_modules/@react-native-async-storage/async-storage',
];

const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const missing = REQUIRED_NESTED.filter((p) => !lock.packages?.[p]);

if (missing.length > 0) {
  console.error('\npackage-lock.json was written by npm 11 and will fail on the EAS builder.\n');
  console.error('Missing nested entries that npm 10.8.2 expects:');
  for (const p of missing) console.error(`  ${p}`);
  console.error('\nRegenerate under the builder toolchain:\n');
  console.error('  nvm use 20.18.0        # ships npm 10.8.2');
  console.error('  npm install --package-lock-only\n');
  console.error('Then verify:\n');
  console.error('  npm ci --include=dev --dry-run   # must exit 0\n');
  process.exit(1);
}

console.log('package-lock.json OK — npm 10 nested async-storage entries present.');
