# contextos-risk

**Local MCP server — a release-safety engine for Claude Code.**

Before Claude edits a file, proposes a fix, or suggests a commit, it calls
this server and gets back a `PASS | WARN | BLOCK` decision, a risk score, and
a concrete list of missing tests. Pure-regex heuristics, zero network, <20 ms
on a 5000-line diff.

---

## Quickstart — one command

```bash
npx contextos-risk init
```

That's it. The `init` command will, in the current repo:

1. Create or update **`.mcp.json`** so Claude Code can find the server.
2. Drop a default **`risk.config.json`** (critical paths, thresholds, blocked
   categories) — only if one doesn't already exist.
3. Append a **CLAUDE.md** stanza telling the agent to call
   `evaluate_release_safety` before edits.

Then restart Claude Code. Done.

Prefer to preview first?

```bash
npx contextos-risk init --dry-run
```

Want to use the published package instead of the local install?

```bash
npx contextos-risk init --no-local     # writes `"command":"npx", "args":["-y","contextos-risk","serve"]`
```

To remove later:

```bash
npx contextos-risk uninstall
```

## Is it healthy?

```bash
npx contextos-risk doctor
```

Checks Node version, that `.mcp.json` has the right entry, that
`risk.config.json` parses with no warnings, that coverage is discoverable,
and **boots the MCP server and does a real stdio handshake**.

## Gate a commit locally

```bash
npx contextos-risk check             # human summary, exit 0/1/2
npx contextos-risk check --markdown  # same content as Markdown
npx contextos-risk check --json      # structured AnalysisResult
```

Wire it as a git pre-commit hook in one line:

```bash
echo 'npx contextos-risk check || exit $?' > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

Sample `check` output:

```
✗ BLOCK — risk 78/100
BLOCK (score 78/100, HIGH). 12 findings — CRITICAL:1, HIGH:4, MEDIUM:6, LOW:1. Changed-line coverage: 42% (13/31).
────────────────────────────────────────────────────────────
CRITICAL (1)
  ✗ src/payment/charge.ts:18 — SQL via string concatenation / Sprintf
     │  const q = `SELECT * FROM users WHERE id = ${id}`;
     └─ fix: Use db.Query("... WHERE id = $1", id) instead of Sprintf.

HIGH (4)
  ✗ src/auth/refresh.ts:42 — catch clause removed
  ✗ src/auth/refresh.ts:18 — Awaited network call without visible try/catch
  ✗ src/cart/sync.ts:91 — Optimistic update without visible rollback
  ✗ src/api/orders.ts:12 — fetch without status check

Missing tests (top 8)
  • should handle expired access token refresh flow
  • should roll back optimistic update on mutation error
  • should handle 401 / 403 / 429 / 500
  • should handle declined card

Next steps
  1. Do not ship. Resolve CRITICAL/HIGH findings before retrying.
  2. Raise changed-line coverage (currently 42%).
  3. Fix: SQL via string concatenation in src/payment/charge.ts — use bind parameters.
```

---

## What Claude Code actually calls

From a session:

> *"Before you propose that fix, call `evaluate_release_safety` and show me the decision."*

The tool response leads with a **Markdown summary** (so the agent and the user
both read the same thing) and follows with the full structured
`AnalysisResult` JSON for programmatic use.

### Tools exposed over MCP

| Tool | Purpose |
|---|---|
| `evaluate_release_safety` | The one you want most of the time. Runs the full pipeline, returns PASS/WARN/BLOCK with a normalized result. |
| `analyze_test_coverage` | Line / branch / function + **changed-line** coverage vs. thresholds. |
| `detect_edge_cases` | Null, empty, boundary, auth, upload, retry-exhaustion, race, rollback. |
| `predict_regression_risk` | Size × criticality × coupling × removed safeguards. |
| `analyze_async_risk` | Unawaited promises, missing catch/finally, uncapped retries, timer leaks. |
| `analyze_state_risk` | Stale state, missing deps, optimistic rollback, unsafe persistence. |
| `analyze_api_contract_risk` | Unsafe nesting, status checks, JSON.parse, pagination. |
| `analyze_security_risk` | eval, secret logging, plaintext tokens, shell/SQL injection, XSS. |
| `suggest_missing_tests` | Prioritized, deduped test scenarios across every engine. |
| `generate_test_matrix` | Scenario × input × expected table per changed file. |
| `explain_finding` | Drill-down: rule metadata + source excerpt for one finding. |

All tools accept `cwd`, `base`, `diff`, `coverageReportPath`, `includeUntracked`, and `useCache`.

---

## Scoring model (0 – 100)

```
findingScore   = Σ levelWeight × categoryWeight × pathMultiplier
coverageGap    = max(0, threshold − changedLineCov) × coverageGapWeight
changeSize     = log₂(1 + LOC_changed) × changeSizeFactor
total          = clamp(findingScore + coverageGap + changeSize, 0, 100)

PASS  < warnThreshold (default 30)
WARN  ≥ 30 and < blockThreshold (default 65)
BLOCK ≥ 65  OR  any finding in blockedCategories
```

Surfaced in `AnalysisResult.meta.scoringBreakdown` for auditability.

## Config

`risk.config.json` at the repo root. Every field optional; defaults are
opinionated. Full example: [`risk.config.example.json`](./risk.config.example.json).

Validator flags unknown keys, wrong types, invalid regex, and catastrophic
backtracking shapes in custom rules — surfaced in
`AnalysisResult.meta.configWarnings` (never throws).

## Reliability defaults

- Hostile-diff hardening: per-line + total byte caps in the parser.
- Custom-regex execution is try/catch-guarded and bounded by a per-line
  timeout (`limits.regexTimeoutMs`).
- Windows-path safe via full `toPosix()` normalisation.
- Coverage path suffix-match handles monorepo absolute paths.
- In-memory LRU cache; repeated `evaluate_release_safety` for the same diff
  + config returns from cache in µs (`meta.cacheHit = true`).

## Install without `init`

Add manually to `~/.claude.json` or `./.mcp.json`:

```json
{
  "mcpServers": {
    "risk": {
      "command": "npx",
      "args": ["-y", "contextos-risk", "serve"]
    }
  }
}
```

## License

MIT.
