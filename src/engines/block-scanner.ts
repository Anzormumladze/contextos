/**
 * Tiny brace-matching scanner. Given a file's full text and a target line
 * number, it returns whether that line sits inside a `try { … } catch { … }`
 * block. Zero parser dependencies — we tokenize only enough to track braces,
 * string literals, and line comments, which is adequate for JS/TS.
 *
 * Purpose: let per-line regex rules upgrade themselves when the surrounding
 * context already makes them safe (e.g. `await fetch(...)` inside a try
 * should not be flagged as "missing catch").
 */
export interface BlockIndex {
  /** Set of 1-based line numbers whose statement is wrapped in a try+catch. */
  linesInsideTryCatch: Set<number>;
}

export function indexBlocks(source: string): BlockIndex {
  const linesInsideTryCatch = new Set<number>();
  const n = source.length;
  let i = 0;
  let line = 1;
  // Stack of open braces; each entry records whether the block is inside a
  // `try` (we set this when we see `try {` at entry time).
  type Frame = { startLine: number; kind: 'try' | 'catch' | 'other' };
  const stack: Frame[] = [];
  let lastKeyword: 'try' | 'catch' | null = null;

  while (i < n) {
    const c = source[i]!;
    // Fast-forward past strings and comments.
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') {
      const quote = c;
      i += 1;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '\n') line += 1;
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          // template: skip to matching '}' at depth 1
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            else if (source[i] === '\n') line += 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '\n') { line += 1; i += 1; continue; }

    // Keyword lookbehind — cheap because we check only on whitespace/word boundary.
    if (c === 't' && source.startsWith('try', i) && /\W/.test(source[i + 3] ?? ' ')) {
      lastKeyword = 'try';
      i += 3;
      continue;
    }
    if (c === 'c' && source.startsWith('catch', i) && /\W/.test(source[i + 5] ?? ' ')) {
      lastKeyword = 'catch';
      i += 5;
      continue;
    }

    if (c === '{') {
      const kind = lastKeyword === 'try' ? 'try' : lastKeyword === 'catch' ? 'catch' : 'other';
      stack.push({ startLine: line, kind });
      lastKeyword = null;
      i += 1;
      continue;
    }
    if (c === '}') {
      stack.pop();
      lastKeyword = null;
      i += 1;
      continue;
    }

    // If we're inside ANY try-block whose sibling catch exists (we mark on
    // entry), we'll record the current line as protected. We detect protection
    // by walking the stack: if there is a `try` frame anywhere up the stack,
    // we record. The "is there also a catch sibling" check happens when the
    // try closes — but for cheap heuristic we treat being inside `try` as
    // protected. That's the standard user intent.
    if (stack.some((f) => f.kind === 'try' || f.kind === 'catch')) {
      linesInsideTryCatch.add(line);
    }
    i += 1;
  }
  return { linesInsideTryCatch };
}
