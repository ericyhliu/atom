/**
 * tui/app.ts — the full-screen front end.
 *
 * Same Agent, same AgentEvents as the plain CLI; only the rendering differs.
 * The screen is redrawn from state on every change, top to bottom:
 *
 *   ◉ atom v0.1.0                          model · ~/cwd     header
 *
 *   ❯ what is in src?                                        transcript
 *   ▸ list_dir {"path":"src"}                                (scrolls)
 *   I see 5 entries in src/.
 *
 *   ╭──────────────────────────────────────────────────────╮
 *   │ ❯ type here                                          │  input
 *   ╰──────────────────────────────────────────────────────╯
 *   enter send · pgup/pgdn scroll · ctrl-c quit    240 tok   status
 */

import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import type { Agent, AgentEvents } from "../agent.ts";
import { enterRaw, exitRaw, fit, parseKeys, s, seq, size, visibleWidth, type Key } from "./term.ts";
import { runSplash } from "./splash.ts";

type BlockKind = "user" | "assistant" | "tool" | "result" | "error" | "info";
interface Block { kind: BlockKind; text: string }

export interface TuiOptions {
  version: string;
  model: string;
  cwd: string;
  createAgent(events: AgentEvents): Agent;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CHROME_ROWS = 6; // header(1) + gap(1) + input box(3) + status(1)

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.replace(/\t/g, "  ");
    if (line.length === 0) { out.push(""); continue; }
    while ([...line].length > width) {
      let cut = line.lastIndexOf(" ", width);
      if (cut <= 0) cut = width;
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ +/, "");
    }
    out.push(line);
  }
  return out;
}

function shortPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

class Tui {
  private blocks: Block[] = [];
  private input = "";
  private cursor = 0;
  private history: string[] = [];
  private histIdx = -1;
  private scrollUp = 0; // lines scrolled up from the bottom of the transcript
  private busy = false;
  private status = "";
  private spin = 0;
  private spinTimer: NodeJS.Timeout | null = null;
  private tokens = 0;
  private pending: { label: string; resolve: (ok: boolean) => void } | null = null;
  private agent: Agent;
  private done!: () => void;
  private readonly opts: TuiOptions;

  constructor(opts: TuiOptions) {
    this.opts = opts;
    this.agent = opts.createAgent(this.events());
  }

  // ---- agent events → blocks ---------------------------------------------

  private events(): AgentEvents {
    return {
      onText: (text) => this.push("assistant", text),
      onToolCall: (call, args) => {
        this.status = `running ${call.function.name}…`;
        this.push("tool", `${call.function.name} ${JSON.stringify(args)}`);
      },
      onToolResult: (_call, result) => {
        this.status = "thinking…";
        const lines = result.split("\n");
        this.push("result", lines.slice(0, 8).join("\n") + (lines.length > 8 ? "\n…" : ""));
      },
      onUsage: (u) => { this.tokens += u.total_tokens; },
      confirm: (call, args) => new Promise((resolve) => {
        const cmd = (args as { command?: string }).command ?? JSON.stringify(args);
        this.pending = { label: `${call.function.name}: ${cmd}`, resolve };
        this.render();
      }),
    };
  }

  private push(kind: BlockKind, text: string) {
    this.blocks.push({ kind, text });
    this.scrollUp = 0;
    this.render();
  }

  // ---- lifecycle ----------------------------------------------------------

  async run(): Promise<void> {
    enterRaw();
    stdout.write(seq.altOn + seq.hide + seq.clear);
    await runSplash(this.opts.version);

    stdin.on("data", this.onData);
    stdout.on("resize", this.render);
    this.push("info", `atom v${this.opts.version} · ${this.opts.model} · /help for commands`);

    await new Promise<void>((resolve) => { this.done = resolve; });

    stdin.off("data", this.onData);
    stdout.off("resize", this.render);
    stdout.write(seq.show + seq.altOff);
    exitRaw();
  }

  private onData = (buf: Buffer) => {
    for (const key of parseKeys(buf)) this.handleKey(key);
    this.render();
  };

