import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { truncate, type Tool } from "./index.ts";

interface Args {
  path: string;
}

export const readFileTool: Tool<Args> = {
  name: "read_file",
  description: "Read a text file from disk. Returns its contents with line numbers.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file, relative to cwd or absolute." },
    },
    required: ["path"],
  },
  async execute({ path }, ctx) {
    try {
      const text = await readFile(resolve(ctx.cwd, path), "utf8");
      const numbered = text
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(5)}\t${line}`)
        .join("\n");
      return truncate(numbered);
    } catch (err) {
      return `error: ${(err as Error).message}`;
    }
  },
};
