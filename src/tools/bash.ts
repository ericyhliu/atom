import { execFile } from "node:child_process";
import { truncate, type Tool } from "./index.ts";

interface Args {
  command: string;
  timeout_ms?: number;
}

export const bashTool: Tool<Args> = {
  name: "bash",
  description:
    "Run a shell command and return its stdout and stderr. " +
    "Use for anything not covered by a dedicated tool (grep, git, tests, etc).",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to run." },
      timeout_ms: { type: "number", description: "Kill after this many ms (default 60000)." },
    },
    required: ["command"],
  },
  dangerous: true,
  execute({ command, timeout_ms = 60_000 }, ctx) {
    return new Promise((resolve) => {
      execFile(
        "/bin/zsh",
        ["-lc", command],
        { cwd: ctx.cwd, timeout: timeout_ms, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const parts: string[] = [];
          if (stdout) parts.push(stdout);
          if (stderr) parts.push(`[stderr]\n${stderr}`);
          if (err) {
            const code = (err as { code?: number | string }).code;
            parts.push(err.killed ? `[killed: timeout after ${timeout_ms}ms]` : `[exit code ${code}]`);
          }
          resolve(truncate(parts.join("\n").trim() || "(no output)"));
        },
      );
    });
  },
};
