import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './registry.js';
import { McpProxy, resolveConfig } from './proxy.js';
import { TokenBudget, countTokens } from './budget.js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { CONTEXTOS_TOOL_DEFS, CONTEXTOS_SCHEMA_TOKENS } from './constants.js';

export { CONTEXTOS_SCHEMA_TOKENS };

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }

const DESCRIBE_DESC_MAX = 400;

// Fix #3: backoff duration when all servers failed to index
const INIT_FAILURE_BACKOFF_MS = 15_000;

function buildServer(configPath?: string) {
  const found = resolveConfig(configPath);
  const registry = new ToolRegistry();
  const budget = new TokenBudget();
  let proxy: McpProxy | null = null;
  let configSource = 'none';
  const configWarnings: string[] = [];

  if (found) {
    proxy = new McpProxy(found.config);
    configSource = found.path;
    configWarnings.push(...found.warnings);
  }

  let initPromise: Promise<void> | null = null;
  // Fix #3: track last total-failure time for backoff
  let lastTotalFailureAt = 0;
  let lastTotalFailureMsg = '';

  function ensureInit(): Promise<void> {
    if (!proxy) return Promise.resolve();

    // Fix #3: if all servers failed last time, honour a backoff window
    if (initPromise === null && lastTotalFailureAt > 0) {
      const elapsed = Date.now() - lastTotalFailureAt;
      if (elapsed < INIT_FAILURE_BACKOFF_MS) {
        const remaining = Math.ceil((INIT_FAILURE_BACKOFF_MS - elapsed) / 1000);
        return Promise.reject(new Error(
          `All servers failed to index. Retrying in ${remaining}s. Last error: ${lastTotalFailureMsg}`
        ));
      }
      // Backoff expired — allow retry
      lastTotalFailureAt = 0;
    }

    if (initPromise) return initPromise;

    initPromise = (async () => {
      const servers = proxy!.getServerNames();
      const allTools: { name: string; description: string; inputSchema: unknown }[] = [];
      const failures: string[] = [];

      for (const serverName of servers) {
        try {
          const tools = await proxy!.listServerTools(serverName);
          registry.register(serverName, tools);
          allTools.push(...tools);
        } catch (e: any) {
          failures.push(`${serverName}: ${e.message}`);
          console.error(`[contextos] Warning: failed to index "${serverName}": ${e.message}`);
        }
      }

      budget.registerFullLibrary(allTools);

      // Fix #3: if zero tools indexed and servers were configured, record failure state
      if (servers.length > 0 && allTools.length === 0) {
        lastTotalFailureAt = Date.now();
        lastTotalFailureMsg = failures.join('; ') || 'unknown error';
        // Reset so the next request after backoff will retry
        initPromise = null;
        throw new Error(`All ${servers.length} server(s) failed to index: ${lastTotalFailureMsg}`);
      }
    })();

    initPromise.catch(() => { initPromise = null; });
    return initPromise;
  }

  const server = new Server(
    { name: 'contextos', version: '0.4.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CONTEXTOS_TOOL_DEFS.map(t => ({ ...t })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const a = (args ?? {}) as Record<string, any>;

    try {
      // ── ctx_search ──────────────────────────────────────────────────────
      if (name === 'ctx_search') {
        await ensureInit();
        const query = String(a.query ?? '');
        const rawLimit = Number(a.limit ?? 5);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.round(rawLimit), 1), 20) : 5;

        if (registry.totalTools === 0) {
          const msg = proxy
            ? `No tools indexed. Servers: [${proxy.getServerNames().join(', ')}]. May be unavailable.${configWarnings.length ? '\n\nWarnings:\n' + configWarnings.join('\n') : ''}`
            : 'No MCP config found. Pass --config <path> to contextos serve.';
          return { content: [{ type: 'text', text: msg }] };
        }

        const results = registry.search(query, limit);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: `No tools found for: "${query}". Try broader terms.` }] };
        }

        const stats = budget.stats;
        const lines = [
          `Found ${results.length} tool(s) for: "${query}"`,
          `Library: ${registry.totalTools} tools across [${registry.servers.join(', ')}]`,
          `Schemas in context: ${stats.uniqueSchemasLoaded}/${registry.totalTools} (~${fmt(stats.loaded)} tokens, ${stats.reductionPct}% saved)`,
          '',
          ...results.map((r, i) =>
            `${i + 1}. **${r.entry.id}**\n   ${r.entry.description.slice(0, 120)}${r.entry.description.length > 120 ? '...' : ''}\n   ~${fmt(r.entry.tokens)} tokens | score: ${r.score.toFixed(1)}`
          ),
          '',
          'Next: ctx_describe("<tool_id>") → ctx_exec("<tool_id>", { ...args })',
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // ── ctx_describe ────────────────────────────────────────────────────
      if (name === 'ctx_describe') {
        await ensureInit();
        const toolId = String(a.tool_id ?? '');
        const entry = registry.get(toolId);
        if (!entry) return { content: [{ type: 'text', text: `Tool "${toolId}" not found. Use ctx_search to find tools.` }] };
        budget.trackSchemaDescribed(toolId, entry);
        const desc = entry.description.length > DESCRIBE_DESC_MAX
          ? entry.description.slice(0, DESCRIBE_DESC_MAX) + '...'
          : entry.description;
        const lines = [
          `**${entry.id}** (${entry.server})`,
          desc, '',
          '```json', JSON.stringify(entry.inputSchema, null, 2), '```', '',
          `~${fmt(entry.tokens)} tokens loaded | ctx_exec("${entry.id}", { ...args })`,
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // ── ctx_exec ────────────────────────────────────────────────────────
      if (name === 'ctx_exec') {
        await ensureInit();
        const toolId = String(a.tool_id ?? '');
        const toolArgs = (a.args ?? {}) as Record<string, unknown>;
        const entry = registry.get(toolId);
        if (!entry) return { content: [{ type: 'text', text: `Tool "${toolId}" not found. Use ctx_search first.` }], isError: true };
        if (!proxy) return { content: [{ type: 'text', text: 'No MCP proxy configured.' }], isError: true };
        budget.trackToolExec(toolId);
        const result = await proxy.executeTool(entry.server, entry.name, toolArgs) as any;
        if (result && typeof result === 'object' && Array.isArray(result.content)) {
          return { content: result.content, isError: result.isError ?? false };
        }
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
      }

      // ── ctx_status ──────────────────────────────────────────────────────
      if (name === 'ctx_status') {
        await ensureInit();

        if (a.compress_file) {
          const fp = resolve(String(a.compress_file));
          if (existsSync(fp)) {
            budget.setContextFileTokens(countTokens(readFileSync(fp, 'utf-8')));
          }
        }

        const snap = budget.snapshot();
        const stats = budget.stats;
        const saved = stats.fullLibrary - stats.loaded;

        let savingsMsg: string;
        if (registry.totalTools === 0) {
          savingsMsg = '📭 No MCP servers indexed yet.';
        } else if (stats.uniqueSchemasLoaded === 0) {
          savingsMsg = `📊 Library indexed (${registry.totalTools} tools). No schemas loaded yet — tokens spent on first ctx_describe.`;
        } else {
          savingsMsg = `✅ Saved ~${fmt(saved)} tokens (${stats.reductionPct}%) vs loading all ${registry.totalTools} schemas upfront.`;
        }

        // Fix #7: only include fileSection if non-empty (avoids blank line in output)
        const fileSection = (a.compress_file && snap.contextFileTokens > 0)
          ? `**Context File:** ${a.compress_file} — ${fmt(snap.contextFileTokens)} tokens\nTo compress: run \`contextos compress <file>\``
          : null;

        const lines = [
          '## ContextOS Token Budget',
          '',
          `**MCP Library:**        ${fmt(stats.fullLibrary)} tokens total (${registry.totalTools} tools, ${registry.servers.length} servers)`,
          `**ContextOS overhead:**  ${fmt(CONTEXTOS_SCHEMA_TOKENS)} tokens (4 stub schemas — all Claude sees upfront)`,
          `**Schemas loaded:**      ${fmt(stats.loaded)} tokens (${stats.uniqueSchemasLoaded} unique tools described)`,
          `**Saved by proxy:**      ${fmt(saved)} tokens (${stats.reductionPct}%)`,
          '',
          `**Describe calls:** ${stats.describeCount} | **Exec calls:** ${stats.execCount}`,
          '',
          '**Servers:**',
          ...(registry.servers.length > 0
            ? registry.servers.map(s => {
                const tools = registry.getByServer(s);
                const tok = tools.reduce((sum, t) => sum + t.tokens, 0);
                return `  ${s.padEnd(22)} ${String(tools.length).padStart(3)} tools  ~${fmt(tok)}`;
              })
            : ['  (none indexed)']),
          ...(fileSection ? ['', fileSection] : []),
          '',
          savingsMsg,
          `Config: ${configSource}`,
          ...(configWarnings.length ? ['', '⚠️ Config warnings:', ...configWarnings.map(w => `  ${w}`)] : []),
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    } catch (err: any) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  return { server, proxy };
}

export async function startMcpServer(configPath?: string) {
  const { server, proxy } = buildServer(configPath);
  const transport = new StdioServerTransport();
  const cleanup = async () => { if (proxy) await proxy.closeAll(); process.exit(0); };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  await server.connect(transport);
  console.error('[contextos] MCP server v0.4.0 running on stdio');
}
