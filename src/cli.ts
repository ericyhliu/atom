#!/usr/bin/env node
/**
 * cli.ts — the terminal front-end.
 *
 * Owns stdin/stdout, the REPL, slash commands, and rendering. Knows nothing
 * about the model — it just wires user input into Agent.run and renders the
 * events that come back.
 */

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Agent, type AgentEvents } from "./agent.ts";
import { systemPrompt } from "./prompt.ts";
import { readFileTool } from "./tools/read_file.ts";
import { listDirTool } from "./tools/list_dir.ts";
import { bashTool } from "./tools/bash.ts";

const MODEL = process.env.ATOM_MODEL ?? "moonshotai/Kimi-K2-Instruct";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const rl = readline.createInterface({ input: stdin, output: stdout });

let totalTokens = 0;

const events: AgentEvents = {
  onText(text) {
    stdout.write(`\n${text}\n\n`);
  },
  onToolCall(call, args) {
    stdout.write(`${cyan("▸")} ${bold(call.function.name)} ${dim(JSON.stringify(args))}\n`);
  },
  onToolResult(_call, result) {
    const preview = result.split("\n").slice(0, 8).join("\n");
    const more = result.split("\n").length > 8 ? dim("\n  …") : "";
    stdout.write(dim(preview.replace(/^/gm, "  ")) + more + "\n");
  },
  onUsage(u) {
    totalTokens += u.total_tokens;
  },
  async confirm(call, args) {
    const cmd = (args as { command?: string }).command ?? JSON.stringify(args);
    const answer = await rl.question(`${yellow("?")} run ${bold(call.function.name)}: ${cmd}  [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  },
};

const agent = new Agent({
  model: MODEL,
  system: systemPrompt(process.cwd()),
  tools: [readFileTool, listDirTool, bashTool],
  cwd: process.cwd(),
  events,
});

async function handle(input: string): Promise<boolean> {
  const line = input.trim();
  if (!line) return true;

  if (line.startsWith("/")) {
    switch (line) {
      case "/exit":
      case "/quit":
        return false;
      case "/clear":
        agent.reset();
        stdout.write(dim("history cleared\n"));
        return true;
      case "/history":
        stdout.write(JSON.stringify(agent.messages, null, 2) + "\n");
        return true;
      case "/help":
        stdout.write("/exit  /clear  /history  /help\n");
        return true;
      default:
        stdout.write(`unknown command ${line}\n`);
        return true;
    }
  }

  try {
    await agent.run(line);
  } catch (err) {
    stdout.write(`\x1b[31merror:\x1b[0m ${(err as Error).message}\n`);
  }
  return true;
}

async function main() {
  const oneShot = process.argv.slice(2).join(" ");
  if (oneShot) {
    await handle(oneShot);
    rl.close();
    return;
  }

  stdout.write(`${bold("atom")} ${dim(`· ${MODEL} · ${process.cwd()}`)}\n`);
  stdout.write(dim("type a message, or /help\n\n"));

  while (true) {
    const input = await rl.question(`${dim(`[${totalTokens} tok]`)} ${bold(">")} `);
    if (!(await handle(input))) break;
  }
  rl.close();
}

main();
