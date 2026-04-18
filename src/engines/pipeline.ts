import type { AnalysisContext, AnalysisResult, SkippedFile } from '../types/index.js';
import { analyzeCoverage } from './coverage.js';
import { analyzeEdgeCases } from './edge-case.js';
import { analyzeAsyncRisk } from './async-risk.js';
import { analyzeStateRisk } from './state-risk.js';
import { analyzeApiContractRisk } from './api-contract.js';
import { analyzeSecurityRisk } from './security.js';
import { analyzeRegressionRisk } from './regression.js';
import { analyzeRemovalRisk } from './removal-risk.js';
import { analyzeCustomRules } from './custom-rules.js';
import { scoreAnalysis } from './scoring.js';
import { normalize } from './normalizer.js';
import { getCache } from './cache.js';

export interface PipelineOptions {
  skippedFiles?: SkippedFile[];
  configWarnings?: string[];
  useCache?: boolean;
}

export function runFullPipeline(ctx: AnalysisContext, opts: PipelineOptions = {}): AnalysisResult {
  const cache = getCache(ctx.config.limits.cacheSize);
  const cacheKey = cache.key(ctx);
  if (opts.useCache !== false) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { ...cached, meta: { ...cached.meta, cacheHit: true } };
    }
  }

  const start = Date.now();
  const coverage = analyzeCoverage(ctx);
  const edge = analyzeEdgeCases(ctx);
  const async_ = analyzeAsyncRisk(ctx);
  const state = analyzeStateRisk(ctx);
  const api = analyzeApiContractRisk(ctx);
  const security = analyzeSecurityRisk(ctx);
  const regression = analyzeRegressionRisk(ctx);
  const removal = analyzeRemovalRisk(ctx);
  const custom = analyzeCustomRules(ctx);

  const findings = [
    ...coverage.findings,
    ...edge.findings,
    ...async_,
    ...state,
    ...api,
    ...security,
    ...regression.findings,
    ...removal,
    ...custom,
  ];

  const score = scoreAnalysis({ ctx, findings, coverage });
  const result = normalize({
    findings,
    coverage,
    missingEdgeCases: edge.missingEdgeCases,
    score,
    filesAnalyzed: ctx.changedFiles.length,
    durationMs: Date.now() - start,
    totalFindingCap: ctx.config.limits.totalFindings,
    perRuleCap: ctx.config.limits.findingsPerRule,
    skippedFiles: opts.skippedFiles ?? [],
    configWarnings: opts.configWarnings ?? [],
  });

  if (opts.useCache !== false) cache.set(cacheKey, result);
  return result;
}
