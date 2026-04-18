import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChangedFile, FileStatus, Hunk, SkippedFile } from '../types/index.js';
import { exec } from './exec.js';
import { toPosix } from './paths.js';

function languageFor(path: string): string | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return undefined;
  const ext = m[1]!.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript', py: 'python', go: 'go', rs: 'rust',
    java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php',
    cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
  };
  return map[ext];
}

function parseHunkHeader(line: string): Omit<Hunk, 'addedLines' | 'removedLines' | 'contextText'> | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!m) return null;
  return {
    oldStart: parseInt(m[1]!, 10),
    oldLines: m[2] ? parseInt(m[2], 10) : 1,
    newStart: parseInt(m[3]!, 10),
    newLines: m[4] ? parseInt(m[4], 10) : 1,
  };
}

export interface ParseOptions {
  maxLineBytes?: number;
  maxTotalBytes?: number;
}

export interface ParseOutput {
  files: ChangedFile[];
  skipped: SkippedFile[];
}

/**
 * Parse unified diff text into ChangedFile[]. Hardened against hostile input:
 *   - truncates if total size exceeds maxTotalBytes
 *   - skips hunks whose individual lines exceed maxLineBytes
 *   - emits a SkippedFile record for every skip so the caller can surface it.
 */
export function parseUnifiedDiffWithSkips(diff: string, opts: ParseOptions = {}): ParseOutput {
  const files: ChangedFile[] = [];
  const skipped: SkippedFile[] = [];
  const maxLineBytes = opts.maxLineBytes ?? 50 * 1024;
  const maxTotalBytes = opts.maxTotalBytes ?? 64 * 1024 * 1024;
  const truncated = Buffer.byteLength(diff, 'utf8') > maxTotalBytes
    ? diff.slice(0, maxTotalBytes)
    : diff;
  const lines = truncated.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git')) {
      const m = /diff --git a\/(.+) b\/(.+)/.exec(line);
      let oldPath = m?.[1] ? toPosix(m[1]) : undefined;
      let newPath = m?.[2] ? toPosix(m[2]) : undefined;
      let status: FileStatus = 'M';
      i += 1;
      let binary = false;
      while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('diff --git')) {
        const h = lines[i]!;
        if (h.startsWith('new file mode')) status = 'A';
        else if (h.startsWith('deleted file mode')) status = 'D';
        else if (h.startsWith('rename from')) status = 'R';
        else if (h.startsWith('--- a/')) oldPath = toPosix(h.slice(6));
        else if (h.startsWith('--- /dev/null')) status = 'A';
        else if (h.startsWith('+++ b/')) newPath = toPosix(h.slice(6));
        else if (h.startsWith('+++ /dev/null')) status = 'D';
        else if (h.startsWith('Binary files')) binary = true;
        i += 1;
      }
      if (binary) {
        if (newPath) skipped.push({ path: newPath, reason: 'binary' });
        continue;
      }
      if (!newPath) continue;
      const path = status === 'D' ? (oldPath ?? newPath) : newPath;
      const hunks: Hunk[] = [];
      const addedLineNumbers: number[] = [];
      const removedLineNumbers: number[] = [];
      let truncatedHunk = false;
      while (i < lines.length && lines[i]!.startsWith('@@')) {
        const header = parseHunkHeader(lines[i]!);
        i += 1;
        if (!header) continue;
        const addedLines: Hunk['addedLines'] = [];
        const removedLines: Hunk['removedLines'] = [];
        let newLineNo = header.newStart;
        let oldLineNo = header.oldStart;
        const contextParts: string[] = [];
        while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('diff --git')) {
          const hl = lines[i]!;
          if (hl.length > maxLineBytes) { truncatedHunk = true; i += 1; continue; }
          if (hl.startsWith('+') && !hl.startsWith('+++')) {
            addedLines.push({ lineNo: newLineNo, text: hl.slice(1) });
            addedLineNumbers.push(newLineNo);
            contextParts.push(hl);
            newLineNo += 1;
          } else if (hl.startsWith('-') && !hl.startsWith('---')) {
            removedLines.push({ lineNo: oldLineNo, text: hl.slice(1) });
            removedLineNumbers.push(oldLineNo);
            contextParts.push(hl);
            oldLineNo += 1;
          } else if (hl.startsWith(' ')) {
            contextParts.push(hl);
            newLineNo += 1;
            oldLineNo += 1;
          } else if (hl.startsWith('\\')) {
            // "\ No newline at end of file"
          } else if (hl === '') {
            contextParts.push(hl);
          } else {
            break;
          }
          i += 1;
        }
        hunks.push({ ...header, addedLines, removedLines, contextText: contextParts.join('\n') });
      }
      if (truncatedHunk) skipped.push({ path, reason: 'truncated-hunk', detail: `lines > ${maxLineBytes} bytes were dropped` });
      files.push({
        path,
        oldPath: oldPath !== newPath ? oldPath : undefined,
        status,
        hunks,
        addedLineNumbers,
        removedLineNumbers,
        totalAdded: addedLineNumbers.length,
        totalRemoved: removedLineNumbers.length,
        language: languageFor(path),
      });
    } else {
      i += 1;
    }
  }
  return { files, skipped };
}

