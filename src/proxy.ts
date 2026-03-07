import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, existsSync } from 'fs';

export interface ServerConfig { command: string; args?: string[]; env?: Record<string, string>; }
export interface McpConfig { mcpServers: Record<string, ServerConfig>; }
export interface ToolDef { name: string; description: string; inputSchema: unknown; }

// Fix #12: timeout constants readable from env vars (with sane defaults + validation)
function readTimeoutEnv(key: string, defaultMs: number): number {
  const raw = process.env[key];
  if (!raw) return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 300_000) {
    console.error(`[contextos] Warning: invalid ${key}="${raw}", using default ${defaultMs}ms`);
    return defaultMs;
  }
  return n;
}

export const CONNECT_TIMEOUT_MS    = readTimeoutEnv('CONTEXTOS_CONNECT_TIMEOUT',    10_000);
export const LIST_TOOLS_TIMEOUT_MS = readTimeoutEnv('CONTEXTOS_LIST_TOOLS_TIMEOUT', 20_000);
export const CALL_TIMEOUT_MS       = readTimeoutEnv('CONTEXTOS_CALL_TIMEOUT',       30_000);

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    const result = await Promise.race([p, timeout]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// Fix #1: only retry on likely transport/session failures — not tool-level errors
function isRetriableConnectionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('broken pipe') ||
    msg.includes('transport closed') ||
    msg.includes('connection closed') ||
    msg.includes('socket hang up') ||
    msg.includes('disconnected') ||
    msg.includes('epipe')
  );
}

interface ServerConnection { client: Client; transport: StdioClientTransport; }

export class McpProxy {
  private toolCache = new Map<string, ToolDef[]>();
  private connections = new Map<string, Promise<ServerConnection>>();
  private config: McpConfig;

  constructor(config: McpConfig) { this.config = config; }

  private makeTransport(serverName: string): StdioClientTransport {
    const sc = this.config.mcpServers[serverName];
    if (!sc) throw new Error(`Server "${serverName}" not in config`);
    const env = sc.env ? { ...process.env, ...sc.env } as Record<string, string> : undefined;
    return new StdioClientTransport({ command: sc.command, args: sc.args ?? [], env });
  }

  private getConnection(serverName: string): Promise<ServerConnection> {
    if (!this.connections.has(serverName)) {
      this.connections.set(serverName, this.createConnection(serverName));
    }
    return this.connections.get(serverName)!;
  }

  private async createConnection(serverName: string): Promise<ServerConnection> {
    const transport = this.makeTransport(serverName);
    const client = new Client({ name: 'contextos', version: '0.4.0' }, { capabilities: {} });
    try {
      await withTimeout(
        client.connect(transport),
        CONNECT_TIMEOUT_MS,
        `connect(${serverName})`,
        () => { transport.close().catch(() => {}); }
      );
      return { client, transport };
    } catch (err) {
      try { await transport.close(); } catch {}
      throw err;
    }
  }

  private async getHealthyConnection(serverName: string): Promise<ServerConnection> {
    try {
      return await this.getConnection(serverName);
    } catch {
      this.connections.delete(serverName);
      return this.getConnection(serverName);
    }
  }

  // Fix #1: withConnectionRetry only retries on transport/session errors, not tool errors
  private async withConnectionRetry<T>(
    serverName: string,
    op: (conn: ServerConnection) => Promise<T>
  ): Promise<T> {
    const conn = await this.getHealthyConnection(serverName);
    try {
      return await op(conn);
    } catch (err) {
      // Fix #1: don't retry on tool-level errors (bad args, permission denied, etc.)
      if (!isRetriableConnectionError(err)) throw err;

      // Transport/session failure — evict, close, reconnect once
      this.connections.delete(serverName);
      try { await conn.transport.close(); } catch {}
      const fresh = await this.getHealthyConnection(serverName);
      return op(fresh);
    }
  }

