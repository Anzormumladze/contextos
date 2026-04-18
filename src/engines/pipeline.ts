import type { AnalysisContext, AnalysisResult } from '../types/index.js';
import { analyzeCoverage } from './coverage.js';
import { analyzeEdgeCases } from './edge-case.js';
import { analyzeAsyncRisk } from './async-risk.js';
import { analyzeStateRisk } from './state-risk.js';
import { analyzeApiContractRisk } from './api-contract.js';
import { analyzeSecurityRisk } from './security.js';
import { analyzeRegressionRisk } from './regression.js';
import { analyzeCustomRules } from './custom-rules.js';
import { scoreAnalysis } from './scoring.js';
import { normalize } from './normalizer.js';

export function runFullPipeline(ctx: AnalysisContext): AnalysisResult {
  const start = Date.now();
  const coverage = analyzeCoverage(ctx);
  const edge = analyzeEdgeCases(ctx);
  const async_ = analyzeAsyncRisk(ctx);
  const state = analyzeStateRisk(ctx);
  const api = analyzeApiContractRisk(ctx);
  const security = analyzeSecurityRisk(ctx);
  const regression = analyzeRegressionRisk(ctx);
  const custom = analyzeCustomRules(ctx);

  const findings = [
    ...coverage.findings,
    ...edge.findings,
    ...async_,
    ...state,
    ...api,
    ...security,
    ...regression.findings,
    ...custom,
  ];

  const score = scoreAnalysis({ ctx, findings, coverage });
  return normalize({
    findings,
    coverage,
    missingEdgeCases: edge.missingEdgeCases,
    score,
    filesAnalyzed: ctx.changedFiles.length,
    durationMs: Date.now() - start,
  });
}
