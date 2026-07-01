import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest, Site } from "../src/spec";
import { extractSite, writeSite } from "../src/extract";
import { emptyLock } from "../src/lockfile";
import { check } from "../src/engine";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "yakir-gen-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("whole-file locator", () => {
  it("compares by content fingerprint, normalising trailing whitespace", () => {
    writeFileSync(join(root, "a.ts"), "export const x = 1;\n");
    writeFileSync(join(root, "b.ts"), "export const x = 1;"); // no trailing newline
    const a: Site = { artifact: "a.ts", locator: { kind: "file" } };
    const b: Site = { artifact: "b.ts", locator: { kind: "file" } };
    expect(extractSite(root, a).value).toMatch(/^sha256:/);
    expect(extractSite(root, a).value).toBe(extractSite(root, b).value); // trailing newline ignored
  });

  it("differs when content differs", () => {
    writeFileSync(join(root, "a.ts"), "export const x = 1;\n");
    writeFileSync(join(root, "b.ts"), "export const x = 2;\n");
    const a: Site = { artifact: "a.ts", locator: { kind: "file" } };
    const b: Site = { artifact: "b.ts", locator: { kind: "file" } };
    expect(extractSite(root, a).value).not.toBe(extractSite(root, b).value);
  });

  it("refuses to auto-write a whole-file site", () => {
    writeFileSync(join(root, "a.ts"), "x\n");
    expect(writeSite(root, { artifact: "a.ts", locator: { kind: "file" } }, "sha256:...").ok).toBe(false);
  });
});

// A generated artifact: a committed file must equal a generator's canonical output.
function genManifest(): Manifest {
  return {
    tethers: [
      {
        id: "completions-generated",
        tier: "executable",
        policy: { severity: "block", mode: "propose" },
        sites: [
          { locator: { kind: "command", run: "node gen.mjs", extract: { whole: true } }, write: "manual" },
          { artifact: "out.generated.ts", locator: { kind: "file" }, write: "managed" },
        ],
      },
    ],
  };
}
function writeGenerator(output: string): void {
  writeFileSync(join(root, "gen.mjs"), `process.stdout.write(${JSON.stringify(output)});\n`);
}

describe("generated-artifact tether (command {whole} ↔ file)", () => {
  it("is fresh when the committed file equals the generator output", () => {
    writeGenerator("export const A = 1;\n");
    writeFileSync(join(root, "out.generated.ts"), "export const A = 1;\n");
    expect(check(genManifest(), root, emptyLock()).findings[0]!.status).toBe("fresh");
  });

  it("catches a stale committed artifact and never rewrites it (report)", () => {
    writeGenerator("export const A = 2;\n"); // source moved
    writeFileSync(join(root, "out.generated.ts"), "export const A = 1;\n"); // committed stale
    const report = check(genManifest(), root, emptyLock());
    expect(report.findings[0]!.status).toBe("disagree"); // first sighting, sides differ
    expect(report.ok).toBe(false);
    expect(readFileSync(join(root, "out.generated.ts"), "utf8")).toContain("A = 1"); // untouched
  });
});
