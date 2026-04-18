import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChangedFile, FileStatus, Hunk } from '../types/index.js';
import { exec } from './exec.js';

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

/**
 * Parse unified diff text into ChangedFile[]. Supports multi-file diffs and
 * binary files (skipped). Tracks line numbers in both old and new file space.
 */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const lines = diff.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git')) {
      const m = /diff --git a\/(.+) b\/(.+)/.exec(line);
      let oldPath = m?.[1];
      let newPath = m?.[2];
      let status: FileStatus = 'M';
      i += 1;
      // Consume header block until we hit hunks or next diff
      let binary = false;
      while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('diff --git')) {
        const h = lines[i]!;
        if (h.startsWith('new file mode')) status = 'A';
        else if (h.startsWith('deleted file mode')) status = 'D';
        else if (h.startsWith('rename from')) status = 'R';
        else if (h.startsWith('--- a/')) oldPath = h.slice(6);
        else if (h.startsWith('--- /dev/null')) status = 'A';
        else if (h.startsWith('+++ b/')) newPath = h.slice(6);
        else if (h.startsWith('+++ /dev/null')) status = 'D';
        else if (h.startsWith('Binary files')) binary = true;
        i += 1;
      }
      if (binary || !newPath) continue;
      const path = status === 'D' ? (oldPath ?? newPath) : newPath;
      const hunks: Hunk[] = [];
      const addedLineNumbers: number[] = [];
      const removedLineNumbers: number[] = [];
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
  return files;
}

export interface GitDiffOptions {
  base?: string;
  projectRoot: string;
  includeUntracked?: boolean;
}

/**
 * Produce a ChangedFile[] from the working tree. Combines:
 *   - `git diff <base>` (tracked changes)
 *   - untracked files treated as full-add diffs (optional)
 */
export function collectChangedFiles(opts: GitDiffOptions): ChangedFile[] {
  const base = opts.base ?? 'HEAD';
  const root = opts.projectRoot;
  const isGit = existsSync(resolve(root, '.git'));
  if (!isGit) return [];

  const diff = exec('git', ['diff', '--no-color', '--unified=3', base], root);
  let files = diff.code === 0 ? parseUnifiedDiff(diff.stdout) : [];

  if (opts.includeUntracked !== false) {
    const untracked = exec('git', ['ls-files', '--others', '--exclude-standard'], root);
    if (untracked.code === 0) {
      const paths = untracked.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const p of paths) {
        const abs = resolve(root, p);
        if (!existsSync(abs)) continue;
        try {
          const st = statSync(abs);
          if (!st.isFile() || st.size > 5 * 1024 * 1024) continue;
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
        } catch {
          /* ignore unreadable files */
        }
      }
    }
  }

  // Attach current file content (best effort) for engines that need full text
  for (const f of files) {
    if (f.status === 'D' || f.content) continue;
    const abs = resolve(root, f.path);
    if (existsSync(abs)) {
      try {
        const st = statSync(abs);
        if (st.isFile() && st.size < 5 * 1024 * 1024) f.content = readFileSync(abs, 'utf8');
      } catch {
        /* skip */
      }
    }
  }
  return files;
}
