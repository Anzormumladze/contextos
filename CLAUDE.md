# Guidance for Claude Code (and similar agents)

This project ships an MCP server — **`contextos-risk`** — that you (the agent)
should call **before** editing code, proposing fixes, or suggesting commits.

## When to call

1. Before an edit or refactor that touches >1 file or a critical path.
2. Before suggesting a bug fix — verify the risk surface is understood.
3. Before proposing a commit or a PR merge.
4. After making changes, to verify risk has not gone up.

## How to call

Prefer the meta-tool first:

```
evaluate_release_safety { }                  # full pipeline, final decision
```

Then, for deeper signal:

```
detect_edge_cases       { }
analyze_async_risk      { }
analyze_security_risk   { }
suggest_missing_tests   { }   # actionable test scenarios
generate_test_matrix    { }   # scaffolding help
```

All tools take optional `cwd`, `base` (git ref to diff against), `diff`
(explicit unified-diff text), and `coverageReportPath`.

## How to interpret the result

- `PASS`: proceed. Consider `LOW` hygiene findings only if cheap.
- `WARN`: proceed only after adding the missing tests listed in
  `recommendedNextSteps` + `missingEdgeCases`. State which you will add.
- `BLOCK`: **do not ship**. Explain the top `HIGH`/`CRITICAL` findings and
  the hard-blocked category (if any). Propose fixes — do not bypass.

## Do not

- Do not call this server to "get around" a failing check — fix the
  underlying risk or raise it with the user.
- Do not edit `risk.config.json` to silence a finding without asking the user.
- Do not assume `PASS` means "tests exist" — it means "risk is low given the
  current diff + coverage". Test gaps still require adding tests.

## Local usage

```
node dist/cli.js analyze --summary        # one-shot local gate (exit 0/1/2)
node dist/cli.js run detect_edge_cases    # single tool, JSON output
node dist/cli.js serve                    # MCP server over stdio
```
