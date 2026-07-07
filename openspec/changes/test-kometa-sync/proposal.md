## Why

The Kometa config-sync path (`src/lib/server/kometa/`) is one of the more intricate features —
surgical `config.yml` merge, atomic write + backup, snapshot/diff for removals — and the plan flagged
it as under-tested. It's exactly the kind of code where a regression corrupts a user's real Kometa
config. Adding focused tests closes that gap and locks the current behavior before future changes.

## What Changes

- Add unit tests for the pure/deterministic parts of `kometa/sync` — the merge (managed keys preserved,
  unmanaged keys and comments untouched in `merge` mode; full regenerate in `own` mode), the
  snapshot/diff that computes removals, and the YAML round-trip.
- Where logic is entangled with `$env`/filesystem, extract the pure core into its own module (the
  project's established `$env`-free testing convention) and test that; keep the atomic-write/backup
  orchestration thin.

## Capabilities

### New Capabilities
- `code-quality`: adds a coverage requirement for the Kometa config-sync merge/diff/round-trip logic
  (shared with the other quality follow-ups). No product-behavior requirement changes.

## Impact

- **Tests:** new `*.test.ts` alongside the extracted pure modules under `src/lib/server/kometa/`.
- **Code:** possible small refactor to separate pure merge/diff logic from `$env`/fs side effects.
- **No behavior change** — tests assert the current contract; any refactor is behavior-preserving.
- **Decision for design:** which seams to extract, and the fixture set (representative real-world
  `config.yml` shapes: comments, anchors, nested collections).
