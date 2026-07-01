# yakir — Design

> Status: design / pre-implementation. This document is the agreed shape for v1.
> The engine, CLI, and lockfile do not exist yet; building them is the next step.

## 1. Problem

"Drift" is what happens when the same fact lives in more than one artifact with no
live binding between the copies. Each copy is edited or regenerated independently,
so they fall out of sync:

- `package.json` says `2.3.1`; the `README` badge still says `2.2.0`.
- An API option is renamed in source; three doc pages and a blog post still use
  the old name.
- `llms.txt` is generated from source files that have since changed.
- A blog post and the docs describe the same feature and have quietly diverged.

In code we avoid this with a single source of truth and an import. Across artifact
boundaries — code ↔ README ↔ docs ↔ blog ↔ generated files — you usually can't
import; the value gets copied or derived, and the copy goes stale.

The core observation: you cannot continuously *prove* that two prose artifacts
agree. But you can *watch when one changes* and reconcile from there. yakir is a
build system for that — a dependency graph over facts, where the "rebuild" step is
sometimes deterministic and sometimes a human or AI judgment.

### Scope for v1

- In-repo files, one repository at a time.
- Token and executable tiers fully; the semantic tier designed in but shipped
  behind them.
- Cross-repo and repo-to-world watching (npm latest, external URLs) is a later
  layer, not v1.

## 2. Core model: tethers and sites

A **tether** binds a set of co-equal **sites** that must all hold the same fact.

- A **site** is an anchor into an artifact: `(locator, extractor)` plus flags. The
  locator finds a region; the extractor pulls the value (or a fingerprint of it)
  from that region.
- A tether has **no source and no direction.** Every site is a peer. A change at
  *any* site is a drift signal — including the one you might think of as
  "canonical."
- The set of all tethers is the **inventory**. It is a set of clusters (a
  hypergraph over sites), not a DAG — there are no directed edges to point.

Direction is not a property of a tether. The only per-site asymmetry is a
capability — *may yakir auto-write this site?* — described in §7. That is about
safety, not authority: a read-only site is not "the truth," it is just a site
yakir will never edit on its own.

## 3. Fingerprints and the lifecycle

Each site carries a **fingerprint** of its current value. The last agreed
fingerprints are stored as a **baseline** in `yakir.lock`. Comparing current
fingerprints to the baseline is what tells yakir *which* site moved — which is
exactly what makes "the newest value is the truth" computable, and what lets the
expensive semantic tier run only when a source actually changed.

A tether moves through three states:

- **fresh** — every site matches the baseline. Nothing to do.
- **suspect** — at least one site's fingerprint changed since the baseline. This
  triggers reconciliation (§4).
- **drifted** — reconciliation could not resolve automatically. yakir raises a
  non-auto-fixable issue, resolved by a human two ways:
  - **Fix** — change the offending site(s) until they agree again.
  - **Accept** — re-baseline to the current state without editing anything, the
    human asserting "these now agree." (See §9; accepts are reviewable writes to
    `yakir.lock`.)

## 4. Reconciliation

On each run, for every tether: extract the value at each site and compare all of
them to the baseline. Partition the sites and act:

1. **All sites == baseline** → `fresh`. Nothing to do.
2. **All sites agree with each other but differ from the baseline** → a consistent
   update (every copy was changed the same way, or the baseline was simply
   behind). Advance the baseline silently. → `fresh`.
3. **Exactly one new value** (one or more sites moved to it; the rest still match
   the baseline) → that value is the new truth. Propagate it to the other sites
   (subject to the auto-write capability, §7) and re-baseline. → `fresh`.
4. **Two or more _different_ new values** → a genuine conflict. yakir cannot pick
   a winner. → `drifted`: raise the issue for a human. (Optionally, git history
   *suggests* the most-recently-edited site as the likely winner — a suggestion in
   the issue, never an auto-applied choice.)

"Newest = truth" is case 3. It is only decidable because per-site fingerprints
reveal which site moved.

### How propagation differs by tier

Case-3 propagation is fully mechanical only at the token tier. The distributed
model degrades gracefully:

- **token** — write the winning literal value into the other sites.
- **executable** — regenerate the derived sites from their inputs. In v1 the
  executable tier is **detect-and-report**: a measured fact (a `command` site) or a
  **set** of values is never mechanically rewritten into prose — the drift is
  surfaced as a blocking finding and a human re-measures / updates. (Mechanical
  regeneration of a derived site is a later enhancement on the same tier.)
- **semantic** — there is no single value to copy. Re-judge the other sites for
  consistency with the change, and route any inconsistency to a drafted patch /
  issue. yakir never auto-writes prose.