  // ---- keys ---------------------------------------------------------------

  private handleKey(key: Key) {
    if (this.pending) {
      if (key.name === "text" && /^[yY]$/.test(key.text ?? "")) this.resolvePending(true);
      else if ((key.name === "text" && /^[nN]$/.test(key.text ?? "")) || key.name === "escape") this.resolvePending(false);
      else if (key.name === "ctrl-c") this.quit();
      return;
    }

    switch (key.name) {
      case "ctrl-c": return this.quit();
      case "ctrl-d": if (!this.input) this.quit(); return;
      case "ctrl-l": return;
      case "enter": return this.submit();
      case "backspace":
        if (this.cursor > 0) {
          this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
          this.cursor--;
        }
        return;
      case "delete":
        this.input = this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1);
        return;
      case "left": this.cursor = Math.max(0, this.cursor - 1); return;
      case "right": this.cursor = Math.min(this.input.length, this.cursor + 1); return;
      case "home": this.cursor = 0; return;
      case "end": this.cursor = this.input.length; return;
      case "ctrl-u": this.input = this.input.slice(this.cursor); this.cursor = 0; return;
      case "ctrl-k": this.input = this.input.slice(0, this.cursor); return;
      case "ctrl-w": {
        const before = this.input.slice(0, this.cursor).replace(/\S+\s*$/, "");
        this.input = before + this.input.slice(this.cursor);
        this.cursor = before.length;
        return;
      }
      case "up": return this.recall(1);
      case "down": return this.recall(-1);
      case "pageup": this.scrollUp += Math.floor(this.transcriptHeight() / 2); return;
      case "pagedown": this.scrollUp = Math.max(0, this.scrollUp - Math.floor(this.transcriptHeight() / 2)); return;
      case "text":
        this.input = this.input.slice(0, this.cursor) + key.text + this.input.slice(this.cursor);
        this.cursor += key.text!.length;
        return;
    }
  }

  private recall(dir: 1 | -1) {
    if (this.history.length === 0) return;
    const next = this.histIdx + dir;
    if (next < -1 || next >= this.history.length) return;
    this.histIdx = next;
    this.input = next === -1 ? "" : this.history[this.history.length - 1 - next];
    this.cursor = this.input.length;
  }

  private resolvePending(ok: boolean) {
    const p = this.pending!;
    this.pending = null;
    this.status = ok ? `running ${p.label.split(":")[0]}…` : "thinking…";
    p.resolve(ok);
  }

  private quit() {
    this.pending?.resolve(false);
    this.done();
  }

  // ---- submit -------------------------------------------------------------

  private async submit() {
    const line = this.input.trim();
    if (!line || this.busy) return;
    this.input = "";
    this.cursor = 0;
    this.histIdx = -1;
    this.history.push(line);

    if (line.startsWith("/")) return this.command(line);

    this.push("user", line);
    this.setBusy(true, "thinking…");
    try {
      await this.agent.run(line);
    } catch (err) {
      this.push("error", (err as Error).message);
    } finally {
      this.setBusy(false);
    }
  }

  private command(line: string) {
    switch (line) {
      case "/exit": case "/quit": return this.quit();
      case "/clear": this.agent.reset(); this.blocks = []; return this.push("info", "history cleared");
      case "/history": return this.push("result", JSON.stringify(this.agent.messages, null, 2));
      case "/help": return this.push("info", "/exit  /clear  /history  /help\nkeys: enter send · ↑/↓ history · pgup/pgdn scroll · ctrl-c quit");
      default: return this.push("error", `unknown command ${line}`);
    }
  }

  private setBusy(busy: boolean, status = "") {
    this.busy = busy;
    this.status = status;
    if (busy && !this.spinTimer) {
      this.spinTimer = setInterval(() => { this.spin++; this.render(); }, 80);
    } else if (!busy && this.spinTimer) {
      clearInterval(this.spinTimer);
      this.spinTimer = null;
    }
    this.render();
  }

  // ---- render -------------------------------------------------------------

  private transcriptHeight() {
    return Math.max(1, size().rows - CHROME_ROWS);
  }

  private transcriptLines(width: number): string[] {
    const out: string[] = [];
    for (const b of this.blocks) {
      switch (b.kind) {
        case "user":
          out.push("");
          wrap(b.text, width - 2).forEach((l, i) => out.push((i === 0 ? s.cyan("❯ ") : "  ") + s.bold(l)));
          break;
        case "assistant":
          out.push("");
          wrap(b.text, width).forEach((l) => out.push(l));
          break;
        case "tool": {
          const [name, ...rest] = b.text.split(" ");
          out.push(`${s.cyan("▸")} ${s.bold(name)} ${s.dim(rest.join(" "))}`);
          break;
        }
        case "result":
          wrap(b.text, width - 2).forEach((l) => out.push(s.dim("  " + l)));
          break;
        case "error":
          wrap(b.text, width).forEach((l) => out.push(s.red(l)));
          break;
        case "info":
          wrap(b.text, width).forEach((l) => out.push(s.dim(l)));
          break;
      }
    }
    return out;
  }

  render = () => {
    const { cols, rows } = size();
    const lines: string[] = [];

    // header
    const left = `${s.yellow("◉")} ${s.bold("atom")} ${s.dim("v" + this.opts.version)}`;
    let cwd = shortPath(this.opts.cwd);
    const room = cols - visibleWidth(left) - 2 - this.opts.model.length - 3;
    if (cwd.length > room) cwd = "…" + cwd.slice(-(Math.max(0, room - 1)));
    const right = s.dim(`${this.opts.model} · ${cwd}`);
    const gap = Math.max(1, cols - visibleWidth(left) - visibleWidth(right));
    lines.push(left + " ".repeat(gap) + right);
    lines.push("");

    // transcript
    const height = this.transcriptHeight();
    const all = this.transcriptLines(cols);
    this.scrollUp = Math.min(this.scrollUp, Math.max(0, all.length - height));
    const end = all.length - this.scrollUp;
    const view = all.slice(Math.max(0, end - height), end);
    while (view.length < height) view.unshift("");
    lines.push(...view);

    // input box
    const inner = cols - 2;
    const inputWidth = inner - 3; // "│ ❯ " + input + "│"
    const edge = this.busy ? s.dim : s.cyan;
    let start = 0;
    if (this.cursor >= inputWidth) start = this.cursor - inputWidth + 1;
    const shown = this.input.slice(start, start + inputWidth);
    const prompt = this.busy ? s.dim("❯") : s.cyan("❯");
    lines.push(edge("╭" + "─".repeat(inner) + "╮"));
    lines.push(edge("│") + ` ${prompt} ` + fit(shown, inputWidth) + edge("│"));
    lines.push(edge("╰" + "─".repeat(inner) + "╯"));

    // status
    let status: string;
    if (this.pending) {
      status = s.yellow(`? ${this.pending.label}`) + s.dim("  — y allow · n deny");
    } else if (this.busy) {
      status = s.cyan(SPINNER[this.spin % SPINNER.length]) + " " + s.dim(this.status);
    } else {
      status = s.dim("enter send · ↑/↓ history · pgup/pgdn scroll · ctrl-c quit");
    }
    const tok = s.dim(`${this.tokens} tok`);
    lines.push(fit(status, cols - visibleWidth(tok) - 1) + " " + tok);

    // paint
    let frame = seq.syncOn + seq.home + lines.slice(0, rows).map((l) => fit(l, cols)).join("\r\n");
    const inputRow = rows - 3;
    const inputCol = 5 + (this.cursor - start);
    if (!this.busy && !this.pending) frame += seq.to(inputRow, inputCol) + seq.show;
    else frame += seq.hide;
    stdout.write(frame + seq.syncOff);
  };
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const tui = new Tui(opts);
  const restore = () => stdout.write(seq.show + seq.altOff);
  process.on("uncaughtException", (err) => { restore(); exitRaw(); console.error(err); process.exit(1); });
  await tui.run();
}
