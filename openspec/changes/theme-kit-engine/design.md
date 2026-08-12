# theme-kit-engine — Design

## Context

PosterPilot's entire look lives in `src/app.css`: Tailwind v4 `@theme` tokens for the
accent ramp, plus a `@layer components` block (`.surface`, `.chip`, `.badge-*`,
`.btn-*`, `.input`) that hard-codes `neutral-*` and `accent-*` utilities. Body
background/text are hard-coded hex, `.impeccable.md` declares the app **dark-only**,
and the root layout renders a sticky top header with no sidebar variant. Settings
persist via the existing app-settings store, delivered to the layout through
`+layout.server.ts`.

The constraint that makes this non-trivial: colors are scattered across Tailwind
utility classes in dozens of `.svelte` files. The engine must work without rewriting
every component — so the seam is a semantic token layer, not per-component theme logic.

## Goals / Non-Goals

**Goals:**

- A theme-kit engine: **themes as data**, one resolver, one applier. Built-in themes,
  user overrides, and future user-authored themes all go through the same pipeline.
- 8 built-in themes: PosterPilot (default), Darcula, Monokai, Catppuccin Mocha,
  White, Overseerr, Sonarr/Radarr, Terminal.
- Capability-gated customization: each theme declares which overrides it accepts
  (accent, background, background image + dim, radius); locked properties are
  un-overridable, enforced in both UI and resolver.
- No flash of wrong theme (SSR-applied), instant client-side switching, no new
  runtime dependencies.
- WCAG AA text contrast in every shipped theme; `prefers-reduced-motion` unchanged.
- Navigation placement: top (default) or left sidebar.

**Non-Goals:**

- A full free-form token editor (authoring captures the current overrides + metadata;
  it is not a CSS editor).
- Per-user themes (instance-wide setting, like locale).
- A remote theme gallery or community sharing hub (import/export is file-based).
- Re-theming artwork imagery; Catppuccin flavors beyond Mocha.

## Decisions

### 1. Engine architecture: schema → resolver → applier

New module `src/lib/theming/`:

```
presets.ts    — built-in theme data (typed Theme objects)
schema.ts     — Theme type + token keys + CustomizableFlags (single source of truth)
resolve.ts    — resolve(theme, overrides) → ResolvedTheme (pure, unit-testable)
apply.client.ts — client-side applier (sets data-theme + inline vars, used by Settings)
```

```ts
type CustomizableFlags = { accent: boolean; background: boolean; backgroundImage: boolean; radius: boolean };
type Theme = {
  id: string; name: string; family: 'base' | 'extreme';
  colorScheme: 'dark' | 'light';
  customizable: CustomizableFlags;
  tokens: Record<TokenKey, string>;   // background, surface, surface-raised, text,
                                      // text-muted, border, accent ramp, radius, font, effects
  swatches: string[];                  // for the settings picker
};
```

`resolve()` is pure: given a theme and the stored overrides, it returns the final
token map, **dropping any override the theme's `customizable` flags disallow** — so
lock enforcement lives in exactly one place and is unit-testable.

### 2. CSS: semantic `--pp-*` tokens via Tailwind `@theme inline`

- `app.css` defines `--pp-*` custom properties on `:root` (PosterPilot values) and
  redefines them under `[data-theme='<id>']` blocks per built-in theme. Exposed to
  utilities via `@theme inline` (`bg-surface`, `text-text-muted`, `border-border`,
  accent ramp, `rounded`-radius var, font var).
- `@layer components` classes retarget from hard-coded `neutral-*`/`accent-*` to the
  semantic tokens. Semantic colors (emerald/amber/red) stay — meaning, not theme.
- Built-in themes' token values live in CSS (`[data-theme]` blocks); `presets.ts`
  carries the same data for the picker/resolver. A unit test asserts id parity and
  full token coverage between the two.
- **Why not a build-time multi-theme Tailwind setup:** zero deps, instant switching,
  SSR-friendly; user overrides are just more `--pp-*` values in the same cascade.
- Raw `neutral-*` in page components keeps working but won't follow themes; the
  refactor covers shared chrome and sets the convention. Full page sweep is a
  stretch task.

### 3. Overrides: capability-gated, SSR-applied

- Settings keys: `themeId` (default `'posterpilot'`), `themeAccentOverride`,
  `themeBackgroundOverride`, `themeBackgroundImage` (validated http/https URL),
  `themeBackgroundImageDim` (0–1), `themeRadiusOverride`, `navPlacement`.
- **Server applier:** `+layout.server.ts` loads settings; the layout resolves the
  theme and emits `data-theme` + inline `style="--pp-accent-600: …"` on `<html>` in
  SSR — first paint matches, no flash.
- **Client applier:** Settings changes apply instantly (same attribute/inline write)
  and persist through the settings API, mirroring the locale strategy.

Suggested lock matrix:

| Theme | accent | background | bg image | radius |
|---|---|---|---|---|
| PosterPilot | ✅ | ✅ | ✅ | ✅ |
| Darcula / Monokai / Catppuccin | ✅ | ✅ | ✅ | ✅ |
| White | ✅ | ❌ (light identity) | ❌ | ✅ |
| Overseerr | ✅ | ✅ | ✅ | ✅ |
| Sonarr/Radarr | ✅ (cyan ↔ amber) | ✅ | ✅ | ✅ |
| Terminal | ✅ (green/amber/white phosphor) | ❌ | ❌ | ❌ |

### 4. Background image layer

