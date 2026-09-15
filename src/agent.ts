/**
 * agent.ts — the agent loop. This is the harness.
 *
 *   user input
 *     └─> append to messages
 *         └─> call model with messages + tool specs
 *             ├─ model returned text only  ──> done, wait for user
 *             └─ model returned tool_calls ──> run each tool,
 *                append results as role:"tool" messages, call model again
 *
 * Everything else in a coding agent (streaming, permissions, sessions,
 * context compaction, subagents) is a refinement of this loop.
 */

import { chat, type Message, type ToolCall, type Usage } from "./provider.ts";
import { toSpec, type Tool, type ToolContext } from "./tools/index.ts";

/** Hooks the CLI uses to render what the loop is doing. */
export interface AgentEvents {
  onText(text: string): void;
  onToolCall(call: ToolCall, args: unknown): void;
  onToolResult(call: ToolCall, result: string): void;
  onUsage?(usage: Usage): void;
  /** Return false to deny a dangerous tool call. */
  confirm(call: ToolCall, args: unknown): Promise<boolean>;
}

export interface AgentOptions {
  model: string;
  system: string;
  tools: Tool<any>[];
  cwd: string;
  events: AgentEvents;
  /** Safety valve: max model calls per user turn. */
  maxSteps?: number;
}

export class Agent {
  readonly messages: Message[] = [];
  private readonly opts: AgentOptions;
  private readonly tools: Map<string, Tool<any>>;
  private readonly ctx: ToolContext;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.tools = new Map(opts.tools.map((t) => [t.name, t]));
    this.ctx = { cwd: opts.cwd };
    this.messages.push({ role: "system", content: opts.system });
  }

  /** Drop history but keep the system prompt. */
  reset(): void {
    this.messages.splice(1);
  }

  async run(userInput: string): Promise<void> {
    const { events, maxSteps = 25 } = this.opts;
    this.messages.push({ role: "user", content: userInput });

    for (let step = 0; step < maxSteps; step++) {
      const { message, usage } = await chat({
        model: this.opts.model,
        messages: this.messages,
        tools: [...this.tools.values()].map(toSpec),
      });
      if (usage) events.onUsage?.(usage);

      // Always append the assistant turn as-is — the tool_call ids in it are
      // what the tool results below get matched against.
      this.messages.push(message);
      if (message.content) events.onText(message.content);

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) return; // plain answer; turn is over

      for (const call of calls) {
        const result = await this.executeToolCall(call);
        this.messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }

    events.onText(`[stopped after ${maxSteps} steps]`);
  }

  private async executeToolCall(call: ToolCall): Promise<string> {
    const { events } = this.opts;
    const tool = this.tools.get(call.function.name);

    let args: unknown;
    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return `error: could not parse arguments as JSON: ${call.function.arguments}`;
    }

    events.onToolCall(call, args);

    let result: string;
    if (!tool) {
      result = `error: unknown tool "${call.function.name}"`;
    } else if (tool.dangerous && !(await events.confirm(call, args))) {
      result = "error: the user denied this tool call";
    } else {
      try {
        result = await tool.execute(args as Record<string, unknown>, this.ctx);
      } catch (err) {
        result = `error: ${(err as Error).message}`;
      }
    }

    events.onToolResult(call, result);
    return result;
  }
}
