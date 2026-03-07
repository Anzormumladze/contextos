# ContextOS — Claude Code Setup Instructions
# Paste this into your terminal inside the project folder

---

## What to tell Claude Code (paste this as your first message):

---

You are working on **ContextOS**, a published npm CLI tool and MCP proxy server.

### What it does
ContextOS wraps all user-configured MCP servers behind 4 stub tools, so Claude Code only loads tool schemas on demand instead of upfront. This saves 60–94% of token overhead at session start.

### Project state
- All source files are already written and tested (38/38 tests passing)
- The code is ready to publish to npm
- Your job is to: install dependencies, build, run tests, then help me with any further work

### First steps — run these now:
```
npm install
npm test
```

Expected output: `✅ All 29 unit tests passed` and `✅ All 9 integration tests passed`

### Project structure
```
src/
  budget.ts       — token counting, TokenBudget class
  constants.ts    — 4 stub tool definitions, token cost
  registry.ts     — ToolRegistry, keyword search
  proxy.ts        — McpProxy (connection pool, timeouts, retry logic)
  compressor.ts   — local and AI-powered context compression
  server.ts       — MCP server, 4 tool handlers, init backoff
  cli.ts          — serve / scan / compress / search CLI commands
  mock-server.ts  — test fixture (mock MCP child server)
  test.ts         — 29 unit tests
  integration-test.ts — 9 integration tests
LICENSE
README.md
package.json     — includes "files", "prepack", "engines": node>=20
tsconfig.json
```

### Key design decisions (already implemented, don't change without asking):
- `withConnectionRetry` only retries on transport errors (ECONNRESET, broken pipe, timeout, etc.) — NOT on tool-level errors
- `isRetriableConnectionError()` is the classifier function in proxy.ts
- `ensureInit()` has a 15s backoff when ALL servers fail to index
- Timeouts are configurable via env vars: `CONTEXTOS_CONNECT_TIMEOUT`, `CONTEXTOS_LIST_TOOLS_TIMEOUT`, `CONTEXTOS_CALL_TIMEOUT`
- `resolveConfig()` throws immediately on missing/malformed/empty explicit `--config` path
- `ctx_exec` returns unwrapped MCP content, not a stringified envelope

### Known deferred items (post-publish, don't implement now unless asked):
- Retry classifier not validated against actual SDK error strings
- `toolCache` never invalidated (TTL, manual refresh)
- `ctx_status` shows error during init backoff instead of partial dashboard
- Concurrent `listServerTools` calls not deduplicated with in-flight promise

### To publish to npm when ready:
```
npm test
npm pack --dry-run   # verify dist/, README.md, LICENSE are included
npm login
npm publish
```

### Environment variables needed for AI compression (optional):
```
export ANTHROPIC_API_KEY=sk-ant-...
```

What would you like to work on?
