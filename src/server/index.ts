import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, getTool } from '../tools/index.js';
import { renderMarkdown } from '../cli/render.js';
import type { AnalysisResult } from '../types/index.js';

const SERVER_INFO = {
  name: 'contextos-risk',
  version: '1.0.0',
};

export async function createRiskServer(): Promise<Server> {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: [
      'Test Coverage + Edge Case + Risk Intelligence MCP.',
      'Call `evaluate_release_safety` before proposing edits, fixes, or commits to get a PASS/WARN/BLOCK decision.',
      'Call individual analyzers (analyze_test_coverage, detect_edge_cases, analyze_async_risk, …) for targeted signals.',
      'All tools accept optional `cwd`, `base`, `diff`, and `coverageReportPath` — otherwise they operate on the current working tree.',
    ].join(' '),
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = getTool(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
    }
    try {
      const result = tool.handler((args ?? {}) as Parameters<typeof tool.handler>[0]);
      const content: Array<{ type: 'text'; text: string }> = [
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ];
      // For tools that return a full AnalysisResult, follow up with a readable
      // Markdown summary. Claude Code renders every content item, so the
      // agent gets both machine- and human-grade output.
      if (isAnalysisResult(result)) {
        content.push({ type: 'text', text: renderMarkdown(result) });
      }
      return { content };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error running ${name}: ${(err as Error).message}\n${(err as Error).stack ?? ''}` }],
      };
    }
  });

  return server;
}

function isAnalysisResult(v: unknown): v is AnalysisResult {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.decision === 'string'
    && typeof o.overallRiskScore === 'number'
    && typeof o.summary === 'string'
    && Array.isArray(o.findings)
    && !!o.meta;
}

export async function runStdio(): Promise<void> {
  const server = await createRiskServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is reserved for MCP protocol frames.
  process.stderr.write(`[contextos-risk] listening on stdio (v${SERVER_INFO.version})\n`);
}
