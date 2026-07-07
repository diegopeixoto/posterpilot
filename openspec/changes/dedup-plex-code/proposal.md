## Why

The plan flagged duplicated Plex code. Duplication in the media-server layer means a fix or a
protocol quirk has to be handled in two places and can drift. Consolidating it into one path reduces
the chance of the two copies diverging and shrinks the surface for the media-server work generally.

## What Changes

- Identify the duplicated Plex logic (candidate areas: request/auth header construction, poster/image
  URL building, XML/JSON response parsing, section/library listing) across `src/lib/server/plex/` and
  the `media-server/` abstraction, and unify it into a single shared implementation.
- **Behavior-preserving:** the consolidated path must produce identical requests/results; existing
  Plex tests (and any added to pin behavior first) stay green.

## Capabilities

### New Capabilities
- `code-quality`: adds a requirement that the Plex integration logic have a single shared
  implementation (no duplicated request/URL/parse blocks), behavior-preserving. No
  `plex-integration`/`media-server` requirement changes.

## Impact

- **Code:** consolidation within `src/lib/server/plex/` and `src/lib/server/media-server/`; callers
  updated to the single path.
- **Tests:** pin current behavior with tests first (characterization) if the duplicated paths aren't
  already covered, then refactor against them.
- **Risk:** low-medium — touches the most battle-tested integration. Sequence **after** `add-eslint`
  and ideally after `test-kometa-sync`/characterization tests exist.
- **Decision for design:** an inventory of the actual duplicated blocks (this proposal names candidates;
  implementation starts by locating them precisely) and the shared module's shape.
