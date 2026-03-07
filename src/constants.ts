import { countJsonTokens } from './budget.js';

export const CONTEXTOS_TOOL_DEFS = [
  {
    name: 'ctx_search',
    description: 'Search for available tools by describing what you want to do. Returns matching tool IDs and short descriptions WITHOUT loading full schemas — call ctx_describe to load schema before executing.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural language e.g. "create github issue", "read file contents"' },
        limit: { type: 'number', description: 'Max results (default 5, max 20)', default: 5 },
      },
    },
  },
  {
    name: 'ctx_describe',
    description: 'Load the full input schema for one tool by ID (format: "server::tool_name"). Call this before ctx_exec.',
    inputSchema: {
      type: 'object',
      required: ['tool_id'],
      properties: {
        tool_id: { type: 'string', description: 'Tool ID in format "server::tool_name" from ctx_search' },
      },
    },
  },
  {
    name: 'ctx_exec',
    description: 'Execute any tool by its ID. Workflow: ctx_search → ctx_describe → ctx_exec.',
    inputSchema: {
      type: 'object',
      required: ['tool_id', 'args'],
      properties: {
        tool_id: { type: 'string', description: 'Tool ID in format "server::tool_name"' },
        args: { type: 'object', description: 'Tool arguments as JSON object' },
      },
    },
  },
  {
    name: 'ctx_status',
    description: 'Token budget dashboard: schemas loaded, tokens saved, exec stats.',
    inputSchema: {
      type: 'object',
      properties: {
        compress_file: { type: 'string', description: 'Optional: path to a CLAUDE.md or context file to analyze' },
      },
    },
  },
] as const;

// Actual token cost of the 4 stubs Claude sees upfront — computed from real defs
export const CONTEXTOS_SCHEMA_TOKENS = CONTEXTOS_TOOL_DEFS.reduce(
  (sum, t) => sum + countJsonTokens(t),
  0
);
