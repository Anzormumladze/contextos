export function countTokens(text: string): number {
  if (!text) return 0;
  // cl100k_base approximation ±10%. Non-empty strings return minimum 1.
  return Math.max(1, Math.round(text.length / 3.8));
}

export function countJsonTokens(obj: unknown): number {
  return countTokens(JSON.stringify(obj));
}

export interface BudgetSnapshot {
  toolSchemaTokens: number;
  contextFileTokens: number;
  conversationTokens: number;
  totalOverhead: number;
  savedByProxy: number;
}

export class TokenBudget {
  private fullToolLibraryTokens = 0;
  private loadedSchemaTokens = 0;
  private contextFileTokens = 0;
  private loadedToolIds = new Set<string>();
  private describeCount = 0;
  private execCount = 0;

  registerFullLibrary(tools: { name: string; description: string; inputSchema: unknown }[]) {
    this.fullToolLibraryTokens = tools.reduce((s, t) => s + countJsonTokens(t), 0);
  }

  // Only counts schema tokens once per unique tool (on describe, not exec)
  trackSchemaDescribed(toolId: string, tool: { name: string; description: string; inputSchema: unknown }) {
    this.describeCount++;
    if (!this.loadedToolIds.has(toolId)) {
      this.loadedToolIds.add(toolId);
      this.loadedSchemaTokens += countJsonTokens(tool);
    }
  }

  // Tracks execution count only — does NOT add to schema token count
  trackToolExec(_toolId: string) {
    this.execCount++;
  }

  setContextFileTokens(n: number) {
    this.contextFileTokens = n;
  }

  snapshot(): BudgetSnapshot {
    return {
      toolSchemaTokens: this.loadedSchemaTokens,
      contextFileTokens: this.contextFileTokens,
      conversationTokens: 0,
      totalOverhead: this.loadedSchemaTokens + this.contextFileTokens,
      savedByProxy: this.fullToolLibraryTokens - this.loadedSchemaTokens,
    };
  }

  get stats() {
    return {
      fullLibrary: this.fullToolLibraryTokens,
      loaded: this.loadedSchemaTokens,
      uniqueSchemasLoaded: this.loadedToolIds.size,
      describeCount: this.describeCount,
      execCount: this.execCount,
      reductionPct: this.fullToolLibraryTokens > 0
        ? Math.round((1 - this.loadedSchemaTokens / this.fullToolLibraryTokens) * 100)
        : 0,
    };
  }
}
