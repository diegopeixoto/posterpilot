## Why

A few page components have grown large enough to be hard to read, review, and change safely —
`settings/+page.svelte` (~900+ lines, multiple tabs of state and handlers) and `library/+page.svelte`
(~700 lines) are the worst. The plan flagged decomposing them. Splitting each tab/section into its own
component with a clear prop/event contract shrinks the surface a reviewer holds in their head and makes
future feature work (and the other follow-ups) lower-risk.

## What Changes

- Decompose the monolithic pages into focused child components — one per Settings tab
  (Server, Providers, Advanced, Security, Language, Activity) and per library concern (toolbar/filters,
  grid, spotlight) — with explicit props and callbacks, keeping the page as a thin orchestrator.
- **Strictly behavior-preserving:** no visual, behavioral, or i18n change; purely internal structure.
- Do it **incrementally, one page at a time** (settings first, then library), each its own reviewable
  step, to keep risk low.

## Capabilities

### New Capabilities
- `code-quality`: adds a maintainability requirement that large pages be composed of focused
  subcomponents rather than monolithic files, behavior-preserving. No `web-ui` requirement changes.

## Impact

- **UI:** new child components under `src/routes/settings/` and `src/routes/library/` (or
  `$lib/components/settings/*`); the page files become thin shells.
- **Risk:** medium — large diffs in hot files. Mitigated by doing it per-page and leaning on the
  existing tests + type-checker; ideally sequenced **after** `add-eslint` so the linter guards the split.
- **No API/schema/behavior/i18n change.**
- **Decision for design:** component boundaries + where shared state lives (page-level store vs props),
  and whether to co-locate components with the route or under `$lib/components/`.
