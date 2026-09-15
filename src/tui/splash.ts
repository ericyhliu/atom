/**
 * tui/splash.ts — the atom.
 *
 * A small software renderer: everything is a 3D point, the whole scene is
 * rotated over time, projected with perspective onto the character grid,
 * and composited through a z-buffer so near things hide far things.
 *
 *   nucleus   seven nucleons (protons warm, neutrons pale) packed as an
 *             octahedron, each a Lambert-shaded sphere drawn with a char ramp
 *   orbits    three tilted circles, dots fade with depth
 *   electrons two per orbit with a fading trail behind each
 *
 * Terminal cells are ~2:1 tall, so screen y is halved.
 */

import { stdin, stdout } from "node:process";
import { fit, seq, size } from "./term.ts";

type Vec = [number, number, number];

const ASPECT = 0.5;
const TILT = 1.15;
const ORBITS = [
  { phi: 0, speed: 1.9, phase: 0.0 },
  { phi: Math.PI / 3, speed: -1.5, phase: 2.1 },
  { phi: (2 * Math.PI) / 3, speed: 2.3, phase: 4.2 },
];
const ELECTRONS_PER_ORBIT = 2;
const TRAIL = ["●", "●", "•", "∘", "·", "·"];

// 256-color ramps, far → near
const PATH_COLORS = [236, 238, 240, 243, 246];
const ELECTRON_COLORS = [23, 30, 37, 44, 51];
const PROTON_COLORS = [94, 130, 172, 214, 220, 229];
const NEUTRON_COLORS = [238, 243, 247, 251, 254, 231];
const SHADE_RAMP = ".:-=+*%@";
const LIGHT = norm([-0.45, -0.7, 0.6]); // upper-left, in front of the screen

function norm(v: Vec): Vec {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function rotX([x, y, z]: Vec, a: number): Vec {
  return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}
function rotY([x, y, z]: Vec, a: number): Vec {
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}
function rotZ([x, y, z]: Vec, a: number): Vec {
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
}
function pick<T>(ramp: T[], t: number): T {
  return ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(t * ramp.length)))];
}

class Canvas {
  readonly ch: string[];
  readonly color: number[];
  readonly bold: boolean[];
  readonly depth: Float64Array;
  readonly cols: number;
  readonly rows: number;
  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.ch = new Array(n).fill(" ");
    this.color = new Array(n).fill(0);
    this.bold = new Array(n).fill(false);
    this.depth = new Float64Array(n).fill(-Infinity);
  }
  put(col: number, row: number, z: number, ch: string, color: number, bold = false) {
    col = Math.round(col);
    row = Math.round(row);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;
    const i = row * this.cols + col;
    if (z <= this.depth[i]) return;
    this.depth[i] = z;
    this.ch[i] = ch;
    this.color[i] = color;
    this.bold[i] = bold;
  }
  toLines(): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.rows; r++) {
      let line = "";
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        if (this.ch[i] === " ") { line += " "; continue; }
        line += `\x1b[${this.bold[i] ? "1;" : ""}38;5;${this.color[i]}m${this.ch[i]}\x1b[0m`;
      }
      out.push(line);
    }
    return out;
  }
}

