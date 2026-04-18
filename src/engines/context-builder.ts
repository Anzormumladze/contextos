import { loadConfig } from '../config/loader.js';
import type { PartialRiskConfig } from '../config/schema.js';
import { collectChangedFiles } from '../utils/git.js';
import { loadCoverage } from '../utils/coverage-parser.js';
import type { AnalysisContext, SkippedFile } from '../types/index.js';
import { parseUnifiedDiffWithSkips } from '../utils/git.js';

export interface BuildContextOptions {
  cwd?: string;
  base?: string;
  diff?: string;
  coverageReportPath?: string;
  includeUntracked?: boolean;
  configOverride?: PartialRiskConfig;
}

export interface BuildContextResult {
  context: AnalysisContext;
  skippedFiles: SkippedFile[];
  configWarnings: string[];
}

export function buildContextDetailed(opts: BuildContextOptions = {}): BuildContextResult {
  const loaded = loadConfig(opts.cwd ?? process.cwd(), opts.configOverride);
  const { config, projectRoot, warnings } = loaded;
  const root = config.projectRoot ?? projectRoot;
  const base = opts.base ?? config.diff.base;
  let skippedFiles: SkippedFile[] = [];
  let changedFiles;
  if (opts.diff) {
    const parsed = parseUnifiedDiffWithSkips(opts.diff, {
      maxLineBytes: config.diff.maxLineBytes,
      maxTotalBytes: config.diff.maxTotalBytes,
    });
    changedFiles = parsed.files;
    skippedFiles = parsed.skipped;
  } else {
    const collected = collectChangedFiles({
      projectRoot: root, base,
      includeUntracked: opts.includeUntracked ?? config.diff.includeUntracked,
      maxFileBytes: config.diff.maxFileBytes,
      maxLineBytes: config.diff.maxLineBytes,
      maxTotalBytes: config.diff.maxTotalBytes,
    });
    changedFiles = collected.files;
    skippedFiles = collected.skipped;
  }
  const coverage = loadCoverage(root, opts.coverageReportPath ?? config.coverageReportPath);
  return {
    context: { projectRoot: root, changedFiles, coverage, config },
    skippedFiles,
    configWarnings: warnings,
  };
}

/** Back-compat wrapper used by direct callers that only need the context. */
export function buildContext(opts: BuildContextOptions = {}): AnalysisContext {
  return buildContextDetailed(opts).context;
}
