# yakir by example

A gallery of small, self-contained tethers — each one a fact that lives in more than
one place, and the manifest that keeps the copies honest. The scenarios are synthetic
(a made-up `acme` library, a `widgets` monorepo) but the JSON is the real format: drop
any tether into the `tethers` array of a `yakir.json` and run `yakir check`.

Two flags recur:

- `write` — `manual` (yakir only *reads* this site; the default) or `managed` (yakir
  may *rewrite* it). Reconciliation only writes *into* managed sites, so a value can
  never be pushed into your source of truth by accident. Earning `managed` is a trust
  ratchet.
- `policy` — `severity` (`block` fails CI, `warn` reports, `annotate` notes) and `mode`
  (`auto` applies fixes, `propose` only suggests).

The full schema is in [manifest-sketch.md](manifest-sketch.md); the design rationale is
in [DESIGN.md](DESIGN.md).

---

## Token tier — a literal value in many places

### 1. A version badge that can't go stale

The version in `package.json` and the badge in the README must agree. A real release
moves `package.json`; a fat-fingered badge must never move it back.

```json
{
  "id": "package-version",
  "tier": "token",
  "fact": "the published version — package.json vs. the README badge",
  "policy": { "severity": "block", "mode": "auto" },
  "sites": [
    {
      "artifact": "package.json",
      "locator": { "kind": "json-pointer", "path": "/version" },
      "write": "manual"
    },
    {
      "artifact": "README.md",
      "locator": { "kind": "region", "name": "version" },
      "write": "managed"
    }
  ]
}
```

The README carries `<!-- yakir:version -->1.4.2<!-- /yakir -->`. When `package.json`
moves to `1.4.3`, `yakir fix` rewrites the badge to match. When the *badge* is wrong,
the winning value would have to land in `package.json` (a `manual` site) — yakir can't,
so it blocks and asks a human. No site was ever declared "the source"; write-safety did
the work.

### 2. A fact stated in prose

The same value can be a structured field on one side and a sentence on the other. Here
the minimum Node version lives in `engines.node` and is quoted in a requirements page.

```json
{
  "id": "min-node",
  "tier": "token",
  "fact": "the minimum supported Node version, in the manifest and the docs",
  "policy": { "severity": "warn", "mode": "auto" },
  "sites": [
    {
      "artifact": "package.json",
      "locator": { "kind": "json-pointer", "path": "/engines/node" },
      "write": "manual"
    },
    {
      "artifact": "docs/requirements.md",
      "locator": { "kind": "pattern", "match": "requires Node (>=[\\d.]+)" },
      "write": "managed"
    }
  ]
}
```

A `pattern` locator's value is its first capture group. Bump `engines.node` to
`>=20.0.0` and the sentence "requires Node >=18.0.0" is rewritten to match.

### 3. A rename that sweeps every doc

An exported symbol is named once in the source and echoed across several docs. Rename it
in the source and the docs follow; a stray old name in a doc is caught.

```json
{
  "id": "client-factory-name",
  "tier": "token",
  "fact": "the exported factory is named `createClient`",
  "policy": { "severity": "block", "mode": "auto" },
  "sites": [
    {
      "artifact": "src/index.ts",
      "locator": { "kind": "pattern", "match": "export function (\\w+)\\(" },
      "write": "manual"
    },
    {
      "artifact": "README.md",
      "locator": { "kind": "pattern", "match": "call `(\\w+)\\(\\)` to start" },
      "write": "managed"
    },
    {
      "artifact": "docs/quickstart.md",
      "locator": { "kind": "pattern", "match": "`(\\w+)\\(\\)` returns a client" },
      "write": "managed"
    }
  ]
}
```

The source (`manual`) is the only site that can *introduce* a new name; the two docs
(`managed`) receive it. This is the "rename drift" case — one edit, every mention moves.

---

## Monorepo — one tether, every package (glob sites)

A site's `artifact` may be a glob. It expands to one co-equal site per matching file, so
a single tether spans the whole workspace and a newly-added package is covered without
touching the manifest. `exclude` drops the private packages.

### 4. Version lockstep

Every publishable package must share one version.

```json
{
  "id": "version-lockstep",
  "tier": "token",
  "fact": "every published package is at the same version",
  "policy": { "severity": "block" },
  "sites": [
    {
      "artifact": "packages/*/package.json",
      "exclude": ["packages/internal-tooling/package.json"],
      "locator": { "kind": "json-pointer", "path": "/version" },
      "write": "manual"
    }
  ]
}
```

If the release bumps 11 of 12 packages and misses one, the laggard disagrees with the
rest and yakir blocks — naming the file. A glob that matches nothing is an
integrity error (a broken anchor), never a silent pass.

### 5. A shared engines floor

The same shape guards `engines.node` (a *nested* path) across the workspace.

```json
{
  "id": "node-engines",
  "tier": "token",
  "fact": "every package declares the same engines.node",
  "policy": { "severity": "block" },
  "sites": [
    {
      "artifact": "packages/*/package.json",
      "exclude": ["packages/internal-tooling/package.json"],
      "locator": { "kind": "json-pointer", "path": "/engines/node" },
      "write": "manual"
    }
  ]
}
```

