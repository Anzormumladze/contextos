import { isAbsolute, relative, resolve, sep } from 'node:path';

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Make a path project-root-relative and posix-normalized. */
export function projectRelative(root: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(root, p);
  const rel = relative(root, abs);
  return toPosix(rel);
}

/**
 * Best-effort coverage-path match:
 *  1) exact match,
 *  2) match by trailing-suffix — handles the common monorepo case where
 *     Istanbul emits paths like `/runners/work/app/src/auth.ts` while the
 *     diff reports `src/auth.ts`. We walk the changed path from the end and
 *     pick the unique coverage entry that ends with the same tail.
 */
export function resolveCoverageKey(
  coverageFiles: Record<string, unknown>,
  changedPath: string,
): string | undefined {
  if (coverageFiles[changedPath]) return changedPath;
  const needle = '/' + toPosix(changedPath).replace(/^\.?\//, '');
  const keys = Object.keys(coverageFiles);
  const matches = keys.filter((k) => ('/' + toPosix(k)).endsWith(needle));
  if (matches.length === 1) return matches[0];
  return undefined;
}

export { sep };
