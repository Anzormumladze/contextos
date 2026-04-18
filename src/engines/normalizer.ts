import type { AnalysisResult, Finding, RiskLevel } from '../types/index.js';
import type { ScoringResult } from './scoring.js';
import type { CoverageAnalysis } from './coverage.js';

const LEVEL_ORDER: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

function sortFindings(a: Finding, b: Finding): number {
  const la = LEVEL_ORDER.indexOf(a.level);
  const lb = LEVEL_ORDER.indexOf(b.level);
  if (la !== lb) return la - lb;
  return a.file.localeCompare(b.file);
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.file}::${f.ruleId ?? f.title}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, f);
      continue;
    }
    existing.affectedLines = Array.from(new Set([...(existing.affectedLines ?? []), ...(f.affectedLines ?? [])])).sort((a, b) => a - b);
    existing.evidence = Array.from(new Set([...(existing.evidence ?? []), ...(f.evidence ?? [])]));
    existing.suggestedTests = Array.from(new Set([...(existing.suggestedTests ?? []), ...(f.suggestedTests ?? [])]));
  }
  return Array.from(seen.values());
}

export interface NormalizeInputs {
  findings: Finding[];
  coverage: CoverageAnalysis;
  missingEdgeCases: string[];
  score: ScoringResult;
  filesAnalyzed: number;
  durationMs: number;
}

export function normalize(inputs: NormalizeInputs): AnalysisResult {
  const findings = dedupe(inputs.findings).sort(sortFindings);

  const uncoveredScenarios = Array.from(new Set([
    ...inputs.coverage.uncoveredScenarios,
    ...findings.flatMap((f) => f.suggestedTests ?? []),
  ])).slice(0, 50);

  const missingEdgeCases = Array.from(new Set(inputs.missingEdgeCases)).slice(0, 50);

  const recommendedNextSteps = buildRecommendations(findings, inputs);

  const summary = buildSummary(findings, inputs);

  return {
    decision: inputs.score.decision,
    overallRiskScore: inputs.score.overallRiskScore,
    overallRiskLevel: inputs.score.overallRiskLevel,
    summary,
    findings,
    uncoveredScenarios,
    missingEdgeCases,
    recommendedNextSteps,
    meta: {
      analyzedAt: new Date().toISOString(),
      filesAnalyzed: inputs.filesAnalyzed,
      durationMs: inputs.durationMs,
      engineVersions: {
        coverage: '1', 'edge-case': '1', regression: '1',
        async: '1', state: '1', 'api-contract': '1', security: '1',
        scoring: '1',
      },
    },
  };
}

function buildSummary(findings: Finding[], inputs: NormalizeInputs): string {
  const counts: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const f of findings) counts[f.level] += 1;
  const cov = inputs.coverage.changedLineCoverage;
  const parts = [
    `${inputs.score.decision} (score ${inputs.score.overallRiskScore}/100, ${inputs.score.overallRiskLevel}).`,
    `${findings.length} findings — CRITICAL:${counts.CRITICAL}, HIGH:${counts.HIGH}, MEDIUM:${counts.MEDIUM}, LOW:${counts.LOW}.`,
    `Changed-line coverage: ${cov.pct}% (${cov.covered}/${cov.total}).`,
  ];
  if (inputs.score.breakdown.blockedByCategory) {
    parts.push(`Hard-blocked by category: ${inputs.score.breakdown.blockedByCategory}.`);
  }
  return parts.join(' ');
}

function buildRecommendations(findings: Finding[], inputs: NormalizeInputs): string[] {
  const rec: string[] = [];
  if (inputs.score.decision === 'BLOCK') {
    rec.push('Do not ship. Resolve CRITICAL/HIGH findings or hard-blocked category before retrying.');
  } else if (inputs.score.decision === 'WARN') {
    rec.push('Proceed only after adding the missing tests listed below.');
  } else {
    rec.push('Low risk — safe to proceed. Consider the LOW-level suggestions for hygiene.');
  }
  if (inputs.coverage.changedLineCoverage.pct < 85 && inputs.coverage.changedLineCoverage.total > 0) {
    rec.push(`Raise changed-line coverage (currently ${inputs.coverage.changedLineCoverage.pct}%).`);
  }
  const critical = findings.filter((f) => f.level === 'CRITICAL').slice(0, 5);
  for (const f of critical) {
    rec.push(`Fix: ${f.title} in ${f.file}${f.suggestedFix ? ` — ${f.suggestedFix}` : ''}`);
  }
  return rec;
}