---

## Executable tier — a value only a command knows

A `command` site *measures* its value by running a shell command and extracting from
stdout. Because it runs arbitrary shell it is **declared-only**: `discover` never
proposes or runs one. Measured, set-valued, and whole-content tethers are
**detect-and-report** — yakir surfaces the drift and blocks, but never rewrites a
measurement or a generated file in place (you re-run the tool).

### 6. A measured size vs. every advertised quote

A build script prints the bundle size; several docs brag about it as `~NN kB`. The
fact is the *set* of rounded figures, and every quote must match the measurement.

```json
{
  "id": "advertised-size",
  "tier": "executable",
  "fact": "every advertised bundle size equals the measured one",
  "policy": { "severity": "block", "mode": "propose" },
  "sites": [
    {
      "locator": {
        "kind": "command",
        "run": "node scripts/size.mjs --json",
        "extract": { "regex": "\"kb\"\\s*:\\s*(\\d+)", "all": true }
      },
      "write": "manual"
    },
    {
      "artifact": "README.md",
      "locator": { "kind": "pattern", "match": "~\\s*(\\d+)\\s*kB", "all": true },
      "write": "managed"
    },
    {
      "artifact": "docs/install.md",
      "locator": { "kind": "pattern", "match": "~\\s*(\\d+)\\s*kB", "all": true, "allow": [64] }
    }
  ]
}
```

`all: true` makes the value the sorted-unique *set* of every match; sites reconcile by
set-equality, so the order and repetition of the quotes don't matter. `allow: [64]`
drops an unrelated "~64 kB raw" figure on the install page. When the bundle grows,
`yakir check` blocks and shows each stale file against the measured set.

### 7. A measured scalar vs. prose

`extract` also has a `json` form (a JSON Pointer into stdout-as-JSON) for a single
value — here, a compiled default checked against the number quoted in a guide.

```json
{
  "id": "default-timeout",
  "tier": "executable",
  "fact": "the documented default timeout equals the compiled one",
  "policy": { "severity": "block", "mode": "propose" },
  "sites": [
    {
      "locator": {
        "kind": "command",
        "run": "node -e \"import('./dist/config.js').then(m => console.log(JSON.stringify(m.DEFAULTS)))\"",
        "extract": { "json": "/timeoutMs" }
      },
      "write": "manual"
    },
    {
      "artifact": "docs/configuration.md",
      "locator": { "kind": "pattern", "match": "defaults to (\\d+) ?ms" },
      "write": "managed"
    }
  ]
}
```

### 8. A generated file that can't go stale

A committed `*.generated.ts` must equal what its generator produces *now*. Tether the
whole file (by content fingerprint) to a `command` that emits the canonical output.

```json
{
  "id": "generated-types",
  "tier": "executable",
  "fact": "the committed types file matches its generator",
  "policy": { "severity": "block", "mode": "propose" },
  "sites": [
    {
      "locator": {
        "kind": "command",
        "run": "node scripts/gen-types.mjs --emit",
        "extract": { "whole": true }
      },
      "write": "manual"
    },
    {
      "artifact": "src/generated/api-types.ts",
      "locator": { "kind": "file" },
      "write": "managed"
    }
  ]
}
```

`{ "whole": true }` fingerprints the command's stdout; the `file` locator fingerprints
the committed file (trailing whitespace normalised). Equal fingerprints mean the file is
fresh; a mismatch means someone changed the source without regenerating — `yakir check`
blocks and you re-run the generator.

### 9. A generated block inside a hand-written file

When only a *region* of a file is generated (a rendered table, a badge row), tether that
span — not the whole file — to its generator. `region` with `whole: true` compares the
span's content by fingerprint.

```json
{
  "id": "readme-toc",
  "tier": "executable",
  "fact": "the README table of contents matches the headings",
  "policy": { "severity": "block", "mode": "propose" },
  "sites": [
    {
      "locator": {
        "kind": "command",
        "run": "node scripts/gen-toc.mjs --emit",
        "extract": { "whole": true }
      },
      "write": "manual"
    },
    {
      "artifact": "README.md",
      "locator": { "kind": "region", "name": "toc", "whole": true },
      "write": "managed"
    }
  ]
}
```

The README carries `<!-- yakir:toc -->…<!-- /yakir:toc -->`; the prose around it is
never touched. Add a heading, forget to regenerate, and yakir catches it.

---

## Running these

Put any tether in `yakir.json`, then:

```sh
yakir check           # report drift (non-zero exit on blocking drift)
yakir fix             # apply token-tier auto-fixes, advance yakir.lock
yakir accept <id>     # re-baseline a tether to its current state
yakir discover <id>   # sweep the repo for a fact's values, propose more sites
```

Token-tier tethers (1–5) need no build — run them at pre-commit with
`yakir check --tier token`. Executable-tier tethers (6–9) run a command, so run them
where the thing they measure exists (CI, or pre-push after a build).

Real, in-repo examples live in [`../examples/`](../examples).
