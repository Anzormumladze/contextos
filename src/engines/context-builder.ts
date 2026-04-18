import { loadConfig } from '../config/loader.js';
import type { PartialRiskConfig } from '../config/schema.js';
import { collectChangedFiles } from '../utils/git.js';
import { loadCoverage } from '../utils/coverage-parser.js';
import type { AnalysisContext } from '../types/index.js';
import { parseUnifiedDiff } from '../utils/git.js';

export interface BuildContextOptions {
  cwd?: string;
  base?: string;
  diff?: string;
  coverageReportPath?: string;
  includeUntracked?: boolean;
  configOverride?: PartialRiskConfig;
}

/**
 * Centralised context assembly: loads config, collects diff, loads coverage.
 * Callers may pass an explicit `diff` string (for IDE / hook use-cases) or
 * let the engine discover it via git.
 */
export function buildContext(opts: BuildContextOptions = {}): AnalysisContext {
  const { config, projectRoot } = loadConfig(opts.cwd ?? process.cwd(), opts.configOverride);
  const root = config.projectRoot ?? projectRoot;
  const base = opts.base ?? config.diff.base;
  const changedFiles = opts.diff
    ? parseUnifiedDiff(opts.diff)
    : collectChangedFiles({
        projectRoot: root, base,
        includeUntracked: opts.includeUntracked ?? config.diff.includeUntracked,
      });
  const coverage = loadCoverage(root, opts.coverageReportPath ?? config.coverageReportPath);
  return { projectRoot: root, changedFiles, coverage, config };
}
