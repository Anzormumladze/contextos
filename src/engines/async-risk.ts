import type { AnalysisContext, Finding } from '../types/index.js';
import { ASYNC_RULES } from '../rules/patterns.js';
import { runPatternRules } from './pattern-runner.js';
import { matchAny } from '../utils/glob.js';

export function analyzeAsyncRisk(ctx: AnalysisContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;
    findings.push(...runPatternRules({ file, rules: ASYNC_RULES }));
  }
  return findings;
}
