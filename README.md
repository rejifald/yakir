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

Pre-implementation. This repo currently holds the design. The v1 engine — token
tier, CLI, and `tether.lock` — is the next step, to be dogfooded on a real
library's drift.
