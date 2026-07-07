## 1. Toasts

- [ ] 1.1 Reusable toast store + component (ARIA live region `polite`/`assertive`, auto-dismiss, dismissible, reduced-motion safe, AA contrast); mount in the root layout.
- [ ] 1.2 Wire success/error toasts into async actions where they read better than inline text (settings save, apply, sync start, library refresh, clear activity); keep errors actionable.
- [ ] 1.3 i18n: add any new toast/aria strings to all 5 catalogs at parity.

## 2. Skeletons

- [ ] 2.1 Skeleton components for the poster grid tile, item-detail, and settings/activity tables.
- [ ] 2.2 Show skeletons during load transitions instead of blank/spinner; ensure no layout shift.

## 3. Keyboard & focus

- [ ] 3.1 Audit + fix focus order and visible focus on the library grid, item-detail selection, and bulk actions.
- [ ] 3.2 Modals/popovers: focus trap, `Esc` to close, return focus to trigger.
- [ ] 3.3 Verify arrow/enter/space behavior on custom controls (radio cards, chips, toggles).

## 4. Verification

- [ ] 4.1 Gates: `bun run check`, `bun run test`, `bun run build`, `bun run lint`.
- [ ] 4.2 Manual a11y pass: keyboard-only walkthrough of the main flows; reduced-motion on; AA contrast check on toasts/skeletons.
