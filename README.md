# contextos-risk

**Local MCP server — test coverage + edge case + risk intelligence engine for Claude Code.**

This is not a coverage reader. It is a local **release safety engine** that
Claude Code can call *before* proposing code edits, fixes, or commits.

It ingests the current git diff + (optional) coverage report, runs a pipeline
of rule-based engines (coverage, edge-case, regression, async, state, api
contract, security, regression, custom), scores the result, and returns a
normalized `PASS | WARN | BLOCK` decision with concrete missing-test
suggestions.

---

## Install

```bash
npm install
npm run build
```

Node ≥ 20.

## Run as an MCP server (stdio)

```bash
node dist/cli.js serve
# or
npx contextos-risk serve
```

### Wire it into Claude Code

Add to `~/.claude.json` (or your project `.mcp.json`):

```json
{
  "mcpServers": {
    "risk": {
      "command": "node",
      "args": ["/absolute/path/to/contextos-risk/dist/cli.js", "serve"]
    }
  }
}
```

Then from a Claude Code session:

> *"Before you propose that fix, call `evaluate_release_safety` and show me the decision."*

## Run standalone from the CLI

```bash
# Full analysis as JSON (non-zero exit = WARN or BLOCK)
node dist/cli.js analyze --pretty

# Short human summary
node dist/cli.js analyze --summary

# One specific tool
node dist/cli.js run detect_edge_cases
node dist/cli.js run analyze_security_risk

# List all tools
node dist/cli.js tools
```

Exit codes: `0` PASS, `1` WARN, `2` BLOCK. Usable as a local pre-push gate.

---

## Tools exposed over MCP

| Tool | Purpose |
|---|---|
| `evaluate_release_safety` | Meta-tool — runs the full pipeline and returns the final `AnalysisResult`. Call this first. |
| `analyze_test_coverage` | Line/branch/function and **changed-line** coverage vs thresholds. |
| `detect_edge_cases` | Rule-based detection of missing null/empty/boundary/auth/upload cases. |
| `predict_regression_risk` | Size × criticality × coupling × bug-prone markers. |
| `analyze_async_risk` | Unawaited promises, missing catch/finally, retries, timers, races. |
| `analyze_state_risk` | Stale state, missing deps, optimistic rollback, unsafe persistence. |
| `analyze_api_contract_risk` | Unsafe nesting, status checks, JSON.parse, pagination. |
| `analyze_security_risk` | eval, secrets-in-log, plaintext tokens, shell/SQL injection, XSS. |
| `suggest_missing_tests` | Prioritized, deduped missing-test scenarios across every engine. |
| `generate_test_matrix` | Scenario × input × expected table per changed file. |

All tools accept the same optional input: `cwd`, `base`, `diff`, `coverageReportPath`, `includeUntracked`.

---

## Output shape

```ts
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Decision  = 'PASS' | 'WARN' | 'BLOCK';

interface Finding {
  file: string;
  category: 'coverage' | 'edge-case' | 'regression' | 'async' | 'state'
          | 'api-contract' | 'security' | 'critical-path' | 'custom';
  level: RiskLevel;
  title: string;
  reason: string;
  affectedLines?: number[];
  evidence?: string[];
  suggestedTests?: string[];
  suggestedFix?: string;
  ruleId?: string;
}

interface AnalysisResult {
  decision: Decision;
  overallRiskScore: number;       // 0..100
  overallRiskLevel: RiskLevel;
  summary: string;
  findings: Finding[];
  uncoveredScenarios: string[];
  missingEdgeCases: string[];
  recommendedNextSteps: string[];
  meta: { analyzedAt: string; filesAnalyzed: number; durationMs: number; engineVersions: Record<string, string> };
}
```

Sample `analyze --summary` output:

```
[WARN] score=42.6 level=HIGH
WARN (score 42.6/100, HIGH). 7 findings — CRITICAL:0, HIGH:3, MEDIUM:3, LOW:1. Changed-line coverage: 63% (19/30).

Top findings:
  [HIGH] src/auth/refresh.ts: Awaited network call without visible try/catch
  [HIGH] src/checkout/cart.ts: Optimistic update without visible rollback
  [HIGH] src/auth/refresh.ts: Critical-path file modified
  [MEDIUM] src/api/orders.ts: fetch without status check
  ...

Missing edge cases:
  - should handle expired access token refresh flow
  - should handle 401 on a request during refresh in-flight
  - should roll back optimistic update on mutation error
```

---

## Scoring model

```
findingScore   = Σ levelWeight × categoryWeight × pathMultiplier
coverageGap    = max(0, minChangedLinesCov − actualChangedLinesCov) × coverageGapWeight
changeSize     = log₂(1 + LOC_changed) × changeSizeFactor
total          = clamp(findingScore + coverageGap + changeSize, 0, 100)

PASS  < warnThreshold (default 30)
WARN  ≥ 30 and < blockThreshold (default 65)
BLOCK ≥ 65  OR  any finding in blockedCategories
```

Defaults: `LOW=1, MEDIUM=4, HIGH=10, CRITICAL=25`. All weights, multipliers,
and thresholds are overridable in `risk.config.json`.

## Config

Drop a `risk.config.json` at the repo root (looked up via parent walk). See
[`risk.config.example.json`](./risk.config.example.json) for the full shape.
All fields are optional; defaults are sane and opinionated.

Supports:

- `criticalPaths` — globs that trigger the 2× risk multiplier
- `strictAreas` — globs that trigger the 1.5× multiplier
- `ignoredPaths` — globs the engines skip entirely
- `minimumCoverage.{lines,branches,functions,changedLines}` — thresholds
- `decisionThresholds.{warn,block}` — score → decision cutoffs
- `weights.*` — per-level, per-category, path multipliers, change-size factor
- `blockedCategories` — hard-block if any finding in these categories fires
- `customRules[]` — repo-specific regex rules with full finding metadata

---

## Suggested Claude Code workflow

1. User asks Claude to fix a bug or add a feature.
2. Before editing, Claude calls `evaluate_release_safety`.
3. If `BLOCK`, Claude refuses and shows the reason.
4. If `WARN`, Claude proceeds but lists the missing tests it will also add.
5. After editing, Claude re-runs `evaluate_release_safety` against the new diff.
6. Only when `PASS` (or `WARN` with mitigations listed) does Claude propose the commit.

A recommended subagent prompt lives in [`CLAUDE.md`](./CLAUDE.md).

---

## Extending

- **Custom regex rules** — add to `customRules[]` in config; no rebuild needed.
- **New engine** — drop a file in `src/engines/`, wire it into
  `src/engines/pipeline.ts`, register a tool in `src/tools/index.ts`.
- **Richer analysis (ts-morph / Babel AST)** — swap out the regex runner in
  `src/engines/pattern-runner.ts`; the engine-/tool-/scoring-layer is unchanged.

## Known limitations (by design)

- Regex heuristics, not full AST analysis. They trade precision for speed,
  zero-config, and zero network dependencies.
- Coverage parsing assumes Istanbul/LCOV output. Other formats need a parser
  addition in `src/utils/coverage-parser.ts`.
- Uses `git diff HEAD` (i.e. working-tree vs. index) by default. Pass `base`
  to diff against `origin/main` or any ref.

## License

MIT.
