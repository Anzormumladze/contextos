import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'mock-tools', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'read_file', description: 'Read contents of a file from the filesystem', inputSchema: { type: 'object', properties: { path: { type: 'string' }, encoding: { type: 'string' } }, required: ['path'] } },
    { name: 'list_directory', description: 'List files and directories in a given path', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'create_issue', description: 'Create a new GitHub issue with title and body', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['title'] } },
    { name: 'search_code', description: 'Search for code in a repository using GitHub code search', inputSchema: { type: 'object', properties: { query: { type: 'string' }, language: { type: 'string' } }, required: ['query'] } },
    { name: 'send_message', description: 'Send a message to a Slack channel', inputSchema: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, any>;
  if (name === 'read_file') return { content: [{ type: 'text', text: `[mock] Contents of ${a.path}: Hello from mock server!` }] };
  if (name === 'list_directory') return { content: [{ type: 'text', text: `[mock] Files in ${a.path}: file1.ts, file2.ts, README.md` }] };
  if (name === 'create_issue') return { content: [{ type: 'text', text: `[mock] Created issue #42: "${a.title}"` }] };
  if (name === 'search_code') return { content: [{ type: 'text', text: `[mock] Search results for "${a.query}": 3 results found` }] };
  if (name === 'send_message') return { content: [{ type: 'text', text: `[mock] Message sent to ${a.channel}: "${a.text}"` }] };
  return { content: [{ type: 'text', text: `[mock] unknown tool: ${name}` }], isError: true };
});

const transport = new StdioServerTransport();
await server.connect(transport);
