import type { AnalysisContext, ChangedFile, Finding } from '../types/index.js';
import { EDGE_CASE_RULES } from '../rules/patterns.js';
import { PYTHON_RULES } from '../rules/patterns-python.js';
import { GO_RULES } from '../rules/patterns-go.js';
import { runPatternRules } from './pattern-runner.js';
import { matchAny } from '../utils/glob.js';

const RULES = [
  ...EDGE_CASE_RULES,
  ...PYTHON_RULES.filter((r) => r.category === 'edge-case'),
  ...GO_RULES.filter((r) => r.category === 'edge-case'),
];

const CRITICAL_PATH_EXTRA_TESTS: Array<{ match: RegExp; tests: string[] }> = [
  {
    match: /auth|login|session|token|refresh/i,
    tests: [
      'should handle expired access token refresh flow',
      'should handle refresh token failure → force logout',
      'should handle 401 on a request during refresh in-flight',
      'should handle forbidden (403) without logging user out',
    ],
  },
  {
    match: /payment|checkout|billing|invoice|charge/i,
    tests: [
      'should handle 3DS / SCA challenge',
      'should handle declined card',
      'should handle network failure after submit (idempotency)',
      'should handle duplicate submit (double-click)',
      'should handle partial capture / authorization hold',
    ],
  },
  {
    match: /upload|attachment|file|media|image/i,
    tests: [
      'should handle upload timeout / retry',
      'should handle oversized file',
      'should handle remove during in-flight upload',
      'should handle re-add of same file',
      'should handle unsupported mime type',
    ],
  },
  {
    match: /cart|order|basket/i,
    tests: [
      'should handle empty cart during optimistic sync rollback',
      'should handle stock depletion between view and checkout',
      'should handle stale price / currency change mid-flow',
    ],
  },
  {
    match: /navigation|router|deeplink|redirect/i,
    tests: [
      'should handle deeplink to protected route when logged out',
      'should handle back navigation after completed flow',
      'should handle navigation during in-flight request',
    ],
  },
];

function inferCriticalPathTests(file: ChangedFile): string[] {
  const tests: string[] = [];
  for (const { match, tests: t } of CRITICAL_PATH_EXTRA_TESTS) {
    if (match.test(file.path)) tests.push(...t);
  }
  return tests;
}

export interface EdgeCaseAnalysis {
  findings: Finding[];
  missingEdgeCases: string[];
}

export function analyzeEdgeCases(ctx: AnalysisContext): EdgeCaseAnalysis {
  const findings: Finding[] = [];
  const missingSet = new Set<string>();

  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;

    const patternFindings = runPatternRules({
      file, rules: RULES,
      findingsPerRule: ctx.config.limits.findingsPerRule,
      regexTimeoutMs: ctx.config.limits.regexTimeoutMs,
    });
    for (const f of patternFindings) {
      findings.push(f);
      for (const t of f.suggestedTests ?? []) missingSet.add(t);
    }

    const critTests = inferCriticalPathTests(file);
    if (critTests.length > 0 && matchAny(file.path, ctx.config.criticalPaths)) {
      findings.push({
        file: file.path,
        category: 'critical-path',
        level: 'HIGH',
        title: 'Critical-path file changed — domain-specific edge cases enforced',
        reason: 'This file lives in a critical path. Domain-aware scenarios are required before merge.',
        suggestedTests: critTests,
        ruleId: 'edge/critical-path-scenarios',
      });
      for (const t of critTests) missingSet.add(t);
    }
  }

  return { findings, missingEdgeCases: Array.from(missingSet) };
}
