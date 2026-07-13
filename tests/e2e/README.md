# PosterPilot browser E2E suite

This is a real Playwright suite against PosterPilot, not a component mock. Its web-server harness:

- starts the SvelteKit application on an isolated port;
- creates a run-specific SQLite database and data directory under the operating-system temp folder;
- starts local Jellyfin- and Plex-compatible HTTP fakes that implement the provider contracts used by setup, sync, artwork reads/writes, verification, undo, native collections, and Kometa binding;
- gives every invocation a unique runtime/artifact namespace, including concurrent runs;
- gracefully removes the database, application data, one-time metadata, and fake servers when Playwright stops.

The tests deliberately use the public UI and production API surface. The only direct database fixture runs **after** setup, sync, and full rescan have imported real fake-server records. It adds deterministic TMDB metadata, candidate evidence, and collection membership to that throwaway database because TMDB/provider internet calls must not be part of a repeatable browser test. No test-only route or production backdoor is added.

## Coverage and ordering

The Playwright projects form a dependency chain so mutable workflows stay deterministic:

1. `bootstrap`: setup, Jellyfin login, first sync, incremental sync, full rescan;
2. `product-flows`: review/navigation, manual-match validation plus real pin clearing/audit, exact apply/verification/undo, all FUN experiments, review-only automation/webhook, backup lifecycle, and coordinated collection apply/undo with unavailable-member context;
3. `multi-server-kometa`: named Plex connection, active-server isolation in both directions, structured Kometa preview/confirm, raw preview/confirm and backup;
4. `authentication`: enable, API/page guard, invalid and valid login, redirect preservation, safe disable.

## Run

Install Chromium once for the pinned Playwright version:

```sh
bunx playwright install chromium
```

Then run the suite:

```sh
bun run test:e2e
```

Useful focused commands:

```sh
bun run test:e2e -- --project product-flows
bun run test:e2e -- --ui
```

Dependent projects automatically run their prerequisites. Runtime metadata, reports, and traces are
namespaced by the application port and a per-run identifier so independent runs cannot share state;
all artifacts stay in ignored `tests/e2e/`, `playwright-report/`, and `test-results/` paths.
