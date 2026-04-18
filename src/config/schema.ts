import type { Category, RiskLevel } from '../types/index.js';

export interface CustomRule {
  id: string;
  description: string;
  pathGlob?: string;
  pattern: string;
  flags?: string;
  level: RiskLevel;
  category: Category;
  suggestedTests?: string[];
  suggestedFix?: string;
}

export interface RiskConfig {
  criticalPaths: string[];
  strictAreas: string[];
  ignoredPaths: string[];
  minimumCoverage: {
    lines: number;
    branches: number;
    functions: number;
    changedLines: number;
  };
  decisionThresholds: {
    warn: number;
    block: number;
  };
  weights: {
    levels: Record<RiskLevel, number>;
    categories: Record<Category, number>;
    criticalPathMultiplier: number;
    strictAreaMultiplier: number;
    changeSizeFactor: number;
    coverageGapWeight: number;
  };
  blockedCategories: Category[];
  coverageReportPath?: string;
  projectRoot?: string;
  customRules: CustomRule[];
  diff: {
    base: string;
    includeUntracked: boolean;
    maxTotalBytes: number;
    maxLineBytes: number;
    maxFileBytes: number;
  };
  limits: {
    findingsPerRule: number;
    totalFindings: number;
    regexTimeoutMs: number;
    cacheSize: number;
  };
}

export type PartialRiskConfig = {
  [K in keyof RiskConfig]?: RiskConfig[K] extends object
    ? Partial<RiskConfig[K]>
    : RiskConfig[K];
};
