export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Decision = 'PASS' | 'WARN' | 'BLOCK';

export type Category =
  | 'coverage'
  | 'edge-case'
  | 'regression'
  | 'async'
  | 'state'
  | 'api-contract'
  | 'security'
  | 'critical-path'
  | 'custom';

export interface Finding {
  file: string;
  category: Category;
  level: RiskLevel;
  title: string;
  reason: string;
  affectedLines?: number[];
  evidence?: string[];
  suggestedTests?: string[];
  suggestedFix?: string;
  ruleId?: string;
}

export interface AnalysisResult {
  decision: Decision;
  overallRiskScore: number;
  overallRiskLevel: RiskLevel;
  summary: string;
  findings: Finding[];
  uncoveredScenarios: string[];
  missingEdgeCases: string[];
  recommendedNextSteps: string[];
  meta: {
    analyzedAt: string;
    filesAnalyzed: number;
    durationMs: number;
    engineVersions: Record<string, string>;
  };
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C';

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  addedLines: Array<{ lineNo: number; text: string }>;
  removedLines: Array<{ lineNo: number; text: string }>;
  contextText: string;
}

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  hunks: Hunk[];
  addedLineNumbers: number[];
  removedLineNumbers: number[];
  totalAdded: number;
  totalRemoved: number;
  content?: string;
  language?: string;
}

export interface CoverageFileSummary {
  path: string;
  lines: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  uncoveredLines: number[];
  partiallyCoveredBranches: number[];
}

export interface CoverageReport {
  source: 'lcov' | 'istanbul-json' | 'none';
  files: Record<string, CoverageFileSummary>;
  totals: {
    lines: { total: number; covered: number; pct: number };
    branches: { total: number; covered: number; pct: number };
    functions: { total: number; covered: number; pct: number };
  };
}

export interface AnalysisContext {
  projectRoot: string;
  changedFiles: ChangedFile[];
  coverage: CoverageReport;
  config: import('../config/schema.js').RiskConfig;
}
