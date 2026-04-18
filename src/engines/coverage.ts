import type { AnalysisContext, Finding } from '../types/index.js';
import { matchAny } from '../utils/glob.js';

export interface CoverageAnalysis {
  findings: Finding[];
  uncoveredScenarios: string[];
  changedLineCoverage: {
    total: number;
    covered: number;
    pct: number;
  };
  perFile: Array<{
    path: string;
    changedLines: number;
    uncoveredChangedLines: number[];
    linePct: number;
    branchPct: number;
    functionPct: number;
  }>;
}

/**
 * Coverage engine — focuses on *changed-line* coverage, which is the signal
 * that matters for release safety. Also flags files below global thresholds.
 */
export function analyzeCoverage(ctx: AnalysisContext): CoverageAnalysis {
  const { coverage, changedFiles, config } = ctx;
  const findings: Finding[] = [];
  const uncoveredScenarios: string[] = [];
  const perFile: CoverageAnalysis['perFile'] = [];
  let totalChanged = 0;
  let totalCovered = 0;

  const noCoverage = coverage.source === 'none';

  for (const file of changedFiles) {
    if (matchAny(file.path, config.ignoredPaths)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file.path)) continue;

    const cov = coverage.files[file.path];
    const changedSet = new Set(file.addedLineNumbers);
    const changedCount = changedSet.size;

    if (!cov) {
      if (!noCoverage && changedCount > 0) {
        findings.push({
          file: file.path,
          category: 'coverage',
          level: matchAny(file.path, config.criticalPaths) ? 'HIGH' : 'MEDIUM',
          title: 'Changed file has no coverage record',
          reason: 'This file was changed but does not appear in the coverage report. Either it is not reached by any test, or it is not instrumented.',
          affectedLines: file.addedLineNumbers.slice(0, 25),
          suggestedTests: [`Add at least one test that imports and exercises ${file.path}`],
          ruleId: 'coverage/file-missing',
        });
        uncoveredScenarios.push(`${file.path}: no tests reach this file`);
      }
      perFile.push({
        path: file.path, changedLines: changedCount, uncoveredChangedLines: file.addedLineNumbers,
        linePct: 0, branchPct: 0, functionPct: 0,
      });
      totalChanged += changedCount;
      continue;
    }

    const uncoveredOnChanges = cov.uncoveredLines.filter((l) => changedSet.has(l));
    const coveredOnChanges = changedCount - uncoveredOnChanges.length;
    totalChanged += changedCount;
    totalCovered += coveredOnChanges;

    perFile.push({
      path: file.path,
      changedLines: changedCount,
      uncoveredChangedLines: uncoveredOnChanges,
      linePct: cov.lines.pct,
      branchPct: cov.branches.pct,
      functionPct: cov.functions.pct,
    });

    const isCritical = matchAny(file.path, config.criticalPaths);
    const isStrict = matchAny(file.path, config.strictAreas);
    const changedThreshold = config.minimumCoverage.changedLines;
    const changedPct = changedCount === 0 ? 100 : Math.round((coveredOnChanges / changedCount) * 1000) / 10;

    if (changedCount > 0 && changedPct < changedThreshold) {
      findings.push({
        file: file.path,
        category: 'coverage',
        level: isCritical ? 'CRITICAL' : isStrict ? 'HIGH' : 'MEDIUM',
        title: `Changed-line coverage ${changedPct}% < threshold ${changedThreshold}%`,
        reason: `${uncoveredOnChanges.length} of ${changedCount} changed lines are not exercised by any test.`,
        affectedLines: uncoveredOnChanges,
        suggestedTests: [
          `Cover new/changed logic on lines ${uncoveredOnChanges.slice(0, 8).join(', ')}${uncoveredOnChanges.length > 8 ? '…' : ''}`,
        ],
        ruleId: 'coverage/changed-lines-low',
      });
    }

    if (cov.branches.total > 0 && cov.branches.pct < config.minimumCoverage.branches) {
      findings.push({
        file: file.path,
        category: 'coverage',
        level: isCritical ? 'HIGH' : 'MEDIUM',
        title: `Branch coverage ${cov.branches.pct}% < ${config.minimumCoverage.branches}%`,
        reason: `${cov.branches.total - cov.branches.covered} uncovered branches. Error and edge paths are likely unexercised.`,
        affectedLines: cov.partiallyCoveredBranches,
        suggestedTests: ['Exercise the else/failure branch of recently changed conditionals'],
        ruleId: 'coverage/branches-low',
      });
    }

    if (cov.functions.total > 0 && cov.functions.pct < config.minimumCoverage.functions) {
      findings.push({
        file: file.path,
        category: 'coverage',
        level: 'MEDIUM',
        title: `Function coverage ${cov.functions.pct}% < ${config.minimumCoverage.functions}%`,
        reason: `${cov.functions.total - cov.functions.covered} functions have never been called from a test.`,
        ruleId: 'coverage/functions-low',
      });
    }
  }

  const pct = totalChanged === 0 ? 100 : Math.round((totalCovered / totalChanged) * 1000) / 10;
  return {
    findings,
    uncoveredScenarios,
    changedLineCoverage: { total: totalChanged, covered: totalCovered, pct },
    perFile,
  };
}
