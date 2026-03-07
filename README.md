# ContextOS

**Meta-MCP proxy — one server, zero schema bloat, full tool access.**

Instead of loading every tool schema upfront (often 50k–130k tokens), ContextOS exposes just 4 tools to Claude. Schemas load on demand, only when needed.

```
Typical savings: 60–94% token reduction at session start
```

## How it works

Claude sees only 4 tools:

| Tool | What it does |
|------|-------------|
| `ctx_search(query)` | Find tools by natural language — returns IDs + short descriptions, no schemas |
| `ctx_describe(tool_id)` | Load one tool's full schema on demand |
| `ctx_exec(tool_id, args)` | Execute a tool via the proxy |
| `ctx_status()` | Token budget dashboard |

**Workflow:** `ctx_search` → `ctx_describe` → `ctx_exec`

## Requirements

- Node.js >= 20
- An existing MCP config (`.mcp.json` or Claude Desktop config)

## Install

```bash
npm install -g contextos
# or without install:
npx contextos serve --config /path/to/mcp.json
```

## Setup

1. Scan your existing MCP servers:
```bash
contextos scan --config ~/.claude.json
```

2. Add ContextOS to your MCP config (replacing direct server entries):
```json
{
  "mcpServers": {
    "contextos": {
      "command": "npx",
      "args": ["contextos", "serve", "--config", "/path/to/original-mcp.json"]
    }
  }
}
```

3. Restart Claude Code — it now sees 4 tools instead of all schemas upfront.

## CLI Commands

**`serve`** — Start the MCP server (stdio):
```bash
contextos serve --config /path/to/mcp.json
```

**`scan`** — Index servers and show token breakdown:
```bash
contextos scan --config /path/to/mcp.json
```

**`search`** — Search tools from CLI:
```bash
contextos search "create github issue"
```

**`compress`** — Compress a CLAUDE.md or context file:
```bash
contextos compress CLAUDE.md                    # preview, local mode
contextos compress CLAUDE.md --mode ai          # Claude-powered (needs ANTHROPIC_API_KEY, incurs API cost)
contextos compress CLAUDE.md --write            # apply + create .bak backup
```

> **Note:** `--mode ai` makes a paid Anthropic API call. Cost depends on file size. A typical 5k-token CLAUDE.md costs roughly $0.01–0.02.

## Config Discovery

When `--config` is omitted, ContextOS checks in order:
1. `.mcp.json` (cwd)
2. `mcp.json` (cwd)
3. `~/.claude.json`
4. `~/.config/claude/claude_desktop_config.json`
5. `~/Library/Application Support/Claude/claude_desktop_config.json`

If you pass `--config <path>` and the file is missing, invalid JSON, or defines no servers, ContextOS throws immediately rather than silently falling back.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | — | Required for `compress --mode ai` |
| `CONTEXTOS_CONNECT_TIMEOUT` | `10000` | Child server connect timeout (ms) |
| `CONTEXTOS_LIST_TOOLS_TIMEOUT` | `20000` | listTools() timeout (ms) |
| `CONTEXTOS_CALL_TIMEOUT` | `30000` | callTool() timeout (ms) |

All timeout values must be positive integers between 1 and 300000.

## Limitations

- Search is keyword-based (no embeddings). Works well for most queries; may miss synonyms in very large catalogs.
- Token estimates use cl100k_base approximation (±10%).
- Args passed to `ctx_exec` are not validated against tool schemas before proxying.
- Retries only happen on transport/session failures (broken pipe, timeout, connection reset), not on tool-level errors.

## Troubleshooting

**"No tools indexed"** — Run `contextos scan` to see which servers failed. Check that child servers start correctly.

**"All servers failed to index"** — ContextOS will pause retries for 15s before trying again. Fix the underlying server issue.

**"Config file not found"** — Use an absolute path with `--config`.

**AI compression fails** — Set `ANTHROPIC_API_KEY` or use `--mode local`.

**Tool call timeout** — Increase `CONTEXTOS_CALL_TIMEOUT`, e.g. `CONTEXTOS_CALL_TIMEOUT=60000 contextos serve`.

## License

MIT
