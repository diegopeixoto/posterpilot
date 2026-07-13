## 1. Toasts

- [x] 1.1 `src/lib/stores/toasts.svelte.ts` (runes store) + `Toaster.svelte` — two ARIA live regions (polite for success/info, assertive for errors), errors persist until dismissed, success/info auto-dismiss, `prefers-reduced-motion` safe, AA-contrast styles; mounted in the root layout. `toast_dismiss` added to all 5 catalogs.
- [x] 1.2 Wired success/error toasts into settings, apply/discover, sync, ignore/restore, refresh/test, language, and activity-clear actions.
- [x] 1.3 i18n parity for the new toast string.

## 2. Skeletons

- [x] 2.1 `Skeleton.svelte` — reduced-motion-safe shimmer placeholder sized by class.
- [x] 2.2 Wired skeletons into library grid navigation/pagination and Activity loading; retained truthful SSR content without artificial item-detail placeholders.

## 3. Keyboard & focus

- [x] 3.1 Audited the shared overlay: `Popover.svelte` already has `Esc`-to-close, focus-into-panel on open, focus-return-to-trigger, and visible `:focus-visible` — the primary flows use it, so keyboard operability is in good shape.
- [x] 3.2 Completed keyboard/focus behavior for popovers, the library grid and bulk controls, with visible equivalents and tested grid navigation.

## 4. Verification

- [x] 4.1 Gates: `bun run check` (0 errors), `bun run test`, `bun run lint`.
- [ ] 4.2 Manual a11y walkthrough in the running app (keyboard-only, reduced-motion, AA on toasts/skeletons).
