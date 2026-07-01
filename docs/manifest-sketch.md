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
        locator: { kind: region, name: pkg-version }   # <!-- yakir:pkg-version -->…<!-- /yakir -->
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

## 4. A measured fact — executable tier (`command` + set)

The advertised gzip bundle size is *measured*, and it is quoted as `~NN kB` in
several human-facing files where it drifts. The fact is the **set** of the two
rounded figures (whole entry + `import { stitch }`); every file's set must equal the
measured set.

```yaml
- id: bundle-advertised-size
  tier: executable
  fact: "every advertised gzip bundle size equals the measured one"
  sites:
    # The measured truth — a command, not a file. Runs esbuild against src, so it
    # needs no build step. `write: manual` (you cannot write into a measurement).
    - locator:
        kind: command
        run: "node packages/core/scripts/bundle-size.mjs --src --json"
        extract: { regex: '"kb"\s*:\s*(\d+)', all: true }   # the set of rounded kB
      write: manual
    # The advertised copies — set-valued: every `~NN kB` token in the file.
    - artifact: README.md
      locator: { kind: pattern, match: '~(?:\s|&nbsp;|%20)*(\d+)(?:\s|&nbsp;|%20)*kB', all: true }
      write: managed
    - artifact: packages/core/README.md
      locator: { kind: pattern, match: '~(?:\s|&nbsp;|%20)*(\d+)(?:\s|&nbsp;|%20)*kB', all: true, allow: [64, 20] }
      write: managed
  policy: { severity: block, mode: propose }   # detect-and-report; never auto-rewrites a set
  origin: declared                              # command sites are declared-only — never discovered
```

`allow` drops figures that legitimately sit next to the gzip number but are not it
(here the core README also cites `~64 kB` raw and `~20 kB` brotli). Set-equality is
agreement, so the order and duplication of the quotes do not matter. When the
measurement moves, `yakir check` blocks and shows each stale file → the measured set;
because the tether is measured, yakir reports rather than rewriting the prose.

## 5. A monorepo fact — glob sites

A fact can span *every package* in a monorepo. Rather than hand-listing 30 sites, a
site's `artifact` may be a **glob**: it expands to one co-equal site per matching
file, all sharing the locator. A newly-added package is covered automatically.

```yaml
- id: node-engines
  tier: token
  fact: "every published package supports the same minimum Node"
  sites:
    - artifact: "packages/*/package.json"     # expands to one site per package
      exclude: ["packages/*-internal/**"]      # drop private packages
      locator: { kind: json-pointer, path: /engines/node }
      write: manual
  policy: { severity: block }
```

All expanded sites are peers — they must agree — so this catches the package whose
`engines.node` (or version, or license) lagged a lockstep bump. A glob that matches
nothing is an inventory-integrity error (a broken anchor), not a silent pass.

## 6. A generated artifact — whole-file tether

A committed generated file (`*.generated.ts`, a rendered docs block) must equal what
its generator produces *now*. Tether a `command` that emits the canonical output to
the committed file; both are compared by **content fingerprint** (so the lockfile
stays small and trailing-newline noise is ignored):

```yaml
- id: playground-completions
  tier: executable
  fact: "the committed completions file matches its generator"
  sites:
    - locator: { kind: command, run: "pnpm -s gen:completions --emit", extract: { whole: true } }
      write: manual
    - artifact: apps/docs/.../playground-completions.generated.ts
      locator: { kind: file }        # the whole file, by fingerprint
      write: managed
  policy: { severity: block, mode: propose }   # drift → "regenerate"; never rewritten in place
```

## Notes on the schema

- `locator.kind` is the pluggable anchor strategy: `region` (explicit markers),
  `json-pointer` / `ast` / `pattern` (invisible, deterministic), `file` (the whole
  file, by content fingerprint), `command` (executable tier — measures via a shell
  command), `semantic` (invisible, AI-resolved — ships with the semantic tier).
- `artifact` may be a **glob**; it expands to one co-equal site per matching file.
  `exclude` drops matches (e.g. private packages). A glob matching nothing is an
  integrity error.
- a `command`'s `extract` is `{ json }`, `{ regex }`, `{ regex, all, allow }` (a
  set), or `{ whole: true }` (the whole stdout, by fingerprint — for a generated
  artifact). `file` and set/command sites are compared, never auto-written.
- `pattern` is set-valued with `all: true`: the value is the sorted-unique set of
  every first-capture match, minus any `allow` entries. Sets reconcile by
  set-equality and are never auto-written.
- `command` runs a shell command and extracts from stdout — `{ json: "/ptr" }`,
  `{ regex: "…(cap)…" }`, or `{ regex, all: true, allow }` for the set of all
  matches. **Security:** a command runs arbitrary shell, so it is *declared-only* —
  `discover` never proposes one and never executes one. `artifact` is omitted (it
  anchors to a computation, not a file).
- `write` defaults to `manual`. Earning `managed` is the per-site trust ratchet.
- `check` is only needed when the tier is not plain token equality; it names a BYO
  runner (twoslash, link-resolver, judge…).
- `origin` sets default trust; `discovered` tethers warn but never auto-fix until
  accepted into the manifest.
