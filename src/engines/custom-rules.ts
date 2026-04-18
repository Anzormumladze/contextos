import type { AnalysisContext, Finding } from '../types/index.js';
import { matchAny } from '../utils/glob.js';
import { runPatternRules } from './pattern-runner.js';
import type { PatternRule } from '../rules/patterns.js';

export function analyzeCustomRules(ctx: AnalysisContext): Finding[] {
  const rules: PatternRule[] = ctx.config.customRules.map((r) => ({
    id: `custom/${r.id}`,
    category: r.category,
    level: r.level,
    pattern: new RegExp(r.pattern, r.flags ?? ''),
    title: r.description,
    reason: `Custom rule matched: ${r.description}`,
    suggestedTests: r.suggestedTests,
    suggestedFix: r.suggestedFix,
  }));
  if (rules.length === 0) return [];
  const findings: Finding[] = [];
  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;
    const scoped = rules.filter((_rule, idx) => {
      const glob = ctx.config.customRules[idx]!.pathGlob;
      return !glob || matchAny(file.path, [glob]);
    });
    if (scoped.length === 0) continue;
    findings.push(...runPatternRules({ file, rules: scoped }));
  }
  return findings;
}
