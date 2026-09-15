import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { truncate, type Tool } from "./index.ts";

interface Args {
  path?: string;
}

export const listDirTool: Tool<Args> = {
  name: "list_dir",
  description: "List the entries of a directory. Directories are suffixed with '/'.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path. Defaults to cwd." },
    },
  },
  async execute({ path = "." }, ctx) {
    try {
      const entries = await readdir(resolve(ctx.cwd, path), { withFileTypes: true });
      const lines = entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return truncate(lines.join("\n") || "(empty)");
    } catch (err) {
      return `error: ${(err as Error).message}`;
    }
  },
};
