import { readFileSync, writeFileSync, existsSync } from 'fs';
import { countTokens } from './budget.js';

const FILLERS = [
  /\b(please\s+)?(make\s+sure\s+(to|that)\s+)/gi,
  /\bit\s+is\s+(very\s+)?important\s+(to|that)\s+/gi,
  /\b(always\s+)?remember\s+(to|that)\s+/gi,
  /\byou\s+should\s+always\s+/gi,
  /\byou\s+need\s+to\s+/gi,
  /\bplease\s+note\s+that\s+/gi,
  /\bkeep\s+in\s+mind\s+that\s+/gi,
  /\bwhen\s+working\s+on\s+this\s+project[,.]?\s*/gi,
  /\bfor\s+this\s+project[,.]?\s*/gi,
  /\bin\s+this\s+codebase[,.]?\s*/gi,
  /\bAs\s+an?\s+AI\s+assistant[,.]?\s*/gi,
  /\bYou\s+are\s+an?\s+expert\s+/gi,
];

export function compressLocal(content: string): string {
  let r = content;
  for (const f of FILLERS) r = r.replace(f, '');
  r = r
    .replace(/\bAlways\s+ensure\s+that\s+/gi, 'Ensure: ')
    .replace(/\bDo\s+not\s+/gi, '❌ ')
    .replace(/\bAlways\s+use\s+/gi, '✓ ')
    .replace(/\bfor\s+example[,:]?\s*/gi, 'e.g. ')
    .replace(/\bwhich\s+means\s+that\s+/gi, '→ ')
    .replace(/\bas\s+well\s+as\s+/gi, '& ')
    // Fix #10: removed "instead of" → "not" — changes meaning, breaks semantics
    .replace(/\n{3,}/g, '\n\n');
  return r.trim();
}

export async function compressWithAI(content: string): Promise<string> {
  // Fix #6: read API key from environment, fail loudly if missing
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is not set.\n' +
      'Set it to use AI compression: export ANTHROPIC_API_KEY=sk-ant-...'
    );
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a context file optimizer for AI coding assistants.
Rewrite the input into maximum token-efficient format, preserving 100% semantic content.
Rules:
1. Prose sentences → terse directives
2. Descriptions → YAML/TypeScript type notation
3. Strip all filler: "make sure to", "it is important", "please note", "remember to"
4. Define abbreviations once at the top: ABBR: CS=ControlSchema
5. Max 1 example per concept, inline
6. Use symbols where meaning is preserved: → | & ≠ ✓ ❌
7. Remove headers that just restate the content below them
Return ONLY the compressed content — no preamble, no explanation.`,
      messages: [{ role: 'user', content: `Compress:\n\n${content}` }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Unexpected API response shape');
  return text;
}

export interface CompressResult {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  saved: number;
  pct: number;
}

export async function compressFile(
  filePath: string,
  mode: 'ai' | 'local',
  write: boolean
): Promise<CompressResult> {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const original = readFileSync(filePath, 'utf-8');
  const originalTokens = countTokens(original);
  const compressed = mode === 'ai' ? await compressWithAI(original) : compressLocal(original);
  const compressedTokens = countTokens(compressed);
  const saved = originalTokens - compressedTokens;
  const pct = originalTokens > 0 ? Math.round((saved / originalTokens) * 100) : 0;
  if (write) {
    writeFileSync(`${filePath}.bak`, original);
    writeFileSync(filePath, compressed);
  }
  return { original, compressed, originalTokens, compressedTokens, saved, pct };
}