/** Back-compat wrapper: same behaviour as before, returns ChangedFile[] only. */
export function parseUnifiedDiff(diff: string, opts: ParseOptions = {}): ChangedFile[] {
  return parseUnifiedDiffWithSkips(diff, opts).files;
}

export interface GitDiffOptions {
  base?: string;
  projectRoot: string;
  includeUntracked?: boolean;
  maxFileBytes?: number;
  maxLineBytes?: number;
  maxTotalBytes?: number;
}

export interface CollectOutput {
  files: ChangedFile[];
  skipped: SkippedFile[];
}

export function collectChangedFiles(opts: GitDiffOptions): CollectOutput {
  const base = opts.base ?? 'HEAD';
  const root = opts.projectRoot;
  const isGit = existsSync(resolve(root, '.git'));
  const skipped: SkippedFile[] = [];
  if (!isGit) return { files: [], skipped };

  const maxFileBytes = opts.maxFileBytes ?? 5 * 1024 * 1024;

  const diff = exec('git', ['diff', '--no-color', '--unified=3', base], root);
  const { files, skipped: diffSkipped } = diff.code === 0
    ? parseUnifiedDiffWithSkips(diff.stdout, { maxLineBytes: opts.maxLineBytes, maxTotalBytes: opts.maxTotalBytes })
    : { files: [], skipped: [] as SkippedFile[] };
  skipped.push(...diffSkipped);

  if (opts.includeUntracked !== false) {
    const untracked = exec('git', ['ls-files', '--others', '--exclude-standard'], root);
    if (untracked.code === 0) {
      const paths = untracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const raw of paths) {
        const p = toPosix(raw);
        const abs = resolve(root, p);
        if (!existsSync(abs)) continue;
        try {
          const st = statSync(abs);
          if (!st.isFile()) continue;
          if (st.size > maxFileBytes) {
            skipped.push({ path: p, reason: 'too-large', detail: `${st.size} bytes > ${maxFileBytes}` });
            continue;
          }
          const content = readFileSync(abs, 'utf8');
          const lineCount = content.split('\n').length;
          files.push({
            path: p,
            status: 'A',
            hunks: [{
              oldStart: 0, oldLines: 0,
              newStart: 1, newLines: lineCount,
              addedLines: content.split('\n').map((text, idx) => ({ lineNo: idx + 1, text })),
              removedLines: [],
              contextText: content.split('\n').map((l) => '+' + l).join('\n'),
            }],
            addedLineNumbers: Array.from({ length: lineCount }, (_, i) => i + 1),
            removedLineNumbers: [],
            totalAdded: lineCount,
            totalRemoved: 0,
            content,
            language: languageFor(p),
          });
        } catch (err) {
          skipped.push({ path: p, reason: 'unreadable', detail: (err as Error).message });
        }
      }
    }
  }

  for (const f of files) {
    if (f.status === 'D' || f.content) continue;
    const abs = resolve(root, f.path);
    if (existsSync(abs)) {
      try {
        const st = statSync(abs);
        if (!st.isFile()) continue;
        if (st.size > maxFileBytes) {
          skipped.push({ path: f.path, reason: 'too-large', detail: `${st.size} bytes > ${maxFileBytes}` });
          continue;
        }
        f.content = readFileSync(abs, 'utf8');
      } catch (err) {
        skipped.push({ path: f.path, reason: 'unreadable', detail: (err as Error).message });
      }
    }
  }
  return { files, skipped };
}
