// Path helpers that survive Windows junction/localised-folder differences.
//
// On this machine the working copy lives under `...\Documenti\...` while Node's
// module loader canonicalises it to `...\Documents\...`. Comparing naive string
// paths therefore fails even for the very same file, and `path.relative(cwd, x)`
// produces nonsense like `..\..\Documents\...`. Both helpers below canonicalise
// first.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Canonicalise when possible, fall back to the literal path. */
export function canonical(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * True when `importMetaUrl` is the script Node was asked to run.
 *
 * Note: `import.meta.main` cannot be used here - inside this module it would
 * describe paths.mjs itself, not the caller. Comparing canonicalised paths is
 * the only correct option, and it also absorbs the junction-name difference
 * between `process.argv[1]` and `import.meta.url` on Windows.
 */
export function isMainModule(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return canonical(entry) === canonical(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}

/** Short, forward-slashed path relative to the project root when inside it. */
export function prettyPath(target) {
  const absolute = canonical(target);
  const base = canonical(process.cwd());
  const relative = path.relative(base, absolute);
  if (relative && !relative.startsWith('..')) return relative.replace(/\\/g, '/');
  return absolute.replace(/\\/g, '/');
}
