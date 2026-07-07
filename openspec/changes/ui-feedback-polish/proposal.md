## Why

Async actions across the app (save, apply, sync, refresh, clear) give inconsistent feedback — some
show inline text, some nothing until the request returns. Loading states are mostly bare, and several
interactive flows aren't fully keyboard-operable. This is presentation/interaction polish: it changes
how state is communicated, not what the app does.

## What Changes

- **Toasts.** A small, accessible toast system (ARIA live region, auto-dismiss, `prefers-reduced-motion`
  honored) for transient success/error feedback on async actions, replacing ad-hoc inline strings where
  a toast reads better. Errors remain visible/actionable.
- **Skeletons.** Skeleton placeholders for the grid, item detail, and settings/activity while data
  loads, instead of blank space or a spinner, so the layout doesn't jump.
- **Keyboard navigation.** Audit the primary flows (library grid, item detail selection, bulk actions,
  modals/popovers) for focus order, visible focus, `Esc`/arrow handling, and focus trapping in overlays.

## Capabilities

### Modified Capabilities
- `web-ui`: adds requirements for accessible feedback on async actions, skeleton loading states
  without layout shift, and keyboard operability of the primary flows. Existing grid/settings/flow
  requirements are unchanged.

## Impact

- **UI:** a reusable toast component/store; skeleton components; focus/keyboard fixes across
  `library`, `item/[id]`, `settings`, and the shared `Popover`/modal components.
- **i18n:** any new toast/skeleton aria labels added to all 5 catalogs at parity.
- **A11y:** must hold WCAG AA and honor `prefers-reduced-motion` (per `.impeccable.md`).
- **No API/schema/behavior change.**
