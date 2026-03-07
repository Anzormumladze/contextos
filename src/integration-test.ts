/**
 * ContextOS v0.4.0 — Integration Tests
 * Hermetic stdio round-trip with fresh temp config
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0; let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e: any) { console.log(`  ❌ ${name}: ${e.message}`); failed++; }
}
function assert(c: boolean, msg: string) { if (!c) throw new Error(msg); }

function createTempConfig() {
  const dir = mkdtempSync(join(tmpdir(), 'contextos-v4-test-'));
  const configPath = join(dir, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      'mock-tools': { command: 'node', args: [join(__dirname, 'mock-server.js')] },
    },
  }));
  return { configPath, dir };
}

async function run() {
  console.log('\n' + '═'.repeat(62));
  console.log(' ContextOS v0.4.0 — Integration Tests');
  console.log('═'.repeat(62) + '\n');

  const { configPath, dir } = createTempConfig();
  console.log(`  Temp config: ${configPath}\n`);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [join(__dirname, 'cli.js'), 'serve', '--config', configPath],
  });
  const client = new Client({ name: 'int-test', version: '0.4.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    console.log('Connected\n');

    console.log('Layer 1: Tool Exposure');
    await test('exposes exactly 4 tools', async () => {
      assert((await client.listTools()).tools.length === 4, 'expected 4');
    });
    await test('child tools hidden', async () => {
      const names = (await client.listTools()).tools.map((t: any) => t.name);
      assert(!names.includes('read_file'), 'read_file should be hidden');
    });

    console.log('\nLayer 2: Discovery');
    await test('ctx_search finds create_issue', async () => {
      const r = await client.callTool({ name: 'ctx_search', arguments: { query: 'create issue' } }) as any;
      assert(r.content[0].text.includes('mock-tools::create_issue'), r.content[0].text.slice(0, 100));
    });
    await test('ctx_search finds read_file', async () => {
      const r = await client.callTool({ name: 'ctx_search', arguments: { query: 'read file' } }) as any;
      assert(r.content[0].text.includes('mock-tools::read_file'), r.content[0].text.slice(0, 100));
    });

    console.log('\nLayer 3: Schema Loading');
    await test('ctx_describe returns schema for create_issue', async () => {
      const r = await client.callTool({ name: 'ctx_describe', arguments: { tool_id: 'mock-tools::create_issue' } }) as any;
      assert(r.content[0].text.includes('"title"'), 'schema should mention title');
    });
    await test('ctx_describe unknown tool gives helpful error', async () => {
      const r = await client.callTool({ name: 'ctx_describe', arguments: { tool_id: 'ghost::nothing' } }) as any;
      assert(r.content[0].text.toLowerCase().includes('not found'), r.content[0].text);
    });

    console.log('\nLayer 4: Execution');
    await test('ctx_exec returns unwrapped content, not envelope (Fix #4)', async () => {
      const r = await client.callTool({
        name: 'ctx_exec',
        arguments: { tool_id: 'mock-tools::create_issue', args: { title: 'v0.3 test' } },
      }) as any;
      const text = r.content[0].text;
      assert(text.includes('v0.3') || text.includes('[mock]'), `Got: ${text}`);
      assert(!text.startsWith('{\n  "content"'), `Should not be stringified envelope: ${text.slice(0,60)}`);
    });
    await test('ctx_exec unknown tool returns error', async () => {
      const r = await client.callTool({ name: 'ctx_exec', arguments: { tool_id: 'ghost::fake', args: {} } }) as any;
      assert(r.content[0].text.toLowerCase().includes('not found'), r.content[0].text);
    });

    console.log('\nLayer 5: Token Budget');
    await test('ctx_status reports ContextOS overhead and savings', async () => {
      const r = await client.callTool({ name: 'ctx_status', arguments: {} }) as any;
      const text = r.content[0].text;
      assert(text.includes('ContextOS overhead'), `missing overhead: ${text.slice(0, 200)}`);
      assert(text.includes('Exec calls'), `missing exec count: ${text.slice(0, 200)}`);
    });

    console.log('\n' + '═'.repeat(62));
    const total = passed + failed;
    if (failed === 0) {
      console.log(`\n✅ All ${total} integration tests passed\n`);
    } else {
      console.log(`\n${passed}/${total} passed, ${failed} FAILED\n`);
    }
  } finally {
    try { await transport.close(); } catch {}
    rmSync(dir, { recursive: true });
    if (failed > 0) process.exit(1);
  }
}

run().catch(e => { console.error('Runner error:', e); process.exit(1); });
