/**
 * tools/index.ts — the tool contract.
 *
 * A tool is: a name, a description, a JSON schema for its arguments, and an
 * execute function. The harness converts the first three into a ToolSpec for
 * the model and calls execute when the model asks for it.
 *
 * Rule of thumb: a tool should return a *string* no matter what happens.
 * Errors go back to the model as text so it can recover, rather than
 * crashing the loop.
 */

import type { ToolSpec } from "../provider.ts";

export interface ToolContext {
  cwd: string;
}

export interface Tool<Args = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** If true, the harness asks the user before running. */
  dangerous?: boolean;
  execute(args: Args, ctx: ToolContext): Promise<string>;
}

export function toSpec(tool: Tool<any>): ToolSpec {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** Cap tool output so one noisy command can't eat the whole context window. */
export const MAX_OUTPUT_CHARS = 30_000;

export function truncate(s: string, max = MAX_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  const dropped = s.length - max;
  return s.slice(0, max) + `\n\n[... truncated ${dropped} chars ...]`;
}
