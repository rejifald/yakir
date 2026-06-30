# yakir manifest — format sketch

> A sketch, not a frozen schema. The canonical serialization is JSON (it must
> round-trip as data); a typed TS authoring surface that compiles to that JSON is
> likely. YAML is used here only for readability. Paths below are illustrative,
> drawn from a StitchAPI-shaped repo — they are examples to bind for real during
> dogfooding, not verified anchors.

## Shape

A manifest is a list of tethers. Each tether names a fact, a tier, and the sites
that must hold it:

```yaml
tethers:
  - id: pkg-version                # stable identity
    tier: token                    # token | executable | semantic
    fact: "the published package version"
    sites:
      - artifact: package.json
        locator: { kind: json-pointer, path: /version }
        write: manual              # manual (read-only) | managed (auto-writable)
      - artifact: README.md
        locator: { kind: region, name: pkg-version }   # <!-- tether:pkg-version -->…<!-- /tether -->
        write: managed
    policy: { severity: block, mode: auto }   # block|warn|annotate · auto|propose
    origin: declared               # declared | discovered | captured
```

`yakir.lock` (generated, committed) holds the baseline that reconciliation
compares against:

```yaml
pkg-version:
  baseline: "2.3.1"
  sites:
    "package.json#/version": { fp: "sha256:…", value: "2.3.1" }
    "README.md#pkg-version":  { fp: "sha256:…", value: "2.3.1" }
  accepted: null                   # or { by, at, reason } once a state is accepted
```

## Three worked examples

### 1. README version — token tier

The version in `package.json` and the badge in `README.md` must agree. A real
release moves `package.json`; the badge (managed) is auto-rewritten to match. A
bad edit to the badge cannot rewrite `package.json` (manual) → it becomes an
issue. (Shape as above.)

### 2. A documented code example — executable tier

A `ts twoslash` fence in the docs must still type-check against the current public
types. The fact is *the example compiles and exposes the symbols it shows*.

```yaml
- id: quickstart-example
  tier: executable
  fact: "the quickstart fence type-checks against the current API"
  sites:
    - artifact: apps/docs/content/quickstart.md
      locator: { kind: region, name: quickstart-example }
      write: managed               # yakir can re-run twoslash and update rendered output
  check: { kind: twoslash }        # BYO runner
  policy: { severity: block, mode: propose }
  origin: declared
```

The tether is effectively single-site against an *implicit* peer — the type
surface it compiles against. When the API changes and the fence stops compiling,
the check fails and yakir proposes the fix.

### 3. The `value` → `token` rename — token + semantic

When `SchemaFingerprint.value` was renamed to `.token`, every doc, blog post, and
`llms.txt` mentioning `.value` drifted. That is two tethers over one rename:

```yaml
- id: schema-fingerprint-accessor
  tier: token
  fact: "the SchemaFingerprint accessor is named `token`"
  sites:
    - artifact: packages/core/src/fingerprint.ts
      locator: { kind: ast, query: "SchemaFingerprint member name" }
      write: manual
    - artifact: docs/guide/fingerprints.md
      locator: { kind: pattern, match: "\\.value|\\.token" }
      write: managed
    - artifact: llms.txt
      locator: { kind: region, name: fingerprint-accessor }
      write: managed               # better captured at generation time (origin: captured)
  policy: { severity: warn, mode: auto }
  origin: declared

- id: schema-fingerprint-mental-model
  tier: semantic
  fact: "prose describing SchemaFingerprint matches its current shape/role"
  sites:
    - artifact: apps/docs/blog/why-fingerprints.md
      locator: { kind: semantic, selector: "the passage explaining the accessor" }
      write: manual                # never auto-write prose
  check: { kind: judge, model: byo }
  policy: { severity: annotate, mode: propose }
  origin: discovered               # proposed by the scanner, pending confirmation
```

The token tether mechanically rewrites the symbol everywhere it is managed; the
semantic tether notices that a blog passage *describing* the old shape needs a
human-reviewed rewrite, and only fires because the source actually changed.

## Notes on the schema

- `locator.kind` is the pluggable anchor strategy: `region` (explicit markers),
  `json-pointer` / `ast` / `pattern` (invisible, deterministic), `semantic`
  (invisible, AI-resolved — ships with the semantic tier).
- `write` defaults to `manual`. Earning `managed` is the per-site trust ratchet.
- `check` is only needed when the tier is not plain token equality; it names a BYO
  runner (twoslash, link-resolver, judge…).
- `origin` sets default trust; `discovered` tethers warn but never auto-fix until
  accepted into the manifest.
