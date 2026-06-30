// The Tether spec (Layer 0): the declarative vocabulary, serialisable to JSON.

export type Tier = "token" | "executable" | "semantic";
export type Severity = "block" | "warn" | "annotate";
export type Mode = "auto" | "propose";
export type Origin = "declared" | "discovered" | "captured";
export type WriteCap = "managed" | "manual";

export type Locator =
  | { kind: "json-pointer"; path: string }
  | { kind: "region"; name: string }
  | { kind: "pattern"; match: string; flags?: string };

export interface Site {
  artifact: string;
  locator: Locator;
  /** Whether Tether may auto-write this site. Default: "manual" (read-only). */
  write?: WriteCap;
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
      return `${site.artifact}#pattern:${l.match}`;
  }
}

export function siteWrite(site: Site): WriteCap {
  return site.write ?? "manual";
}
