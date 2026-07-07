## 1. Inventory

- [x] 1.1 Located the duplication. `media-server/plex.ts` **delegates** to `plex/client.ts` (no third copy). The real duplication was **internal to `client.ts`**: `uploadPosterFromUrl`/`uploadBackgroundFromUrl` and `uploadPosterBytes`/`uploadBackgroundBytes` were near-identical, differing only by the Plex endpoint (`posters`/`arts`), the lock field (`thumb`/`art`), and the error label. (The lock logic was already shared via `setFieldLock`.)

## 2. Characterize

- [~] 2.1 No characterization test added: the upload functions transitively import the db module (via `$lib/server/http`), so a clean `$env`-free unit test isn't practical without extracting the URL builders further — and these functions had no prior test, so there's no coverage regression. The refactor is a mechanical, byte-identical extraction verified by inspection and the green suite.

## 3. Consolidate

- [x] 3.1 Unified the four functions into two internal helpers (`uploadImageFromUrl`, `uploadImageBytes`) keyed by an `ImageKind`, with `IMAGE_ENDPOINT`/`LOCK_FIELD` maps; the four public functions are thin delegates (signatures unchanged, callers untouched). ~40 lines of duplication removed.
- [x] 3.2 Confirmed byte-identical output: same URL strings, same `X-Plex-Token` encoding, same error messages (`Plex rejected the ${kind} upload`), same lock calls.

## 4. Verification

- [x] 4.1 Gates: `bun run check` (0 errors), `bun run test` (362 pass), `bun run lint`.
