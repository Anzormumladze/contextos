import type { AnalysisContext, Finding } from '../types/index.js';
import { API_CONTRACT_RULES } from '../rules/patterns.js';
import { PYTHON_RULES } from '../rules/patterns-python.js';
import { GO_RULES } from '../rules/patterns-go.js';
import { runPatternRules } from './pattern-runner.js';
import { matchAny } from '../utils/glob.js';

const RULES = [
  ...API_CONTRACT_RULES,
  ...PYTHON_RULES.filter((r) => r.category === 'api-contract'),
  ...GO_RULES.filter((r) => r.category === 'api-contract'),
];

export function analyzeApiContractRisk(ctx: AnalysisContext): Finding[] {
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
