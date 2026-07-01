// The Tether spec (Layer 0): the declarative vocabulary, serialisable to JSON.

export type Tier = "token" | "executable" | "semantic";
export type Severity = "block" | "warn" | "annotate";
export type Mode = "auto" | "propose";
export type Origin = "declared" | "discovered" | "captured";
export type WriteCap = "managed" | "manual";

/** How a command site pulls a value out of its stdout. */
export type CommandExtract =
  | { json: string } // stdout is JSON; take the value at this JSON Pointer (scalar)
  /**
   * First capture group of this regexp (scalar). With `all: true` the value is the
   * sorted-unique *set* of every capture; `allow` drops listed values from that set.
   */
  | { regex: string; flags?: string; all?: true; allow?: Array<string | number> }
  /** The whole stdout, compared by content fingerprint — for a generated artifact. */
  | { whole: true };

export type Locator =
  | { kind: "json-pointer"; path: string }
  | { kind: "region"; name: string }
  /**
   * A regexp whose first capture group is the value. With `all: true` the value is
   * the sorted-unique *set* of every match; `allow` drops listed values from that set.
   */
  | { kind: "pattern"; match: string; flags?: string; all?: true; allow?: Array<string | number> }
  /**
   * The whole file, compared by content fingerprint (trailing whitespace normalised).
   * For a generated artifact: tether it to a `command` that emits its canonical
   * output (`{ whole: true }`) and drift means "the committed file is stale".
   */
  | { kind: "file" }
  /**
   * Executable tier: the value is *measured* by running a shell command, not read
   * from a file. SECURITY: a command site runs arbitrary shell, so it is
   * declared-only — `discover` never proposes one and never executes one.
   */
  | { kind: "command"; run: string; extract: CommandExtract };

export interface Site {
  /**
   * The artifact this site anchors into. Omitted for `command` sites (they read no
   * file). May be a glob (e.g. every `package.json` under `packages`) — it then
   * expands to one co-equal site per matching file, all sharing this locator and
   * write cap. Use for a monorepo fact that must hold across every package.
   */
  artifact?: string;
  /** Glob(s) to drop from a glob `artifact`'s matches (e.g. private packages). */
  exclude?: string[];
  locator: Locator;
  /** Whether Tether may auto-write this site. Default: "manual" (read-only). */
  write?: WriteCap;
}

/** True when `artifact` is a glob pattern that expands to many sites. */
export function isGlobArtifact(artifact: string | undefined): boolean {
  return artifact !== undefined && /[*?]/.test(artifact);
}

export interface Policy {
  severity?: Severity;
  mode?: Mode;
}

export interface Tether {
  id: string;
  tier?: Tier;
  fact?: string;
  sites: Site[];
  policy?: Policy;
  origin?: Origin;
}

export interface Manifest {
  tethers: Tether[];
  /** Globs excluded from `discover` scanning. User-defined; added to the infra defaults. */
  ignore?: string[];
}

/** Identity helper for typed TS authoring that compiles to the JSON manifest. */
export function defineManifest(m: Manifest): Manifest {
  return m;
}

/** Stable key for a site within a tether, used to index the lockfile. */
export function siteKey(site: Site): string {
  const l = site.locator;
  switch (l.kind) {
    case "json-pointer":
      return `${site.artifact}#${l.path}`;
    case "region":
      return `${site.artifact}#region:${l.name}`;
    case "pattern":
      return `${site.artifact}#pattern:${l.match}${l.all ? ":all" : ""}`;
    case "file":
      return `${site.artifact}#file`;
    case "command": {
      const e = l.extract;
      const how = "json" in e ? `json:${e.json}` : "whole" in e ? "whole" : `regex:${e.regex}${e.all ? ":all" : ""}`;
      return `command:${l.run}#${how}`;
    }
  }
}

/** A human-readable label for a site — its artifact, or the command it runs. */
export function siteLabel(site: Site): string {
  if (site.artifact) return site.artifact;
  if (site.locator.kind === "command") return `$(${site.locator.run})`;
  return siteKey(site);
}

/** True for sites yakir never auto-rewrites: a measured command, a set, or a whole-file hash. */
export function isMeasuredOrSet(site: Site): boolean {
  const l = site.locator;
  return l.kind === "command" || l.kind === "file" || (l.kind === "pattern" && l.all === true);
}

export function siteWrite(site: Site): WriteCap {
  return site.write ?? "manual";
}
