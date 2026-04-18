import type { AnalysisContext, Finding } from '../types/index.js';
import { SECURITY_RULES } from '../rules/patterns.js';
import { PYTHON_RULES } from '../rules/patterns-python.js';
import { GO_RULES } from '../rules/patterns-go.js';
import { runPatternRules } from './pattern-runner.js';
import { matchAny } from '../utils/glob.js';

const RULES = [
  ...SECURITY_RULES,
  ...PYTHON_RULES.filter((r) => r.category === 'security'),
  ...GO_RULES.filter((r) => r.category === 'security'),
];

export function analyzeSecurityRisk(ctx: AnalysisContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;
    findings.push(...runPatternRules({
      file, rules: RULES,
      findingsPerRule: ctx.config.limits.findingsPerRule,
      regexTimeoutMs: ctx.config.limits.regexTimeoutMs,
    }));
  }
  return findings;
}
