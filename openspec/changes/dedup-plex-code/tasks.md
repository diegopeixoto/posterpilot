## 1. Inventory

- [ ] 1.1 Locate the duplicated Plex blocks precisely (auth/header construction, poster/image URL building, response parsing, section listing) across `plex/` and `media-server/`; record the exact sites.

## 2. Characterize

- [ ] 2.1 Ensure the duplicated behavior is covered by tests; add characterization tests for any uncovered path before refactoring.

## 3. Consolidate

- [ ] 3.1 Unify each duplicated block into a single shared implementation; update callers.
- [ ] 3.2 Confirm identical requests/results (byte-for-byte URLs, same parsed output).

## 4. Verification

- [ ] 4.1 Gates: `bun run check`, `bun run test`, `bun run build`, `bun run lint`; all Plex tests green.
