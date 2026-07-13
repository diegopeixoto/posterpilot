## 1. Settings page

- [x] 1.1 Extracted the **Security** tab into `$lib/components/settings/SecuritySettings.svelte` (self-contained, takes an `auth` prop, owns its own form state) — ~90 lines out of the page. Establishes the `components/settings/` pattern.
- [x] 1.2 Extracted the remaining Server, Providers, Advanced, Language, and Activity tabs into focused components while preserving the shared page orchestration.
- [x] 1.3 Verified behavior-preserving: `check`/`test`/`lint` green; the Security tab renders and saves identically.

## 2. Library page

- [x] 2.1 Extracted the **spotlight** banner into `$lib/components/library/LibrarySpotlight.svelte` (takes a `spotlight` prop). Establishes the `components/library/` pattern.
- [x] 2.2 Extracted the toolbar/filters and keyboard-operable grid (including selection and ignore overlay behavior) into focused library components.
- [x] 2.3 Verified behavior-preserving.

## 3. Verification

- [x] 3.1 Gates after each extraction: `bun run check` (0 errors), `bun run test`, `bun run lint` — all green.
- [ ] 3.2 Manual smoke of both pages in the running app (identical behavior).
