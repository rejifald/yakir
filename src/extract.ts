import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Site, Tether } from "./spec";
import { siteKey } from "./spec";
import {
  getJsonPointer,
  setJsonPointer,
  getRegion,
  setRegion,
  getPattern,
  setPattern,
} from "./locators";

export interface Extracted {
  value: string | undefined;
  /** Set when the anchor could not be resolved (missing file, dangling marker). */
  error?: string;
}

export function extractSite(root: string, site: Site): Extracted {
  const abs = join(root, site.artifact);
  if (!existsSync(abs)) return { value: undefined, error: `file not found: ${site.artifact}` };
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    return { value: undefined, error: `cannot read ${site.artifact}: ${(e as Error).message}` };
  }

  const l = site.locator;
  if (l.kind === "json-pointer") {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return { value: undefined, error: `invalid JSON: ${site.artifact}` };
    }
    const v = getJsonPointer(doc, l.path);
    if (v === undefined) return { value: undefined, error: `json-pointer not found: ${l.path}` };
    return { value: String(v) };
  }
  if (l.kind === "region") {
    const v = getRegion(text, l.name);
    if (v === undefined) return { value: undefined, error: `region marker not found: tether:${l.name}` };
    return { value: v };
  }
  const v = getPattern(text, l.match, l.flags);
  if (v === undefined) return { value: undefined, error: `pattern did not match: /${l.match}/` };
  return { value: v };
}

export function extractAll(root: string, tether: Tether): Map<string, Extracted> {
  const out = new Map<string, Extracted>();
  for (const s of tether.sites) out.set(siteKey(s), extractSite(root, s));
  return out;
}

export function writeSite(root: string, site: Site, value: string): { ok: boolean; error?: string } {
  const abs = join(root, site.artifact);
  if (!existsSync(abs)) return { ok: false, error: `file not found: ${site.artifact}` };
  const text = readFileSync(abs, "utf8");

  const l = site.locator;
  if (l.kind === "json-pointer") {
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      return { ok: false, error: `invalid JSON: ${site.artifact}` };
    }
    if (!setJsonPointer(doc, l.path, coerce(value))) return { ok: false, error: `cannot set ${l.path}` };
    const trailing = text.endsWith("\n") ? "\n" : "";
    writeFileSync(abs, JSON.stringify(doc, null, 2) + trailing);
    return { ok: true };
  }
  if (l.kind === "region") {
    const next = setRegion(text, l.name, value);
    if (next === undefined) return { ok: false, error: `region marker not found: tether:${l.name}` };
    writeFileSync(abs, next);
    return { ok: true };
  }
  const next = setPattern(text, l.match, value, l.flags);
  if (next === undefined) return { ok: false, error: `pattern did not match: /${l.match}/` };
  writeFileSync(abs, next);
  return { ok: true };
}

/** Keep obvious JSON scalar types when writing into a json-pointer site. */
function coerce(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
