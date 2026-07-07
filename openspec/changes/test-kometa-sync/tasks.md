## 1. Testability seams

- [ ] 1.1 Identify the pure logic in `kometa/sync` (merge, snapshot/diff, YAML round-trip) entangled with `$env`/fs; extract into `$env`-free modules where needed (behavior-preserving).

## 2. Tests

- [ ] 2.1 Merge tests: `merge` mode preserves unmanaged keys + comments and updates only managed sections; `own` mode regenerates fully.
- [ ] 2.2 Snapshot/diff tests: removals computed correctly against the last-applied snapshot.
- [ ] 2.3 YAML round-trip tests over representative fixtures (comments, anchors, nested collections).
- [ ] 2.4 Backup/atomic-write behavior asserted at the thin orchestration layer (as feasible without a real fs, or with a temp dir).

## 3. Verification

- [ ] 3.1 Gates: `bun run check`, `bun run test`, `bun run build`, `bun run lint`; new tests green and meaningfully cover the merge/diff paths.
