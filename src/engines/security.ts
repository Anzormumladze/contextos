import type { AnalysisContext, Finding } from '../types/index.js';
import { SECURITY_RULES } from '../rules/patterns.js';
import { runPatternRules } from './pattern-runner.js';
import { matchAny } from '../utils/glob.js';

export function analyzeSecurityRisk(ctx: AnalysisContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;
    findings.push(...runPatternRules({ file, rules: SECURITY_RULES }));
  }
  return findings;
}
