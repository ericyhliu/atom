/**
 * provider.ts — the model boundary.
 *
 * The harness only ever talks to the model through this file. together.ai
 * exposes an OpenAI-compatible /chat/completions endpoint, so these types
 * mirror that wire format exactly. Everything above this layer (the agent
 * loop, tools, CLI) is provider-agnostic.
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments is a JSON string
}

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type AssistantMessage = Extract<Message, { role: "assistant" }>;

/** JSON-schema description of a tool, as the model sees it. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  tools?: ToolSpec[];
  temperature?: number;
  max_tokens?: number;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  message: AssistantMessage;
  finishReason: string; // "stop" | "tool_calls" | "length" | ...
  usage?: Usage;
}

const BASE_URL = process.env.TOGETHER_BASE_URL ?? "https://api.together.xyz/v1";

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) throw new Error("TOGETHER_API_KEY is not set (see .env.example)");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...req, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`together.ai ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error(`no choices in response: ${JSON.stringify(data)}`);

  return {
    message: choice.message,
    finishReason: choice.finish_reason,
    usage: data.usage,
  };
}
