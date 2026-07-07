## 1. Settings page

- [ ] 1.1 Extract each tab into its own component (Server, Providers, Advanced, Security, Language, Activity) with explicit props/callbacks; page becomes a thin tab shell.
- [ ] 1.2 Verify no visual/behavioral/i18n change (diff the rendered pages; run existing tests + `check`).

## 2. Library page

- [ ] 2.1 Extract toolbar/filters, the grid, and the spotlight into components with clear contracts; page becomes a thin orchestrator.
- [ ] 2.2 Verify behavior-preserving (filters/sort/search/selection unchanged).

## 3. Verification

- [ ] 3.1 Gates after each page: `bun run check`, `bun run test`, `bun run build`, `bun run lint`.
- [ ] 3.2 Manual smoke of both pages to confirm identical behavior.
