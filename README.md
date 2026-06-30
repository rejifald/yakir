# yakir

Pin your docs to the truth so they can't drift. **yakir** is a drift-prevention
framework: it inventories the places where the same fact lives in more than one
artifact — code, docs, blog posts, generated files like `llms.txt` — and
reconciles them when any one of them changes. (*yakir* — Ukrainian for "anchor".)

## The problem

A fact often lives in many places with no live binding between them: the version
in `package.json` and the badge in `README.md`, an API option name in the source
and in three doc pages, a blog post and the docs that describe the same feature.
Each copy is edited independently, so they drift. You can't continuously *prove*
that two prose artifacts agree — but you can watch when one *changes* and
reconcile from there.

## The model in one breath

- A **tether** binds a set of co-equal **sites** (anchors into artifacts) that
  must all hold one fact. There is no "source": a change at *any* site is a drift
  signal.
- Each site carries a **fingerprint**. Comparing current fingerprints to the
  baseline in `yakir.lock` tells yakir *which* site moved — which is what makes
  "the newest value is the truth" computable.
- **Reconciliation:** if there is one unambiguous new value and the other sites
  are auto-writable, propagate it; otherwise raise a non-auto-fixable issue the
  human **fixes** or **accepts**.
- Facts come in three **tiers** — token (a literal value), executable (checkable
  by running something), semantic (needs an AI/human judgment) — and yakir guards
  each with the cheapest tier that fits.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design and
[docs/manifest-sketch.md](docs/manifest-sketch.md) for the file format.

## Status

Milestone 1 (token tier) is implemented: the engine, the `check` / `fix` /
`accept` / `init` CLI, the `discover` scanner, three anchor strategies
(`json-pointer`, `region`, `pattern`), and a `yakir.lock` baseline. 23 tests
green, `tsc --noEmit` clean, zero runtime dependencies.

**Dogfood:** running `yakir check` against the StitchAPI repo catches real drift —
the README claims `1.0.0-rc.3` while the packages are at `1.0.0-rc.4` — and
`yakir discover` finds every other place those versions live. See
[examples/stitchapi-release-version.yakir.json](examples/stitchapi-release-version.yakir.json).

Next: the executable tier (type-check `twoslash` fences, link resolution).

### Try it

```sh
pnpm install
pnpm yakir init       # write a starter yakir.json
pnpm yakir check      # report drift (read-only; non-zero exit on blocking drift)
pnpm yakir fix        # apply token-tier auto-fixes and advance yakir.lock
pnpm yakir accept <id>    # re-baseline a tether to the current state
pnpm yakir discover <id>  # sweep the repo for a fact's values, propose more sites
```

Scope discovery with `ignore` globs in the manifest (e.g. `"ignore": ["CHANGELOG.md"]`) —
yakir ships no opinionated content ignores of its own.

## Use in CI

`yakir check` exits non-zero on blocking drift, so it drops straight into a gate.
Commit `yakir.json` and `yakir.lock`; the check runs against the committed
baseline:

```yaml
# .github/workflows/drift.yml
on: [push, pull_request]
permissions:
  contents: read          # least privilege — the check only reads
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes ./tools/yakir.tgz check   # vendored tarball
```

Not on npm yet (the bare name is pending review). `npm pack` produces a
self-contained `yakir-<version>.tgz` (zero runtime deps) — vendor it and run as
above, or run the bundle directly with `node dist/cli.mjs check` after `pnpm build`.
