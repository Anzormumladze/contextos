import type { AnalysisContext, Finding } from '../types/index.js';
import { API_CONTRACT_RULES } from '../rules/patterns.js';
import { runPatternRules } from './pattern-runner.js';
import { matchAny } from '../utils/glob.js';

export function analyzeApiContractRisk(ctx: AnalysisContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;
    findings.push(...runPatternRules({ file, rules: API_CONTRACT_RULES }));
  }
  return findings;
}
