import type { AnalysisContext, Decision, Finding, RiskLevel } from '../types/index.js';
import type { CoverageAnalysis } from './coverage.js';
import { matchAny } from '../utils/glob.js';

export interface ScoringInputs {
  ctx: AnalysisContext;
  findings: Finding[];
  coverage: CoverageAnalysis;
}

export interface ScoringResult {
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  decision: Decision;
  breakdown: {
    findingsSubtotal: number;
    coverageGapSubtotal: number;
    changeSizeSubtotal: number;
    blockedByCategory?: string;
    maxFindingLevel: RiskLevel;
  };
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 65) return 'CRITICAL';
  if (score >= 40) return 'HIGH';
  if (score >= 20) return 'MEDIUM';
  return 'LOW';
}

function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/**
 * Weighted, explainable risk score in [0, 100].
 *
 *   findingScore   = Σ levelWeight × categoryWeight × pathMultiplier
 *   coverageGap    = max(0, threshold − changedLineCov) × coverageGapWeight
 *   changeSize     = log₂(1 + LOC) × changeSizeFactor
 *   total          = clamp(findingScore + coverageGap + changeSize, 0, 100)
 *
 * A finding in `blockedCategories` forces BLOCK regardless of score.
 */
export function scoreAnalysis(inputs: ScoringInputs): ScoringResult {
  const { ctx, findings, coverage } = inputs;
  const w = ctx.config.weights;

  let findingsSubtotal = 0;
  let maxFindingLevel: RiskLevel = 'LOW';
  let blockedByCategory: string | undefined;

  for (const f of findings) {
    const levelW = w.levels[f.level];
    const catW = w.categories[f.category] ?? 1;
    let mult = 1;
    if (matchAny(f.file, ctx.config.criticalPaths)) mult = w.criticalPathMultiplier;
    else if (matchAny(f.file, ctx.config.strictAreas)) mult = w.strictAreaMultiplier;
    findingsSubtotal += levelW * catW * mult;
    maxFindingLevel = maxLevel(maxFindingLevel, f.level);
    if (ctx.config.blockedCategories.includes(f.category) && !blockedByCategory) {
      blockedByCategory = `${f.category} (${f.ruleId ?? f.title})`;
    }
  }

  const gap = Math.max(0, ctx.config.minimumCoverage.changedLines - coverage.changedLineCoverage.pct);
  const coverageGapSubtotal = gap * w.coverageGapWeight;

  const totalLoc = ctx.changedFiles.reduce((a, f) => a + f.totalAdded + f.totalRemoved, 0);
  const changeSizeSubtotal = Math.log2(1 + totalLoc) * w.changeSizeFactor;

  const total = Math.min(100, Math.max(0, findingsSubtotal + coverageGapSubtotal + changeSizeSubtotal));
  const overallRiskScore = Math.round(total * 10) / 10;
  const overallRiskLevel = levelFromScore(overallRiskScore);

  let decision: Decision;
  if (blockedByCategory) decision = 'BLOCK';
  else if (overallRiskScore >= ctx.config.decisionThresholds.block) decision = 'BLOCK';
  else if (overallRiskScore >= ctx.config.decisionThresholds.warn) decision = 'WARN';
  else decision = 'PASS';

  return {
    overallRiskScore,
    overallRiskLevel,
    decision,
    breakdown: {
      findingsSubtotal: Math.round(findingsSubtotal * 10) / 10,
      coverageGapSubtotal: Math.round(coverageGapSubtotal * 10) / 10,
      changeSizeSubtotal: Math.round(changeSizeSubtotal * 10) / 10,
      blockedByCategory,
      maxFindingLevel,
    },
  };
}
