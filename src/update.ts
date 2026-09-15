/**
 * update.ts — self-update.
 *
 * On launch the compiled binary asks GitHub for the latest release. If it's
 * newer, the splash offers to update: download the matching asset, verify it
 * against checksums.txt, atomically rename it over the running executable,
 * and re-exec. Running from source (node/bun) never self-updates.
 */

import { createHash } from "node:crypto";
import { chmod, rename, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const REPO = "ericyhliu/atom";

export interface Release {
  version: string; // "0.4.0"
  tag: string;     // "v0.4.0"
  assetUrl: string;
  checksumsUrl: string;
}

export function isCompiledBinary(): boolean {
  const exe = basename(process.execPath);
  return exe !== "node" && exe !== "bun" && !exe.startsWith("node.") && !exe.startsWith("bun.");
}

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** Resolves to a Release if one newer than `current` exists; null otherwise (including on any error). */
export async function checkForUpdate(current: string): Promise<Release | null> {
  if (!isCompiledBinary() || process.env.ATOM_NO_UPDATE_CHECK) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": `atom/${current}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    const tag = data.tag_name ?? "";
    const version = tag.replace(/^v/, "");
    if (!version || !newer(version, current)) return null;
    const asset = `atom-${process.platform}-${process.arch}`;
    const base = `https://github.com/${REPO}/releases/download/${tag}`;
    return { version, tag, assetUrl: `${base}/${asset}`, checksumsUrl: `${base}/checksums.txt` };
  } catch {
    return null;
  }
}

async function download(url: string, onProgress?: (fraction: number) => void): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress?.(received / total);
  }
  return Buffer.concat(chunks);
}

/** Download, verify, and replace the running executable. Throws on failure. */
export async function applyUpdate(rel: Release, onProgress: (msg: string) => void): Promise<void> {
  onProgress(`downloading v${rel.version}…`);
  const [bin, sums] = await Promise.all([
    download(rel.assetUrl, (f) => onProgress(`downloading v${rel.version}… ${Math.round(f * 100)}%`)),
    download(rel.checksumsUrl),
  ]);

  onProgress("verifying…");
  const asset = basename(rel.assetUrl);
  const expected = sums.toString("utf8").split("\n").find((l) => l.trim().endsWith(` ${asset}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`no checksum for ${asset}`);
  const actual = createHash("sha256").update(bin).digest("hex");
  if (actual !== expected) throw new Error("checksum mismatch — update aborted");

  onProgress("installing…");
  const target = process.execPath;
  const tmp = `${target}.new`;
  try {
    await writeFile(tmp, bin);
    await chmod(tmp, 0o755);
    await rename(tmp, target); // atomic; the running process keeps its old inode
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      throw new Error(`no write permission for ${target} — re-run the installer instead`);
    }
    throw err;
  }
}
