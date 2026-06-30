# Tether

Keep distributed facts in sync. Tether is a drift-prevention framework: it
inventories the places where the same fact lives in more than one artifact —
code, docs, blog posts, generated files like `llms.txt` — and reconciles them
when any one of them changes.

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
  baseline in `tether.lock` tells Tether *which* site moved — which is what makes
  "the newest value is the truth" computable.
- **Reconciliation:** if there is one unambiguous new value and the other sites
  are auto-writable, propagate it; otherwise raise a non-auto-fixable issue the
  human **fixes** or **accepts**.
- Facts come in three **tiers** — token (a literal value), executable (checkable
  by running something), semantic (needs an AI/human judgment) — and Tether
  guards each with the cheapest tier that fits.

See [docs/DESIGN.md](docs/DESIGN.md) for the full design and
[docs/manifest-sketch.md](docs/manifest-sketch.md) for the file format.

## Status

Milestone 1 (token tier) is implemented: the engine, the `check` / `fix` /
`accept` / `init` CLI, three anchor strategies (`json-pointer`, `region`,
`pattern`), and a `tether.lock` baseline. 19 tests green, `tsc --noEmit` clean.

**Dogfood:** running `tether check` against the StitchAPI repo catches a real
drift — the README says `1.0.0-rc.3` while the packages are at `1.0.0-rc.4`. See
[examples/stitchapi-release-version.tether.json](examples/stitchapi-release-version.tether.json).

Next: the executable tier (type-check `twoslash` fences, link resolution) and the
discovered door (a scanner that proposes tethers).

### Try it

```sh
pnpm install
pnpm tether init      # write a starter tether.json
pnpm tether check     # report drift (read-only; non-zero exit on blocking drift)
pnpm tether fix       # apply token-tier auto-fixes and advance tether.lock
pnpm tether accept <id>   # re-baseline a tether to the current state
```
