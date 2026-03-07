import { countJsonTokens } from './budget.js';

export interface ToolEntry {
  id: string;              // "github::create_issue"
  server: string;          // "github"
  name: string;            // "create_issue"
  description: string;
  inputSchema: unknown;
  tokens: number;
  keywords: Set<string>;
}

export interface SearchResult {
  entry: ToolEntry;
  score: number;
  matchedTerms: string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[_\-\.]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function buildKeywords(tool: Omit<ToolEntry, 'keywords' | 'tokens' | 'id'>): Set<string> {
  const words = new Set<string>();
  for (const term of tokenize(tool.name)) words.add(term);
  for (const term of tokenize(tool.description)) words.add(term);
  for (const term of tokenize(tool.server)) words.add(term);

  const text = `${tool.name} ${tool.description}`.toLowerCase();
  if (text.includes('creat') || text.includes('add') || text.includes('new')) words.add('create');
  if (text.includes('list') || text.includes('get') || text.includes('fetch') || text.includes('read')) words.add('read');
  if (text.includes('delet') || text.includes('remov')) words.add('delete');
  if (text.includes('updat') || text.includes('edit') || text.includes('modif')) words.add('update');
  if (text.includes('search') || text.includes('find') || text.includes('query')) words.add('search');
  if (text.includes('file') || text.includes('path') || text.includes('director')) words.add('file');
  if (text.includes('git') || text.includes('commit') || text.includes('branch')) words.add('git');
  if (text.includes('issue') || text.includes('ticket') || text.includes('bug')) words.add('issue');
  if (text.includes('pr') || text.includes('pull request') || text.includes('review')) words.add('pullrequest');
  if (text.includes('database') || text.includes('sql') || text.includes('table')) words.add('database');
  if (text.includes('browser') || text.includes('click') || text.includes('navigate')) words.add('browser');
  return words;
}

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>();
  private serverTools = new Map<string, string[]>();

  register(server: string, tools: { name: string; description: string; inputSchema: unknown }[]) {
    const ids: string[] = [];
    for (const tool of tools) {
      const id = `${server}::${tool.name}`;
      const entry: ToolEntry = {
        id, server,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        tokens: countJsonTokens(tool),
        keywords: buildKeywords({ server, name: tool.name, description: tool.description, inputSchema: tool.inputSchema }),
      };
      this.tools.set(id, entry);
      ids.push(id);
    }
    this.serverTools.set(server, ids);
  }

  search(query: string, limit = 5): SearchResult[] {
    // Fix #E: clamp and validate limit
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 1), 50) : 5;
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return this.getAll().slice(0, safeLimit).map(e => ({ entry: e, score: 0, matchedTerms: [] }));
    }

    const results: SearchResult[] = [];
    for (const entry of this.tools.values()) {
      const matchedTerms: string[] = [];
      let score = 0;

      for (const term of queryTerms) {
        if (entry.name.toLowerCase().includes(term)) {
          score += 3;
          matchedTerms.push(term);
        } else if (entry.keywords.has(term)) {
          score += 1;
          matchedTerms.push(term);
        }
        for (const kw of entry.keywords) {
          if (kw.includes(term) && !matchedTerms.includes(term)) {
            score += 0.5;
            matchedTerms.push(term);
            break;
          }
        }
      }
      if (queryTerms.some(t => entry.server.toLowerCase().includes(t))) score += 1;
      if (score > 0) results.push({ entry, score, matchedTerms: [...new Set(matchedTerms)] });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, safeLimit);
  }

  get(id: string): ToolEntry | undefined { return this.tools.get(id); }
  getAll(): ToolEntry[] { return [...this.tools.values()]; }
  getByServer(server: string): ToolEntry[] {
    return (this.serverTools.get(server) ?? []).map(id => this.tools.get(id)!).filter(Boolean);
  }

  get totalTools(): number { return this.tools.size; }
  get totalTokens(): number {
    let sum = 0;
    for (const t of this.tools.values()) sum += t.tokens;
    return sum;
  }
  get servers(): string[] { return [...this.serverTools.keys()]; }
}
