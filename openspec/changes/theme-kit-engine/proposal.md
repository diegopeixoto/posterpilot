# theme-kit-engine

## Why

PosterPilot is dark-only with a single violet accent — a deliberate look, but
homelabbers live in themed ecosystems (\*arr apps, Overseerr/Jellyseerr, terminal
dashboards) and expect their tools to match. Bolting on individual themes one at a
time doesn't scale: what's needed is a **theme-kit engine** — themes as data, one
resolution pipeline, one application path — so built-in presets, per-preset
customization, and eventually user-authored themes all ride the same machinery.

## What Changes

- Build a **theme-kit engine** with three parts:
  - **Theme schema & registry** (`src/lib/theming/`): a theme is a typed data object —
    token set (background, surfaces, text, borders, accent ramp, radius, font,
    effects), `colorScheme`, and a `customizable` capability descriptor declaring
    which overrides it accepts.
  - **Resolver**: merges the selected theme with capability-gated user overrides
    (accent color, background color, background image + dim, radius) into a final
    resolved token map. Locked properties can never be overridden.
  - **Applier**: SSR-side emission of `data-theme` + inline custom properties on
    `<html>` (no flash), client-side instant re-application on change.
- Refactor `src/app.css` into a **semantic token layer** (`--pp-*` custom properties
  exposed through Tailwind v4 `@theme inline`) that all shared component classes
  consume; themes are `[data-theme]` blocks that only redefine tokens.
- Ship **8 built-in themes** on the engine, in two families:
  - **Base:** PosterPilot (current look, default), Darcula, Monokai,
    Catppuccin Mocha, White (first light theme).
  - **Extreme:** Overseerr, Sonarr/Radarr, Terminal (TUI-style: monospace, zero
    radius, phosphor palette).
- Add an **Appearance** section in Settings: theme picker with live preview, override
  controls filtered by the active theme's `customizable` flags, background-image URL
  with dim control, and navigation placement (top bar / left sidebar).
- Persist appearance choices in the app settings store; apply them server-side so the
  first paint matches.
- Add **theme authoring**: "save current appearance as a custom theme" — name,
  author, URL, version, description — captured as a custom theme that extends a
  built-in base with the user's token overrides. Custom themes register in the engine
  alongside built-ins and are selectable, editable, and deletable in Appearance.
- Add **theme import/export**: custom themes serialize to a versioned JSON theme file
  (with author/url/version metadata) and import back through strict schema
  validation — backup, restore, and sharing themes across instances.
- The engine is the point: built-in themes, user overrides, and user-authored themes
  all ride the same schema → resolver → applier pipeline.
- Update `.impeccable.md`: dark-only becomes the default, not a constraint.

## Capabilities

### New Capabilities

- `theming`: the theme-kit engine (schema, registry, resolver, applier), built-in
  themes, per-theme customization including background images, custom theme authoring
  with metadata, theme import/export, navigation placement, persistence, and SSR
  application.

### Modified Capabilities

<!-- No existing spec-level requirements change; theming is additive. -->

## Impact

- **Code:** new `src/lib/theming/` engine module, `src/app.css` (token refactor),
  `src/routes/+layout.svelte` / `+layout.server.ts` / `app.html` (applier, nav
  placement), settings page + settings API, i18n catalogs (6 languages at parity).
- **Data:** new keys in the app settings store (theme id, overrides, nav placement).
  No schema migration.
- **Design docs:** `.impeccable.md` and `AGENTS.md`/`CLAUDE.md` design-context notes.
- **Dependencies:** none new — CSS custom properties + existing settings plumbing.
