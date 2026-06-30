import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { walkFiles, findValueSites } from "../src/discover";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tether-disc-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function w(rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

describe("discover", () => {
  it("walkFiles skips ignored dirs", () => {
    w("src/a.ts", "x");
    w("node_modules/pkg/b.js", "y");
    const files = walkFiles(root);
    expect(files.some((f) => f.endsWith("a.ts"))).toBe(true);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("finds both values across files, with line numbers", () => {
    w("package.json", JSON.stringify({ version: "1.0.0-rc.4" }, null, 2) + "\n");
    w("README.md", "line1\nAt `1.0.0-rc.4` now\n");
    w("docs/old.md", "still 1.0.0-rc.3 here\n");
    const c = findValueSites(root, ["1.0.0-rc.4", "1.0.0-rc.3"]);

    const pkg = c.find((x) => x.artifact === "package.json");
    expect(pkg?.suggested).toEqual({ kind: "json-pointer", path: "/version" });

    const readme = c.find((x) => x.artifact === "README.md");
    expect(readme?.line).toBe(2);
    expect(readme?.suggested.kind).toBe("pattern");

    expect(c.some((x) => x.artifact === "docs/old.md" && x.value === "1.0.0-rc.3")).toBe(true);
  });

  it("flags artifacts already known to the seeding tether", () => {
    w("package.json", JSON.stringify({ version: "1.0.0-rc.4" }));
    const c = findValueSites(root, ["1.0.0-rc.4"], { knownArtifacts: new Set(["package.json"]) });
    expect(c.find((x) => x.artifact === "package.json")?.existing).toBe(true);
  });

  it("respects user-defined ignore globs", () => {
    w("keep.md", "still 1.0.0-rc.3");
    w("CHANGELOG.md", "## 1.0.0-rc.3");
    w("docs/history/old.md", "1.0.0-rc.3");
    expect(findValueSites(root, ["1.0.0-rc.3"]).some((c) => c.artifact === "CHANGELOG.md")).toBe(true);

    const filtered = findValueSites(root, ["1.0.0-rc.3"], { ignoreGlobs: ["CHANGELOG.md", "docs/**"] });
    expect(filtered.some((c) => c.artifact === "CHANGELOG.md")).toBe(false);
    expect(filtered.some((c) => c.artifact === "docs/history/old.md")).toBe(false);
    expect(filtered.some((c) => c.artifact === "keep.md")).toBe(true);
  });
});
