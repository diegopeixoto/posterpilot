# Design: docs-footer-aquarela-credit

## Context

`docs/src/components/Footer.astro` wraps Starlight's default footer via the
`components.Footer` override in `docs/astro.config.mjs` (already wired; a fallow
dead-code scan flags the file as unused only because the reference is a string path,
not an import). It already renders the trademark disclaimer and a `.pp-credits` row:
copyright link → `github.com/diegopeixoto`, live star-count link, and
`v{version}` → releases, with the version imported from the root `package.json`.
The only missing piece from the original ask is the Aquarela (aquarela.io) credit.
Docs build on astro 7.1.3 + starlight 0.40 (verified green when PR #39 merged).

## Goals / Non-Goals

**Goals:**
- Add an Aquarela credit link to the existing credits row, every page and locale.
- Keep the footer's existing structure, styling system, and behavior untouched.
- Lock the whole credits behavior into the `documentation` spec.

**Goals (added in revision):**
- Mirror the credits in the app footer (`src/routes/+layout.svelte`), which already
  shows the project link, `v{data.version}`, and the localized disclaimer.

**Non-Goals:**
- No localization of the **docs** credit row — it stays locale-invariant English
  like the rest of the docs credits. The **app** label does localize (revised):
  `footer_aquarela` is added to all five catalogs since the chosen wording
  ("An app from Aquarela") is a sentence, not a proper noun.
- No redesign of either footer, no new dependencies, no analytics on the links.

## Decisions

- **Extend the existing `.pp-credits` row** with a fourth entry,
  `·`-separated like the others: `<a href="https://aquarela.io" ...>Made by Aquarela</a>`.
  Alternative — a separate line or logo image — rejected: heavier than the
  established quiet-credits pattern and would need per-theme assets.
- **Wording `An app from Aquarela`** — maintainer's chosen phrasing (revised from
  the initial `Made by Aquarela`). In the app it is rendered through a new
  `footer_aquarela` i18n key so the phrase localizes with the rest of the footer.
- **`rel="noopener external"` + `target` omitted** — same-tab navigation matches the
  other credit links; `noopener` guards the external origin. Alternative
  `target="_blank"` rejected: the existing credit links don't do it, and surprise
  new tabs are an accessibility annoyance.
- **No new i18n plumbing** — Starlight UI translations would let the label vary per
  locale, but the credits row (names, version, star count) is deliberately
  locale-invariant today; keeping it that way avoids five catalog touches for a
  proper noun.

## Risks / Trade-offs

- [Fallow keeps flagging Footer.astro as unused] → Known false positive (string-path
  reference); do not "clean it up". The spec delta now documents the footer's
  required behavior as a second guard.
- [English-only label on non-English locales] → Accepted; consistent with the rest
  of the credits row. Revisit only if the docs later localize the disclaimer too.

## Migration Plan

Single additive edit to `Footer.astro`; deploys with the next docs build. Rollback =
revert the commit.

## Open Questions

None.
