import { MockLanguageModelV4 } from 'ai/test';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

type Turn = { tool: string; input: unknown }[] | string;

/** A scripted model: each turn is either a list of tool calls or a final text. */
export function scriptedModel(turns: Turn[]) {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const turn = turns[Math.min(i, turns.length - 1)];
      i++;
      if (typeof turn === 'string') {
        return { content: [{ type: 'text' as const, text: turn }], finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] };
      }
      return {
        content: turn.map((c, n) => ({ type: 'tool-call' as const, toolCallId: `call_${i}_${n}`, toolName: c.tool, input: JSON.stringify(c.input) })),
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}
