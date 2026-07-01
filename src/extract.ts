import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { Site, Tether, CommandExtract } from "./spec";
import { siteKey } from "./spec";
import { fingerprint } from "./fingerprint";
import {
  getJsonPointer,
  setJsonPointer,
  getRegion,
  setRegion,
  getPattern,
  getPatternAll,
  setPattern,
  canonicalSet,
} from "./locators";

/** Content fingerprint used to compare whole files / whole command output cheaply. */
function contentFingerprint(text: string): string {
  return fingerprint(text.replace(/\s+$/, "")); // normalise trailing whitespace (e.g. a console.log newline)
}

export interface Extracted {
  value: string | undefined;
  /** Set when the anchor could not be resolved (missing file, dangling marker, failed command). */
  error?: string;
}

export function extractSite(root: string, site: Site): Extracted {
  const l = site.locator;

  // Executable tier: measure the value by running a command (reads no file).
  if (l.kind === "command") return runCommand(root, l.run, l.extract);

  if (!site.artifact) return { value: undefined, error: `site has no artifact for a ${l.kind} locator` };
  const abs = join(root, site.artifact);
  if (!existsSync(abs)) return { value: undefined, error: `file not found: ${site.artifact}` };
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    return { value: undefined, error: `cannot read ${site.artifact}: ${(e as Error).message}` };
  }

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
    if (v === undefined) return { value: undefined, error: `region marker not found: yakir:${l.name}` };
    return { value: v };
  }
  if (l.kind === "file") {
    return { value: contentFingerprint(text) }; // whole file, by content fingerprint
  }
  // pattern (scalar or set-valued)
  const v = l.all ? getPatternAll(text, l.match, l.flags, l.allow) : getPattern(text, l.match, l.flags);
  if (v === undefined) return { value: undefined, error: `pattern did not match: /${l.match}/` };
  return { value: v };
}

/** Run a declared command and pull a value (scalar or set) from its stdout. */
function runCommand(root: string, run: string, extract: CommandExtract): Extracted {
  let out: string;
  try {
    out = execSync(run, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail = String(err.stderr ?? err.message ?? "")
      .trim()
      .split("\n")
      .slice(-3)
      .join(" ");
    return { value: undefined, error: `command failed (${run}): ${detail || "non-zero exit"}` };
  }
  return applyCommandExtract(out, extract);
}

function applyCommandExtract(stdout: string, extract: CommandExtract): Extracted {
  if ("whole" in extract) {
    return { value: contentFingerprint(stdout) }; // whole output, by content fingerprint
  }
  if ("json" in extract) {
    let doc: unknown;
    try {
      doc = JSON.parse(stdout);
    } catch {
      return { value: undefined, error: "command stdout is not JSON" };
    }
    const v = getJsonPointer(doc, extract.json);
    if (v === undefined) return { value: undefined, error: `json path not found in stdout: ${extract.json}` };
    return { value: String(v) };
  }
  if (extract.all) {
    const flags = extract.flags?.includes("g") ? extract.flags : (extract.flags ?? "") + "g";
    const out = [...stdout.matchAll(new RegExp(extract.regex, flags))].map((m) => m[1] ?? m[0]);
    if (out.length === 0) return { value: undefined, error: `regex matched nothing in stdout: /${extract.regex}/` };
    return { value: canonicalSet(out, extract.allow) };
  }
  const m = new RegExp(extract.regex, extract.flags).exec(stdout);
  if (!m) return { value: undefined, error: `regex did not match stdout: /${extract.regex}/` };
  return { value: m[1] ?? m[0] };
}

export function extractAll(root: string, tether: Tether): Map<string, Extracted> {
  const out = new Map<string, Extracted>();
  for (const s of tether.sites) out.set(siteKey(s), extractSite(root, s));
  return out;
}

export function writeSite(root: string, site: Site, value: string): { ok: boolean; error?: string } {
  const l = site.locator;
  // Measured and set-valued sites are never auto-written: you cannot write into a
  // command, a set is not mechanically rewritable into prose, and a whole-file site
  // holds a content fingerprint (regenerate the artifact instead).
  if (l.kind === "command") return { ok: false, error: "command sites are measured, not writable" };
  if (l.kind === "file") return { ok: false, error: "whole-file sites are compared by fingerprint, not writable" };
  if (l.kind === "pattern" && l.all) return { ok: false, error: "set-valued sites are not auto-written" };

  if (!site.artifact) return { ok: false, error: `site has no artifact for a ${l.kind} locator` };
  const abs = join(root, site.artifact);
  if (!existsSync(abs)) return { ok: false, error: `file not found: ${site.artifact}` };
  const text = readFileSync(abs, "utf8");

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
    if (next === undefined) return { ok: false, error: `region marker not found: yakir:${l.name}` };
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
