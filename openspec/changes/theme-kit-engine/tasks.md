# theme-kit-engine — Tasks

## 1. Token foundation

- [x] 1.1 Refactor `src/app.css`: introduce semantic `--pp-*` custom properties
  (background, surface, surface-raised, text, text-muted, border, accent ramp,
  radius, font stack) on `:root` with current PosterPilot values, and expose them
  through `@theme inline` as semantic utilities (`bg-surface`, `text-text-muted`,
  `border-border`, …)
- [x] 1.2 Retarget `@layer components` classes (`.surface`, `.chip`, `.badge-*`,
  `.btn-*`, `.input`, `.release-notes`) and the body background/text and
  `:focus-visible` ring from hard-coded `neutral-*`/`accent-*` to the semantic tokens;
  keep semantic colors (emerald/amber/red) untouched
- [x] 1.3 Verify the app renders pixel-equivalent to before with no setting present
  (default = current look)

## 2. Theme-kit engine core

- [x] 2.1 Create `src/lib/theming/schema.ts`: `Theme` type, token keys, and
  `CustomizableFlags` (`accent`, `background`, `backgroundImage`, `radius`) as the
  single source of truth
- [x] 2.2 Create `src/lib/theming/presets.ts`: the 8 built-in themes as typed data
  (poster-pilot, darcula, monokai, catppuccin, white, overseerr, sonarr, terminal)
  with family, colorScheme, customizable flags, and picker swatches
- [x] 2.3 Create `src/lib/theming/resolve.ts`: pure resolver applying base theme →
  custom-theme token deltas → live overrides into the final token map, discarding
  values the base theme's flags disallow; unknown theme id falls back to posterpilot
- [x] 2.4 Unit-test the resolver (merge precedence across all three stages, lock
  enforcement, unknown-theme fallback) and assert theme-id/token parity between
  `presets.ts` and the CSS `[data-theme]` blocks

## 3. Built-in theme CSS

- [x] 3.1 Add `[data-theme='<id>']` blocks in `src/app.css` for all 8 themes,
  including `color-scheme` per theme and Terminal's monospace font stack, zero
  radius, and no translucency
- [x] 3.2 Check AA contrast for body text and controls in every theme; adjust token
  values where a theme fails (especially White and Terminal)

## 4. Settings persistence and SSR application

- [x] 4.1 Add settings keys `themeId` (accepts built-in ids and `custom:<slug>`),
  `customThemes` (JSON array, capped at 20 themes / 64 KB each),
  `themeAccentOverride`, `themeBackgroundOverride`, `themeBackgroundImage`,
  `themeBackgroundImageDim`, `themeRadiusOverride`, `navPlacement` to the
  app-settings read/write path (defaults: `posterpilot`, no overrides, `top`)
- [x] 4.2 Load appearance settings in `+layout.server.ts` and expose them to the
  layout
- [x] 4.3 Apply the resolved theme server-side in the root layout/`app.html`:
  `data-theme` on `<html>` plus inline `--pp-*` style for accepted deltas and
  overrides — for custom themes, `data-theme` points at the base and the theme's
  token deltas are emitted inline; first paint matches the saved appearance with no
  flash
- [x] 4.4 Create `src/lib/theming/apply.client.ts`: client-side applier (same
  attribute/inline writes) used by the Settings UI for instant switching
- [x] 4.5 Render the background image layer (`body::before`, cover/fixed, with the
  theme-background dim overlay at `themeBackgroundImageDim` opacity) only when the
  active theme allows background images and one is set; validate image URLs as
  http/https

## 5. Appearance settings UI

- [x] 5.1 Add an Appearance section to the settings page: theme picker grouped by
  family (base/extreme, plus a custom group when custom themes exist) with live
  swatch previews that apply instantly on select
- [x] 5.2 Add override controls driven by the active theme's `customizable` flags:
  native color inputs for accent and background (curated phosphor swatches for
  Terminal), a radius slider/select, a background-image URL input with dim slider,
  and per-override reset buttons; locked properties show no control
- [x] 5.3 Add "Save current appearance as theme…" authoring dialog: name (required),
  author, URL, version, description; captures accepted overrides as token deltas;
  support edit and delete of custom themes (delete of the active one falls back to
  its base)
- [x] 5.4 Add export (downloads `.posterpilot-theme.json` for a custom theme or the
  current appearance) and import (file picker → validate → register + apply, with
  specific error messages on rejection)
- [x] 5.5 Create `src/lib/theming/theme-file.ts`: pure serializer/parser with the
  allowlist validator (format/formatVersion, known base, known token keys, per-key
  value grammars, metadata caps) — no new dependency
- [x] 5.6 Unit-test the theme-file round-trip and rejection cases (malformed,
  unknown base, unknown keys, CSS-injection values, unsupported formatVersion)
- [x] 5.7 Add navigation placement selector (top bar / left sidebar)
- [x] 5.8 Wire persistence through the existing settings API, mirroring the locale
  strategy pattern

## 6. Navigation placement

- [x] 6.1 Implement left-sidebar layout variant in `+layout.svelte` for desktop
  (`lg:` breakpoint and up) rendering the same `links` array vertically, with content
  offset; keep top bar + hamburger for mobile in both modes
- [x] 6.2 Verify active-route highlighting, server switcher, language selector,
  logout, and banner rows work in both placements
- [x] 6.3 Theme-forced chrome layout: themes may declare `layout: 'sidebar'`
  (Overseerr) which wins over the nav-placement setting via the resolver; seerr-style
  active pill and version chip in sidebar mode; seerr gray/indigo palette
- [x] 6.4 Chrome tokens (`--pp-chrome`, `--pp-chrome-border`, fallback to
  background/border) so extreme themes restyle the top bar/sidebar itself (seerr
  darker sidebar, \*arr near-black navbar); Sonarr/Radarr also forces the sidebar

## 6b. Custom CSS

- [x] 6b.1 `customCss` setting (16 KB cap, `</style>` rejected), SSR-injected as the
  last stylesheet in `<head>`; custom themes carry an optional `css` field captured
  at authoring, validated on import, applied before the user's own customCss
- [x] 6b.2 Appearance UI textarea with instant client-side application (upserts the
  injected style element) and persistence; i18n in all 6 catalogs

## 7. i18n and docs

- [x] 7.1 Add all new Appearance strings to all 6 `messages/*.json` catalogs
  (en, es, fr, ja, pt-BR, zh); theme names stay as proper nouns
- [x] 7.2 Update `.impeccable.md` (dark-only becomes default-only; theming
  conventions) and keep `AGENTS.md`/`CLAUDE.md` in sync

## 8. Verification

- [x] 8.1 Component tests for the Appearance settings section (theme selection,
  override reset) following the project's `vitest-browser-svelte` conventions
- [x] 8.2 Run quality gates: `bun run check` (0 errors), `bun run test`,
  `bun run build`, `bun run lint`, and `bun run fallow`
- [x] 8.3 Manual smoke: switch each theme, reload (no flash), toggle sidebar
  placement, verify reduced-motion behavior unchanged
