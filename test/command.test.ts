import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest, Site } from "../src/spec";
import { extractSite, writeSite } from "../src/extract";
import { emptyLock } from "../src/lockfile";
import type { Lockfile } from "../src/lockfile";
import { check, fix } from "../src/engine";
import { seedValuesForTether } from "../src/discover";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "yakir-cmd-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// A stand-in for bundle-size.mjs --json: prints two rows each carrying a rounded `kb`.
function writeMeasure(kbs: number[]): void {
  const rows = kbs.map((kb, i) => ({ name: i === 0 ? "whole entry" : "import { stitch }", gzip: kb * 1024, kb }));
  writeFileSync(join(root, "measure.mjs"), `console.log(${JSON.stringify(JSON.stringify(rows, null, 2))});\n`);
}

const measured: Site = {
  locator: {
    kind: "command",
    run: "node measure.mjs",
    extract: { regex: '"kb"\\s*:\\s*(\\d+)', all: true },
  },
  write: "manual",
};

describe("command source — extraction from stdout", () => {
  it("extracts a scalar via a JSON pointer", () => {
    writeFileSync(join(root, "v.mjs"), `console.log(JSON.stringify({ size: { gzip: 42 } }));\n`);
    const site: Site = { locator: { kind: "command", run: "node v.mjs", extract: { json: "/size/gzip" } } };
    expect(extractSite(root, site)).toEqual({ value: "42" });
  });

  it("extracts a scalar via a regex capture group", () => {
    writeFileSync(join(root, "v.mjs"), `console.log("bundle is ~23 kB today");\n`);
    const site: Site = { locator: { kind: "command", run: "node v.mjs", extract: { regex: "~(\\d+) kB" } } };
    expect(extractSite(root, site)).toEqual({ value: "23" });
  });

  it("extracts a set via the all form (sorted-unique)", () => {
    writeMeasure([23, 19]);
    expect(extractSite(root, measured)).toEqual({ value: "19, 23" });
  });

  it("reports a failed command as an error (integrity), never a value", () => {
    const site: Site = { locator: { kind: "command", run: "node does-not-exist.mjs", extract: { json: "/x" } } };
    const ex = extractSite(root, site);
    expect(ex.value).toBeUndefined();
    expect(ex.error).toMatch(/command failed/);
  });
});

describe("measured / set sites are never auto-written", () => {
  it("writeSite refuses a command site", () => {
    expect(writeSite(root, measured, "19, 23").ok).toBe(false);
  });
  it("writeSite refuses a set-valued pattern site", () => {
    writeFileSync(join(root, "README.md"), "~19 kB / ~24 kB\n");
    const setSite: Site = { artifact: "README.md", locator: { kind: "pattern", match: "~(\\d+) kB", all: true }, write: "managed" };
    expect(writeSite(root, setSite, "19, 23").ok).toBe(false);
  });
});

// The StitchAPI advertised-bundle-size case, in miniature: a measured command site
// plus a set-valued prose site that must equal it.
function bundleManifest(): Manifest {
  return {
    tethers: [
      {
        id: "bundle-size",
        tier: "executable",
        policy: { severity: "block", mode: "propose" },
        sites: [
          measured,
          { artifact: "README.md", locator: { kind: "pattern", match: "~(\\d+) kB", all: true }, write: "managed" },
        ],
      },
    ],
  };
}
function writeReadme(kbs: number[]): void {
  writeFileSync(join(root, "README.md"), kbs.map((k) => `~${k} kB`).join(" / ") + "\n");
}

describe("engine — the measured bundle-size case", () => {
  it("catches drift on first sighting (advertised set != measured set) and blocks", () => {
    writeMeasure([23, 19]); // measured {19, 23}
    writeReadme([24, 19]); // advertised {19, 24} — the live drift
    const report = check(bundleManifest(), root, emptyLock());
    expect(report.findings[0]!.status).toBe("disagree");
    expect(report.ok).toBe(false); // severity block → non-zero exit
  });

  it("is fresh once the prose is corrected to the measured set", () => {
    writeMeasure([23, 19]);
    writeReadme([23, 19]); // corrected
    const lock: Lockfile = emptyLock();
    expect(fix(bundleManifest(), root, lock).findings[0]!.status).toBe("fresh");
    expect(lock.tethers["bundle-size"]!.baseline).toBe("19, 23");
  });

  it("reports (never rewrites) when the measurement moves and the prose lags", () => {
    writeMeasure([23, 19]);
    writeReadme([23, 19]);
    const lock: Lockfile = emptyLock();
    fix(bundleManifest(), root, lock); // baseline "19, 23"

    writeMeasure([24, 19]); // the bundle grew → measured {19, 24}
    const report = fix(bundleManifest(), root, lock);
    expect(report.findings[0]!.status).toBe("drifted");
    expect(report.findings[0]!.applied).toBe(false);
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("~23 kB"); // prose untouched
    // the finding still shows the human what to change
    expect(report.findings[0]!.writes.map((w) => w.to)).toEqual(["19, 24"]);
  });
});

describe("security — discover never executes a command site", () => {
  it("seedValuesForTether skips command sites instead of running them", () => {
    // A command that, if run, would leave a sentinel file behind.
    const sentinel = join(root, "RAN");
    writeFileSync(join(root, "danger.mjs"), `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "x");\n`);
    const tether = {
      id: "t",
      sites: [{ locator: { kind: "command" as const, run: "node danger.mjs", extract: { json: "/x" } } }],
    };
    const seeds = seedValuesForTether(root, tether);
    expect(seeds).toEqual([]); // nothing seeded from a command
    expect(existsSync(sentinel)).toBe(false); // and the command was NOT executed
  });
});
