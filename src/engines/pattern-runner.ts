import type { ChangedFile, Finding } from '../types/index.js';
import type { PatternRule } from '../rules/patterns.js';

export interface PatternRunOptions {
  file: ChangedFile;
  rules: PatternRule[];
  /** Only scan added lines (default). If false, also scans full file content. */
  addedOnly?: boolean;
}

/**
 * Run a set of per-line regex rules against a changed file and produce Findings.
 * The runner groups hits by rule so a single rule firing 5 times yields one
 * finding with 5 affected lines — better signal-to-noise.
 */
export function runPatternRules(opts: PatternRunOptions): Finding[] {
  const { file, rules, addedOnly = true } = opts;
  if (!file.language) return [];
  const findings: Finding[] = [];
  const hits = new Map<string, { lines: number[]; evidence: string[]; rule: PatternRule }>();

  const scanLine = (lineNo: number, text: string) => {
    for (const rule of rules) {
      if (rule.languages && !rule.languages.includes(file.language!)) continue;
      if (!rule.pattern.test(text)) continue;
      if (rule.notPattern && rule.notPattern.test(text)) continue;
      const bucket = hits.get(rule.id) ?? { lines: [], evidence: [], rule };
      bucket.lines.push(lineNo);
      if (bucket.evidence.length < 3) bucket.evidence.push(text.trim().slice(0, 200));
      hits.set(rule.id, bucket);
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

  for (const { lines, evidence, rule } of hits.values()) {
    findings.push({
      file: file.path,
      category: rule.category,
      level: rule.level,
      title: rule.title,
      reason: rule.reason,
      affectedLines: lines,
      evidence,
      suggestedTests: rule.suggestedTests,
      suggestedFix: rule.suggestedFix,
      ruleId: rule.id,
    });
  }
  return findings;
}
