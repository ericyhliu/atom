/**
 * tui/splash.ts — the atom.
 *
 * Three electrons on three circular orbits, each tilted out of the screen
 * plane and rotated around the nucleus, projected onto the character grid.
 * Terminal cells are roughly twice as tall as they are wide, so y is halved.
 */

import { stdin, stdout } from "node:process";
import { fit, s, seq, size } from "./term.ts";

const CELL_ASPECT = 0.5;
const TILT = 1.15; // radians the orbit plane leans out of the screen
const ORBITS = [
  { phi: 0, speed: 2.1, phase: 0 },
  { phi: Math.PI / 3, speed: -1.7, phase: 2.1 },
  { phi: (2 * Math.PI) / 3, speed: 2.5, phase: 4.2 },
];

interface Cell { ch: string; style?: (t: string) => string }

/** Point on orbit `o` at angle theta → screen offset + depth. */
function orbitPoint(o: (typeof ORBITS)[number], theta: number, r: number) {
  const x0 = r * Math.cos(theta);
  const y0 = r * Math.sin(theta);
  // tilt around x, then spin around z
  const y1 = y0 * Math.cos(TILT);
  const z = y0 * Math.sin(TILT);
  const x = x0 * Math.cos(o.phi) - y1 * Math.sin(o.phi);
  const y = x0 * Math.sin(o.phi) + y1 * Math.cos(o.phi);
  return { dx: x, dy: y * CELL_ASPECT, z };
}

export function atomFrame(t: number, cols: number, rows: number, version: string): string[] {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ ch: " " })),
  );
  const put = (col: number, row: number, cell: Cell) => {
    col = Math.round(col);
    row = Math.round(row);
    if (row >= 0 && row < rows && col >= 0 && col < cols) grid[row][col] = cell;
  };

  const r = Math.max(4, Math.min(16, Math.floor((cols - 4) / 2), rows - 8));
  const cx = cols / 2;
  const cy = (rows - 3) / 2;

  // orbit paths
  for (const o of ORBITS) {
    for (let i = 0; i < 140; i++) {
      const p = orbitPoint(o, (i / 140) * 2 * Math.PI, r);
      put(cx + p.dx, cy + p.dy, { ch: "·", style: s.dim });
    }
  }

  // electrons behind the nucleus, then nucleus, then electrons in front
  const electrons = ORBITS.map((o) => orbitPoint(o, o.phase + o.speed * t, r));
  for (const e of electrons.filter((e) => e.z < 0)) {
    put(cx + e.dx, cy + e.dy, { ch: "●", style: (x) => s.dim(s.cyan(x)) });
  }
  const pulse = Math.sin(t * 4) > 0 ? "◉" : "◎";
  put(cx, cy, { ch: pulse, style: (x) => s.bold(s.yellow(x)) });
  for (const e of electrons.filter((e) => e.z >= 0)) {
    put(cx + e.dx, cy + e.dy, { ch: "●", style: (x) => s.bold(s.cyan(x)) });
  }

  // wordmark
  const wordRow = Math.round(cy + r * CELL_ASPECT) + 2;
  const write = (row: number, text: string, style?: (t: string) => string) => {
    const start = Math.round(cx - text.length / 2);
    [...text].forEach((ch, i) => put(start + i, row, { ch, style }));
  };
  write(wordRow, "a  t  o  m", s.bold);
  write(wordRow + 1, `v${version} · press any key`, s.dim);

  return grid.map((row) => row.map((c) => (c.style ? c.style(c.ch) : c.ch)).join(""));
}

/** Play the animation until `durationMs` elapses or a key is pressed. */
export function runSplash(version: string, durationMs = 2600): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;

    const draw = () => {
      const { cols, rows } = size();
      const lines = atomFrame((Date.now() - start) / 1000, cols, rows, version);
      stdout.write(seq.syncOn + seq.home + lines.map((l) => fit(l, cols)).join("\r\n") + seq.syncOff);
    };

    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(timer);
      clearTimeout(deadline);
      stdin.off("data", finish);
      stdout.off("resize", draw);
      resolve();
    };

    const timer = setInterval(draw, 50);
    const deadline = setTimeout(finish, durationMs);
    stdin.on("data", finish);
    stdout.on("resize", draw);
    draw();
  });
}
