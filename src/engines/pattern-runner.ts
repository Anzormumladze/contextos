import type { ChangedFile, Finding } from '../types/index.js';
import type { PatternRule } from '../rules/patterns.js';
import { indexBlocks } from './block-scanner.js';

export interface PatternRunOptions {
  file: ChangedFile;
  rules: PatternRule[];
  addedOnly?: boolean;
  findingsPerRule?: number;
  regexTimeoutMs?: number;
}

/**
 * Runs per-line regex rules against a changed file and produces Findings.
 *
 *  - Hits are grouped per rule so 50 matches of one rule become one finding.
 *  - `findingsPerRule` caps how many affected lines we keep per rule.
 *  - `regexTimeoutMs` bounds per-line regex work (defensive against a hostile
 *    custom-rule pattern; we abort and keep partial results).
 *  - If a rule declares `blockAware`, matches inside a try/catch are skipped
 *    — that's how multi-line try/catch wrappers cancel per-line false-positives.
 */
export function runPatternRules(opts: PatternRunOptions): Finding[] {
  const { file, rules, addedOnly = true } = opts;
  if (!file.language) return [];
  const cap = opts.findingsPerRule ?? 20;
  const timeoutMs = opts.regexTimeoutMs ?? 250;
  const findings: Finding[] = [];
  const hits = new Map<string, { lines: number[]; evidence: string[]; rule: PatternRule; stopped?: boolean }>();

  const wantsBlockScan = rules.some((r) => r.blockAware);
  const blockIndex = wantsBlockScan && file.content ? indexBlocks(file.content) : null;

  const deadline = Date.now() + timeoutMs;

  const scanLine = (lineNo: number, text: string) => {
    for (const rule of rules) {
      if (Date.now() > deadline) return;
      if (rule.languages && !rule.languages.includes(file.language!)) continue;
      const bucket = hits.get(rule.id);
      if (bucket && bucket.lines.length >= cap) { bucket.stopped = true; continue; }
      try {
        if (!rule.pattern.test(text)) continue;
        if (rule.notPattern && rule.notPattern.test(text)) continue;
      } catch {
        continue;
      }
      if (rule.blockAware && blockIndex?.linesInsideTryCatch.has(lineNo)) continue;
      const b = bucket ?? { lines: [], evidence: [], rule };
      b.lines.push(lineNo);
      if (b.evidence.length < 3) b.evidence.push(text.trim().slice(0, 200));
      hits.set(rule.id, b);
    }
  };

  if (addedOnly) {
    for (const hunk of file.hunks) {
      for (const l of hunk.addedLines) scanLine(l.lineNo, l.text);
    }
  } else if (file.content) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i += 1) scanLine(i + 1, lines[i]!);
  }

  for (const { lines, evidence, rule, stopped } of hits.values()) {
    findings.push({
      file: file.path,
      category: rule.category,
      level: rule.level,
      title: rule.title,
      reason: rule.reason + (stopped ? ` (cap of ${cap} hits reached; more may exist)` : ''),
      affectedLines: lines,
      evidence,
      suggestedTests: rule.suggestedTests,
      suggestedFix: rule.suggestedFix,
      ruleId: rule.id,
    });
  }
  return findings;
}
