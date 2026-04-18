import type { AnalysisContext, Finding, RiskLevel } from '../types/index.js';
import { matchAny } from '../utils/glob.js';

interface RemovalSignal {
  ruleId: string;
  title: string;
  reason: string;
  level: RiskLevel;
  test: RegExp;
  suggestedTests?: string[];
}

const SIGNALS: RemovalSignal[] = [
  {
    ruleId: 'removal/catch-clause',
    title: 'catch clause removed',
    reason: 'An error-handling branch was deleted — rejections will now bubble uncaught.',
    level: 'HIGH',
    test: /^\s*}\s*catch\s*\(|^\s*catch\s*\(/,
    suggestedTests: ['should surface (not swallow) the previously caught failure'],
  },
  {
    ruleId: 'removal/status-check',
    title: 'HTTP status check removed',
    reason: 'A `!res.ok` / `response.status` check was deleted — 4xx/5xx bodies will be parsed as success.',
    level: 'HIGH',
    test: /!\s*(?:res|response)\.ok|\b(?:res|response)\.status\b/,
    suggestedTests: ['should handle 4xx/5xx without treating the body as success'],
  },
  {
    ruleId: 'removal/input-validation',
    title: 'Input validation removed',
    reason: 'A validator / schema check was deleted — invalid payloads now reach the handler.',
    level: 'HIGH',
    test: /(?:zod|yup|joi|ajv|schema)\.(?:parse|validate|safeParse)\s*\(|assert\s*\(/,
    suggestedTests: ['should reject invalid input at the boundary'],
  },
  {
    ruleId: 'removal/auth-check',
    title: 'Authorisation check removed',
    reason: 'A `requireAuth` / permission gate was deleted — protected flow may be reachable unauthenticated.',
    level: 'CRITICAL',
    test: /require(?:Auth|Admin|Login|Permission)|isAuthenticated|isAllowed|hasPermission|can(?:Access|Edit|View)/,
    suggestedTests: ['should deny access when caller is unauthenticated / unauthorised'],
  },
  {
    ruleId: 'removal/rate-limit',
    title: 'Rate limit / throttling removed',
    reason: 'Rate-limit or throttle wrapper was deleted — abuse surface increases.',
    level: 'HIGH',
    test: /rateLimit|throttle|limiter|RateLimiter/,
    suggestedTests: ['should reject requests exceeding the configured rate'],
  },
  {
    ruleId: 'removal/retry-cleanup',
    title: 'Retry / cleanup / rollback removed',
    reason: 'A retry, rollback, or cleanup path was deleted — partial-failure recovery is weakened.',
    level: 'MEDIUM',
    test: /\bretry\b|\brollback\b|\bcleanup\b|\babort\b/i,
    suggestedTests: ['should recover / rollback cleanly after partial failure'],
  },
];

export function analyzeRemovalRisk(ctx: AnalysisContext): Finding[] {
  const findings: Finding[] = [];
  for (const file of ctx.changedFiles) {
    if (matchAny(file.path, ctx.config.ignoredPaths)) continue;
    if (file.totalRemoved === 0) continue;
    const removedTexts = file.hunks.flatMap((h) => h.removedLines.map((l) => l));
    if (removedTexts.length === 0) continue;

    // Heuristic: count *net* deletions of each signal — a line that reappears
    // on the added side (slight rewording) shouldn't trigger.
    const addedJoined = file.hunks
      .flatMap((h) => h.addedLines.map((l) => l.text))
      .join('\n');
    const addedLower = addedJoined.toLowerCase();

    for (const sig of SIGNALS) {
      const removedLines = removedTexts.filter((l) => sig.test.test(l.text));
      if (removedLines.length === 0) continue;
      // Rough re-added detection: if the same-length lowercased token exists
      // somewhere in the additions, consider it preserved. Conservative.
      const reintroduced = removedLines.every((l) => addedLower.includes(l.text.trim().toLowerCase().slice(0, 40)) && l.text.trim().length > 0);
      if (reintroduced) continue;
      findings.push({
        file: file.path,
        category: 'regression',
        level: sig.level,
        title: sig.title,
        reason: sig.reason,
        affectedLines: removedLines.map((l) => l.lineNo),
        evidence: removedLines.slice(0, 3).map((l) => `- ${l.text.trim().slice(0, 200)}`),
        suggestedTests: sig.suggestedTests,
        ruleId: sig.ruleId,
      });
    }
  }
  return findings;
}