## 5. Tiers

A tether declares a tier; yakir guards it with the cheapest mechanism that fits.

| tier | the fact is | check | auto-resolution |
| --- | --- | --- | --- |
| **token** | a literal value (version, symbol, flag, count) | extract both sides, compare | write the winner into managed sites |
| **executable** | true only if something runs (a fence type-checks, a link resolves, an example's output matches, an export is documented) | run it | regenerate the derived site |
| **semantic** | a claim whose truth needs meaning ("this post still matches the API") | a **diff-aware** AI/human judge | draft a PR + the triggering diff; never auto-write |

The executable tier's first mechanism is a **`command` source**: a site whose value
is *measured* by running a shell command (`node:child_process`) and pulling a value
from its stdout — a JSON path, a regex capture group, or the **set** of all matches.
The value is computed, not read, which is exactly what lets yakir guard a fact that
only a build step knows (a bundle's gzip size, a generated row count). Because a
command runs arbitrary shell, it is **declared-only**: `discover` never proposes one
and never executes one (§8). A tether that carries a command site — or any
set-valued site — is detect-and-report (§4), `severity: block`, `mode: propose`.

Two rules make the semantic tier trustworthy enough to act on:

1. The fingerprint **rate-limits** it: the judge only runs when a source actually
   changed, not on every check.
2. The judge is **diff-aware**: it is asked "the source went X → Y; is this site
   still consistent?", never "is this true?" in a vacuum. Bounded and grounded.

## 6. Anchoring

A site's locator can use either of two strategies — both are first-class and a
consumer picks per site. Neither is privileged.

- **Explicit region** — a marked span, e.g.
  `<!-- tether:pkg-version -->2.3.1<!-- /tether -->`. Robust, self-documenting,
  zero ambiguity; invasive. For consumers who want the binding visible.
- **Invisible** — a pattern, a structured path (JSON pointer, AST query), or a
  semantic selector ("the sentence stating the minimum Node version"). Zero-touch
  setup; fuzzier, and semantic selectors need AI re-resolution each run.

v1 ships explicit-region + structured-path (both deterministic). Semantic
selectors arrive with the semantic tier. Strategies are pluggable
`AnchorResolver`s, so adding more is additive.

The executable tier adds one locator that does not *read* a region at all: a
**`command`** site measures its value by running a command and extracting from
stdout. It anchors to a computation rather than a span — the same `(locator,
extractor)` shape, with the artifact being a process instead of a file. A **`file`**
locator anchors to a whole file (compared by content fingerprint) — pair it with a
`command` that emits a generator's canonical output and the fact becomes "this
generated artifact is not stale."

A site's `artifact` may also be a **glob**. It expands to one co-equal site per
matching file (minus `exclude`d paths), so a single tether can bind a fact across
every package in a monorepo — the version, the `engines.node` floor, the license —
and a newly-added package is covered without editing the manifest. This is how the
"cluster" (§2) scales past a hand-listed set without giving up the sourceless model:
the expanded sites are still peers.

## 7. Auto-write capability and the trust ratchet

The only per-site asymmetry. Each site is either:

- **managed** — yakir may auto-write it (README badges, generated files), or
- **manual** — yakir may only read it (source code, `package.json`).

Default is **manual**. A site *earns* `managed` once you trust the binding — the
same "earn auto-fix" ratchet used for counted lint suppressions. Reconciliation
(§4 case 3) only propagates *into* managed sites; if the winning value would have
to land in a manual site, yakir cannot auto-fix and raises the non-auto-fixable
issue instead.

This is what makes "no source" safe. Example: a tether over
`{ package.json#version (manual), README badge (managed) }`. A real release bumps
`package.json`; the badge is rewritten to match. But a typo in the badge can never
rewrite `package.json` — that value would have to land in a manual site, so it
becomes an issue, not a silent corruption. No site was ever called "the source";
write-safety alone did the work.

## 8. Intake: how the inventory gets populated

Three doors, all feeding one inventory. A site/tether records its `origin`, which
sets default trust:

- **declared** — hand-written in the manifest. Highest trust; auto-eligible.
- **discovered** — a scanner proposes candidate tethers (matching version strings,
  code fences, links, files with generated-by headers; AI for the fuzzy
  groupings). Proposals land **unconfirmed**: they warn, but never auto-fix until
  a human accepts them into the inventory. This is the defense against
  under-coverage — the fact you forgot to register is the one that bites.
- **captured** — recorded when an artifact is generated *through* yakir. The
  inputs are known exactly at generation time, so anchoring is perfect and the
  derived site is `managed` by construction. The encouraged path for anything you
  generate (`llms.txt`, injected snippets, templated READMEs).

Note "no source" removes *direction*, not the need to *cluster*: you still declare
or discover which sites form one fact.

## 9. The lockfile

One **`yakir.lock` per repository**. One entry per tether, holding the agreed
baseline value/fingerprint and each site's individual fingerprint (needed to tell
which site moved in §4). It is committed and reviewed like any other lockfile.

- **Accept is per-tether.** You accept a fact's new state across all its sites in
  one gesture — exactly right for a rename: one accept settles every site that
  mentioned the old name.
- Every accept is a write to `yakir.lock` (new fingerprints + who/when/why), so it
  shows up as a diff in the PR and is reviewed — never a silent rubber-stamp. The
  next drift is then measured against the accepted state.

One lockfile per repo (rather than per package) makes **cross-package tethers**
first-class in a monorepo — a feature, since package boundaries are exactly where
drift hides.

## 10. Logging and audit

Every automatic action — a silent re-baseline (§4 case 2), a token auto-fix, a
regeneration — emits a structured log event at a level. The default configuration
keeps the routine ones quiet; raising verbosity surfaces them. The `yakir.lock`
diff is the **permanent** audit trail regardless of log level: logs are the
ephemeral view, the lockfile is the record.

## 11. Self-integrity (meta-drift)

The inventory can itself drift — a locator points at a region that moved or
vanished. yakir re-validates every site's anchor on each run; a dangling locator
is its own finding class ("inventory integrity"), surfaced as a fixable issue. The
system watches itself, so it cannot silently rot into false confidence.

## 12. Surface: a layered stack

Each layer consumes the one below; "all of the above" is a dependency order, not
three separate products.

```
Layer 3  GitHub App / bot          later — ambient loop; cross-repo & repo-to-world
Layer 2  CLI + CI gate (ratchet)   v1 — check / scan / fix / accept / watch + yakir.lock
Layer 1  Engine (zero-dep lib)     v1 — fingerprint · staleness · BYO tier & anchor resolvers
Layer 0  yakir spec               v1 — tethers, sites, tiers, policy — serializes to JSON
```

The engine carries **zero runtime dependencies**; the AI judge and any
vendor-specific resolvers are brought by the consumer (BYO), so the core stays
small and model-agnostic. The spec is the contract every surface implements — and
the most important early artifact, because it is what lets the CLI, the App, and
third parties interoperate.

## 13. Milestones

1. **Spec + engine + token tier.** Explicit-region + structured-path anchors,
   declared door, `yakir.lock` with fix/accept. Dogfood on a real library's
   rename drift. ✅ shipped, plus the **discovered door** (value-seeded scanner).
2. **Executable tier.** ✅ shipped as a **`command` source** (output match: JSON
   path / regex capture / set-of-all-matches) and **set-valued** tethers
   (`pattern` with `all` + `allow`), reconciled by set-equality and routed
   detect-and-report. Dogfooded on StitchAPI's advertised-bundle-size drift: a
   command measures the gzip size; five docs must quote it. Type-check fences and
   link resolution are future BYO runners on this same tier.
3. **Semantic tier** (diff-aware judge, BYO model) + semantic anchors + captured
   door.
4. **CI gate hardening** — baseline ratchet, severity policy — adoptable on a repo
   that already has drift.
5. **Layer 3 App** + repo-to-world watchers.

## 14. Open questions

- **Conflict winner (§4 case 4):** human decides by default; git history only
  suggests. (Leaning settled.)
- **Manifest authoring:** typed TS that compiles to the JSON spec, a YAML/JSON
  file, or both? (See `manifest-sketch.md`.)
- **Severity policy vocabulary:** `block` / `warn` / `annotate` per tether, and how
  a CI gate maps them to exit codes.
- **Package name:** the project is *yakir*; the npm name `tether` is taken, so the
  published package needs a scope or a different name.

## 15. Prior art to situate against

Build graphs (Make, Bazel, Turborepo, Salsa) — fingerprint + staleness, the
intellectual ancestor. Snippet injectors (cog, embedme, markdown-magic). Doc tests
(doctest, Rust doctests, twoslash). Link checkers (lychee). Version/dep sync
(syncpack, changesets, release-please). Drift-against-world (Renovate, Dependabot).
Each owns one tier or one topology. yakir's wedge is the **unified inventory
across all three tiers with one staleness-and-policy model** — and the
distributed, sourceless reconciliation.