export function atomFrame(t: number, cols: number, rows: number, version: string): string[] {
  const cv = new Canvas(cols, rows);
  const R = Math.max(5, Math.min(18, Math.floor((cols - 6) / 2.4), rows - 9));
  const cx = cols / 2;
  const cy = (rows - 3) / 2;
  const D = 4.5 * R; // camera distance for perspective

  // whole-scene rotation: a slow tumble so the orbits precess in 3D
  const world = (p: Vec): Vec => rotX(rotY(p, 0.55 * t), 0.3 + 0.35 * Math.sin(0.6 * t));
  const project = (p: Vec) => {
    const s = D / (D - p[2]);
    return { col: cx + p[0] * s, row: cy + p[1] * s * ASPECT, z: p[2] };
  };
  const depthT = (z: number) => (z / R + 1) / 2; // 0 far … 1 near

  // ---- orbit paths ----
  const orbitPoint = (o: (typeof ORBITS)[number], theta: number): Vec =>
    world(rotZ(rotX([R * Math.cos(theta), R * Math.sin(theta), 0], TILT), o.phi));

  for (const o of ORBITS) {
    const n = Math.round(R * 14);
    for (let i = 0; i < n; i++) {
      const p = project(orbitPoint(o, (i / n) * 2 * Math.PI));
      const d = depthT(p.z);
      cv.put(p.col, p.row, p.z, d > 0.65 ? "∙" : "·", pick(PATH_COLORS, d));
    }
  }

  // ---- electrons with trails ----
  for (const o of ORBITS) {
    for (let e = 0; e < ELECTRONS_PER_ORBIT; e++) {
      const head = o.phase + o.speed * t + (e * 2 * Math.PI) / ELECTRONS_PER_ORBIT;
      const dir = Math.sign(o.speed);
      TRAIL.forEach((ch, k) => {
        const p = project(orbitPoint(o, head - dir * k * 0.11));
        const d = depthT(p.z);
        const fade = 1 - k / TRAIL.length;
        cv.put(p.col, p.row, p.z + 0.01, ch, pick(ELECTRON_COLORS, d * fade), k === 0 && d > 0.5);
      });
    }
  }

  // ---- nucleus: seven shaded spheres in an octahedral cluster ----
  const rn = R * 0.16;
  const spread = rn * 0.95;
  const nucleons: { c: Vec; proton: boolean }[] = [
    { c: [0, 0, 0], proton: true },
    { c: [spread, 0, 0], proton: false },
    { c: [-spread, 0, 0], proton: true },
    { c: [0, spread, 0], proton: false },
    { c: [0, -spread, 0], proton: true },
    { c: [0, 0, spread], proton: false },
    { c: [0, 0, -spread], proton: true },
  ];
  for (const nuc of nucleons) {
    const c = world(rotY(rotX(nuc.c, 0.9 * t), 1.3 * t)); // cluster spins on its own too
    const s = D / (D - c[2]);
    const rr = rn * s;
    const ccol = cx + c[0] * s;
    const crow = cy + c[1] * s * ASPECT;
    for (let row = Math.floor(crow - rr * ASPECT) - 1; row <= Math.ceil(crow + rr * ASPECT) + 1; row++) {
      for (let col = Math.floor(ccol - rr) - 1; col <= Math.ceil(ccol + rr) + 1; col++) {
        const x = col - ccol;
        const y = (row - crow) / ASPECT;
        const zz = rr * rr - x * x - y * y;
        if (zz < 0) continue;
        const z = Math.sqrt(zz);
        const nrm: Vec = [x / rr, y / rr, z / rr];
        const lum = Math.max(0, nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]);
        const shade = 0.15 + 0.85 * lum;
        const ramp = nuc.proton ? PROTON_COLORS : NEUTRON_COLORS;
        cv.put(col, row, c[2] + z, pick([...SHADE_RAMP], shade), pick(ramp, shade), shade > 0.8);
      }
    }
  }

  // ---- wordmark ----
  const lines = cv.toLines();
  const wordRow = Math.min(rows - 2, Math.round(cy + R * ASPECT * 1.25) + 2);
  const center = (text: string, style: string) => {
    const pad = Math.max(0, Math.round(cx - text.length / 2));
    return " ".repeat(pad) + style + text + "\x1b[0m";
  };
  lines[wordRow] = center("a  t  o  m", "\x1b[1m");
  lines[wordRow + 1] = center(`v${version} · press any key`, "\x1b[2m");
  return lines;
}

/** Play the animation until a key is pressed. Ctrl-C exits the process. */
export function runSplash(version: string): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;

    const draw = () => {
      const { cols, rows } = size();
      const lines = atomFrame((Date.now() - start) / 1000, cols, rows, version);
      stdout.write(seq.syncOn + seq.home + lines.map((l) => fit(l, cols)).join("\r\n") + seq.syncOff);
    };

    const finish = (buf: Buffer) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      stdin.off("data", finish);
      stdout.off("resize", draw);
      if (buf.includes(0x03)) {
        stdout.write(seq.show + seq.altOff);
        process.exit(0);
      }
      resolve();
    };

    const timer = setInterval(draw, 40);
    stdin.on("data", finish);
    stdout.on("resize", draw);
    draw();
  });
}
