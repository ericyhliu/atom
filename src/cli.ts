#!/usr/bin/env node
/**
 * cli.ts — entrypoint.
 *
 * Two front ends share one Agent:
 *   - plain:  `atom "prompt"`, or stdin/stdout not a TTY. Streams to stdout,
 *             pipe-friendly.
 *   - tui:    `atom` in a terminal. Full-screen app (see tui/app.ts).
 *
 * Neither knows about the model; both just render AgentEvents.
 */

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Agent, type AgentEvents } from "./agent.ts";
import { systemPrompt } from "./prompt.ts";
import { readFileTool } from "./tools/read_file.ts";
import { listDirTool } from "./tools/list_dir.ts";
import { bashTool } from "./tools/bash.ts";
import { runTui } from "./tui/app.ts";
import pkg from "../package.json" with { type: "json" };

const MODEL = process.env.ATOM_MODEL ?? "moonshotai/Kimi-K2-Instruct";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

function createAgent(events: AgentEvents): Agent {
  return new Agent({
    model: MODEL,
    system: systemPrompt(process.cwd()),
    tools: [readFileTool, listDirTool, bashTool],
    cwd: process.cwd(),
    events,
  });
}

// ---- plain mode -------------------------------------------------------------

async function runPlain(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  const agent = createAgent({
    onText(text) {
      stdout.write(`${text}\n`);
    },
    onToolCall(call, args) {
      stdout.write(`${cyan("▸")} ${bold(call.function.name)} ${dim(JSON.stringify(args))}\n`);
    },
    onToolResult(_call, result) {
      const lines = result.split("\n");
      const preview = lines.slice(0, 8).join("\n");
      stdout.write(dim(preview.replace(/^/gm, "  ")) + (lines.length > 8 ? dim("\n  …") : "") + "\n");
    },
    async confirm(call, args) {
      const cmd = (args as { command?: string }).command ?? JSON.stringify(args);
      const answer = await rl.question(`${yellow("?")} run ${bold(call.function.name)}: ${cmd}  [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    },
  });

  try {
    await agent.run(prompt);
  } catch (err) {
    stdout.write(`\x1b[31merror:\x1b[0m ${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

// ---- main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--version" || args[0] === "-v") {
    stdout.write(`atom ${pkg.version}\n`);
    return;
  }
  if (args[0] === "--help" || args[0] === "-h") {
    stdout.write(`atom ${pkg.version} — a minimal coding agent on together.ai

usage:
  atom              start the interactive app
  atom "<prompt>"   run a single prompt and exit (pipe-friendly)
  atom --version

env:
  TOGETHER_API_KEY  required
  ATOM_MODEL        model id (default: ${MODEL})
`);
    return;
  }

  if (args.length > 0) return runPlain(args.join(" "));

  if (!stdin.isTTY || !stdout.isTTY) {
    stdout.write("atom: no prompt given and not running in a terminal (try: atom \"your prompt\")\n");
    process.exitCode = 1;
    return;
  }

  await runTui({ version: pkg.version, model: MODEL, cwd: process.cwd(), createAgent });
}

main();
