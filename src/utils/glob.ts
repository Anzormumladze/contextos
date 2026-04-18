/**
 * Minimal glob matcher supporting `*`, `**`, `?`, and `{a,b}` alternation.
 * Zero dependencies so the MCP boots fast and works offline.
 */

function escapeRegex(ch: string): string {
  return ch.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

export function globToRegex(glob: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** — match any path segments
        re += '.*';
        i += 2;
        if (glob[i] === '/') i += 1;
        continue;
      }
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end !== -1) {
        const alts = glob
          .slice(i + 1, end)
          .split(',')
          .map((a) => a.split('').map(escapeRegex).join(''));
        re += `(?:${alts.join('|')})`;
        i = end + 1;
        continue;
      }
    }
    re += escapeRegex(c);
    i += 1;
  }
  re += '$';
  return new RegExp(re);
}

export function matchAny(path: string, patterns: string[]): boolean {
  const normalized = path.replace(/\\/g, '/');
  return patterns.some((p) => globToRegex(p).test(normalized));
}
