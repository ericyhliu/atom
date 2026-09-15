/**
 * tui/term.ts — the terminal as a device.
 *
 * Everything here is plain ANSI escape sequences. There is no library; a
 * terminal is just a byte stream in each direction, and this file names the
 * bytes that matter.
 */

import { stdin, stdout } from "node:process";

const ESC = "\x1b";

export const seq = {
  altOn: `${ESC}[?1049h`,   // switch to the alternate screen buffer
  altOff: `${ESC}[?1049l`,  // and back, restoring the user's scrollback
  hide: `${ESC}[?25l`,
  show: `${ESC}[?25h`,
  home: `${ESC}[H`,
  clear: `${ESC}[2J`,
  eol: `${ESC}[K`,          // clear from cursor to end of line
  syncOn: `${ESC}[?2026h`,  // "synchronized output": terminal buffers until syncOff (no tearing)
  syncOff: `${ESC}[?2026l`,
  to: (row: number, col: number) => `${ESC}[${row};${col}H`,
};

const wrapStyle = (open: string, close: string) => (t: string) => `${ESC}[${open}m${t}${ESC}[${close}m`;
export const s = {
  reset: `${ESC}[0m`,
  bold: wrapStyle("1", "22"),
  dim: wrapStyle("2", "22"),
  italic: wrapStyle("3", "23"),
  cyan: wrapStyle("36", "39"),
  yellow: wrapStyle("33", "39"),
  red: wrapStyle("31", "39"),
  green: wrapStyle("32", "39"),
  magenta: wrapStyle("35", "39"),
  blue: wrapStyle("34", "39"),
  white: wrapStyle("97", "39"),
};

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

export function visibleWidth(str: string): number {
  return [...stripAnsi(str)].length;
}

/** Pad or truncate `str` to exactly `width` visible cells, passing escapes through. */
export function fit(str: string, width: number): string {
  let out = "";
  let w = 0;
  let i = 0;
  while (i < str.length) {
    if (str[i] === ESC) {
      const m = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(str.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (w >= width) break;
    const cp = str.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    out += ch;
    i += ch.length;
    w++;
  }
  return out + s.reset + " ".repeat(Math.max(0, width - w));
}

export function size(): { cols: number; rows: number } {
  return { cols: stdout.columns || 80, rows: stdout.rows || 24 };
}

// ---------------------------------------------------------------------------
// Keys. In raw mode stdin hands us bytes; this turns them into named keys.
// ---------------------------------------------------------------------------

export interface Key {
  name: string;   // "enter" | "backspace" | "up" | "text" | "ctrl-c" | ...
  text?: string;  // for name === "text": the printable characters
}

const CSI_KEYS: Record<string, string> = {
  A: "up", B: "down", C: "right", D: "left", H: "home", F: "end",
  "1~": "home", "4~": "end", "3~": "delete", "5~": "pageup", "6~": "pagedown",
};

const CTRL_KEYS: Record<string, string> = {
  "\r": "enter", "\n": "enter", "\x7f": "backspace", "\b": "backspace", "\t": "tab",
  "\x01": "home", "\x05": "end", "\x03": "ctrl-c", "\x04": "ctrl-d",
  "\x0b": "ctrl-k", "\x0c": "ctrl-l", "\x15": "ctrl-u", "\x17": "ctrl-w",
};

export function parseKeys(buf: Buffer): Key[] {
  const str = buf.toString("utf8");
  const keys: Key[] = [];
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === ESC) {
      const next = str[i + 1];
      if (next === "[" || next === "O") {
        // CSI / SS3 sequence: ESC [ <params> <final byte in @..~>
        let j = i + 2;
        while (j < str.length && !/[@-~]/.test(str[j])) j++;
        const body = str.slice(i + 2, j + 1);
        const name = CSI_KEYS[body];
        if (name) keys.push({ name });
        i = j + 1;
      } else {
        keys.push({ name: "escape" });
        i++;
      }
      continue;
    }
    if (ch in CTRL_KEYS) {
      keys.push({ name: CTRL_KEYS[ch] });
      i++;
      continue;
    }
    if (ch < " ") {
      keys.push({ name: `ctrl-${String.fromCharCode(ch.charCodeAt(0) + 96)}` });
      i++;
      continue;
    }
    // Printable run (typed or pasted). Stop at the next control byte or ESC.
    let j = i;
    while (j < str.length && str[j] >= " " && str[j] !== ESC && str[j] !== "\x7f") j++;
    keys.push({ name: "text", text: str.slice(i, j) });
    i = j;
  }
  return keys;
}

export function enterRaw(): void {
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
}

export function exitRaw(): void {
  if (stdin.isTTY) stdin.setRawMode(false);
  stdin.pause();
}
