import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface SiteBaseline {
  value: string;
  fp: string;
}

export interface AcceptMeta {
  at?: string;
  by?: string;
  reason?: string;
}

export interface TetherBaseline {
  /** The agreed value at the last reconciliation (token tier), or null if unknown. */
  baseline: string | null;
  /** Per-site fingerprints — used to tell which site moved. */
  sites: Record<string, SiteBaseline>;
  accepted?: AcceptMeta | null;
}

export interface Lockfile {
  version: 1;
  tethers: Record<string, TetherBaseline>;
}

export function emptyLock(): Lockfile {
  return { version: 1, tethers: {} };
}

export function readLock(path: string): Lockfile {
  if (!existsSync(path)) return emptyLock();
  try {
    const j: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (j && typeof j === "object" && (j as Lockfile).version === 1 && (j as Lockfile).tethers) {
      return j as Lockfile;
    }
  } catch {
    /* fall through to an empty lock */
  }
  return emptyLock();
}

export function writeLock(path: string, lock: Lockfile): void {
  writeFileSync(path, JSON.stringify(lock, null, 2) + "\n");
}