  async listServerTools(serverName: string): Promise<ToolDef[]> {
    if (this.toolCache.has(serverName)) return this.toolCache.get(serverName)!;

    const tools = await this.withConnectionRetry(serverName, async ({ client, transport }) => {
      const result = await withTimeout(
        client.listTools(),
        LIST_TOOLS_TIMEOUT_MS,
        `listTools(${serverName})`,
        // Fix #A: close transport on listTools timeout too
        () => { transport.close().catch(() => {}); }
      );
      return (result.tools ?? []).map((t: any) => ({
        name: t.name,
        description: typeof t.description === 'string' ? t.description : '',
        inputSchema: t.inputSchema ?? {},
      })) as ToolDef[];
    });

    this.toolCache.set(serverName, tools);
    return tools;
  }

  async executeTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.config.mcpServers[serverName]) throw new Error(`Server "${serverName}" not found`);

    return this.withConnectionRetry(serverName, ({ client, transport }) =>
      withTimeout(
        client.callTool({ name: toolName, arguments: args }),
        CALL_TIMEOUT_MS,
        `callTool(${serverName}::${toolName})`,
        // Fix #A: close transport on callTool timeout too
        () => { transport.close().catch(() => {}); }
      )
    );
  }

  async closeAll(): Promise<void> {
    for (const [, connPromise] of this.connections) {
      try { const conn = await connPromise; await conn.transport.close(); } catch {}
    }
    this.connections.clear();
  }

  getServerNames(): string[] { return Object.keys(this.config.mcpServers); }
  hasServer(name: string): boolean { return name in this.config.mcpServers; }
}

// Shape-only validation (no semantic checks here)
function validateMcpConfig(cfg: unknown, source: string): McpConfig {
  if (!cfg || typeof cfg !== 'object') throw new Error(`Config at "${source}" is not a JSON object`);
  const obj = cfg as Record<string, unknown>;
  if (!obj.mcpServers || typeof obj.mcpServers !== 'object' || Array.isArray(obj.mcpServers)) {
    throw new Error(`Config at "${source}" is missing "mcpServers" object`);
  }
  const servers = obj.mcpServers as Record<string, unknown>;
  for (const [name, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== 'object') throw new Error(`Server "${name}" entry must be an object`);
    const e = entry as Record<string, unknown>;
    if (typeof e.command !== 'string' || !e.command) throw new Error(`Server "${name}" is missing required "command" string`);
    if (e.args !== undefined && !Array.isArray(e.args)) throw new Error(`Server "${name}" has invalid "args": must be an array`);
    if (e.env !== undefined && (typeof e.env !== 'object' || Array.isArray(e.env))) throw new Error(`Server "${name}" has invalid "env": must be a plain object`);
  }
  return cfg as McpConfig;
}

export function loadMcpConfig(p: string): McpConfig | null {
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateMcpConfig(parsed, p);
}

export function findMcpConfig(): { path: string; config: McpConfig; warnings: string[] } | null {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const candidates = [
    '.mcp.json', 'mcp.json',
    `${home}/.claude.json`,
    `${home}/.config/claude/claude_desktop_config.json`,
    `${home}/Library/Application Support/Claude/claude_desktop_config.json`,
  ];
  const warnings: string[] = [];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const cfg = loadMcpConfig(p);
      if (cfg && Object.keys(cfg.mcpServers).length > 0) return { path: p, config: cfg, warnings };
    } catch (e: any) {
      warnings.push(`Ignored invalid candidate config at "${p}": ${e.message}`);
    }
  }
  return null;
}

export function resolveConfig(configPath?: string): { path: string; config: McpConfig; warnings: string[] } | null {
  if (configPath) {
    if (!existsSync(configPath)) throw new Error(`Config file not found: "${configPath}"`);
    let config: McpConfig | null;
    try {
      config = loadMcpConfig(configPath);
    } catch (e: any) {
      const msg = e.message.includes(configPath) ? e.message : `Invalid MCP config at "${configPath}": ${e.message}`;
      // Fix #5: preserve original stack via cause
      throw new Error(msg, { cause: e });
    }
    if (!config) throw new Error(`Config file is empty or has no mcpServers: "${configPath}"`);
    // Fix #8: reject explicitly-specified config with zero servers
    if (Object.keys(config.mcpServers).length === 0) {
      throw new Error(`Config at "${configPath}" defines no MCP servers (mcpServers is empty)`);
    }
    return { path: configPath, config, warnings: [] };
  }
  return findMcpConfig();
}