`themeBackgroundImage` sets `--pp-background-image` on `<html>`; `body::before`
paints it `cover`/fixed beneath the chrome with a `color-mix` overlay of the theme
background at `themeBackgroundImageDim` opacity. Translucent surfaces make the image
visible; themes that lock the background never emit the layer (enforced by
`resolve()`).

### 5. Custom themes extend a built-in base

A user-authored theme is **not** a full token set — it's `{ base: <built-in id>,
tokens: <partial overrides>, meta }`. Resolution: apply the base theme's tokens, then
the custom theme's token overrides, then the user's live overrides (each stage
capability-checked against the base). This guarantees every custom theme has a
complete, valid token set for free and keeps validation surface small.

- **Storage:** new settings key `customThemes` (JSON array, capped at 20 themes /
  64 KB each), plus `themeId` accepting `custom:<slug>` ids.
- **Application:** built-in themes ride `[data-theme]` CSS blocks; custom themes
  can't (they're runtime data) — the SSR applier sets `data-theme` to the **base**
  and emits the custom theme's token deltas inline, same mechanism as overrides.
  One cascade, no special casing downstream.
- **Authoring UI:** "Save current appearance as theme…" dialog in Appearance —
  name (required), author, URL, version (semver-ish string), description. Captures
  the current accepted overrides as the theme's token deltas. Edit = load, tweak
  overrides, save. Delete removes the theme (falling back to its base if active).

### 6. Theme file format + import validation

Theme files are JSON, extension `.posterpilot-theme.json`:

```json
{
  "format": "posterpilot-theme",
  "formatVersion": 1,
  "theme": {
    "name": "...", "author": "...", "url": "...", "version": "...",
    "description": "...", "base": "posterpilot",
    "tokens": { "accent-600": "#7c3aed", "...": "..." }
  }
}
```

- **Export** serializes any custom theme (or the current appearance, wrapped as one)
  to this format. **Import** registers the file as a custom theme and selects it.
- **Validation is the feature.** A pure, hand-rolled validator (no new dep)
  unit-tested to death: `format`/`formatVersion` exact match; `base` must be a
  registered built-in; token keys must be known token names; token values must match
  per-key grammars (hex/rgb/hsl color, length, or — for `background-image` only — an
  http/https URL; **no `url()`, expressions, or arbitrary CSS anywhere else**);
  metadata strings length-capped and control-character-stripped. Reject with a
  specific error, never partially apply.
- **`formatVersion`** lets v2 add fields without breaking old installs: unknown
  versions are rejected with "theme file requires a newer PosterPilot".
- **Why hand-rolled over zod:** the grammar is small and security-critical; an
  explicit allowlist per token key beats a generic schema for CSS values. No new
  dependency.

### 7. Custom CSS (escape hatch + theme-shipped CSS)

Two layers, one rule: free-form CSS is allowed because the instance is
self-hosted and single-user — validated only for size (16 KB cap) and the one
real breakout vector (`</style>`); invalid CSS is ignored by the browser.

- **User customCss** (instance setting): injected verbatim as the last
  stylesheet in `<head>`, winning the cascade over any theme.
- **Theme-shipped CSS**: custom themes carry an optional `css` field, captured
  from the current customCss at authoring time and included in theme export
  files — a shared theme reproduces its look exactly. Applied while the theme
  is active, injected before the user's customCss.

### 8. Navigation placement

`navPlacement = 'left'` swaps the sticky header for a fixed left sidebar on desktop
(`lg:` up) rendering the same `links` array vertically; mobile always uses top bar +
hamburger. **Extreme themes can force the chrome layout** (Winamp-skin style): a
theme declaring `layout: 'sidebar'` (Overseerr, Sonarr/Radarr) wins over the user's setting — the
resolver computes the effective placement, so SSR, the settings UI, and the layout
all agree. Sidebar mode also takes a seerr-style active pill (solid accent) and a
version chip at the bottom. Optional `--pp-chrome`/`--pp-chrome-border` tokens (fallback: background/border) let extreme themes restyle the top bar/sidebar itself — seerr's darker sidebar, the \*arr near-black navbar.

### 9. i18n

All Appearance strings added to all 6 `messages/*.json` catalogs; theme names remain
proper nouns.

## Risks / Trade-offs

- [CSS injection via imported theme files] → Allowlist validator per token key
  (decision 6); tokens are emitted as inline custom properties, never interpolated
  into a stylesheet; background-image URLs restricted to http/https.
- [Theme data duplicated between `presets.ts` and CSS `[data-theme]` blocks] →
  Parity unit test; long-term option is generating the CSS blocks from the TS data.
- [Raw `neutral-*` utilities in pages leak the old palette] → Retarget shared chrome
  now, document convention, follow-up sweep; built-in dark themes tolerate strays.
- [White theme + translucent surfaces may fail AA] → Per-theme surface/border tokens;
  verify contrast per theme, adjust as needed.
- [Terminal theme fights component assumptions (blur, radius, font)] → Intentionally
  extreme; special-casing lives in tokens (radius/font/backdrop vars), never in
  per-theme component branches.
- [`.impeccable.md` says dark-only] → Update it: dark stays the default; the design
  principles govern the default theme; other themes are user opt-outs.

## Migration Plan

Pure additive; existing installs get `posterpilot` defaults and see no visual change.
Rollback = revert PR; unknown settings keys are ignored by older builds.

## Open Questions

- Sonarr/Radarr default accent: lean Sonarr cyan with amber as the in-picker
  alternative; confirm against the real apps at implementation time.
- Terminal accent control: curated phosphor swatches (green/amber/white) vs free
  color input — lean curated, it preserves the TUI identity.
- Whether `[data-theme]` CSS should be generated from `presets.ts` in a later
  refactor to end the duplication.
