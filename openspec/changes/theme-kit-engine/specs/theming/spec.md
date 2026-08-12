# theming Specification

## Purpose

Define the theme-kit engine: themes as data (token sets plus capability descriptors),
a single resolution pipeline that merges a theme with user overrides, and a single
application path (SSR + client) — so built-in themes, per-theme customization, and
future user-authored themes all ride the same machinery. Also defines the built-in
theme set, background-image support, and navigation placement, persisted
instance-wide and applied without a flash of unthemed content.

## ADDED Requirements

### Requirement: Theme-kit engine

The system SHALL provide a theme engine in which every theme is a data object
consisting of a complete token set (background, surfaces, text, muted text, borders,
accent ramp, corner radius, font treatment), a `colorScheme`, and a capability
descriptor declaring which overrides the theme accepts. A single resolver SHALL merge
the selected theme with the user's stored overrides into the final applied
appearance, discarding any override the theme does not accept. Built-in themes, user
overrides, and user-authored custom themes SHALL all go through this resolver and the
same application path.

#### Scenario: Resolution merges theme and overrides

- **WHEN** a theme is selected and the user has stored overrides the theme accepts
- **THEN** the applied appearance is the theme's tokens with the accepted overrides
  merged in

#### Scenario: Resolver discards unaccepted overrides

- **WHEN** stored overrides include properties the selected theme does not accept
- **THEN** those overrides are discarded by the resolver and the theme's own values
  apply

#### Scenario: Unknown theme falls back to default

- **WHEN** the stored theme id does not match any registered theme
- **THEN** the PosterPilot default theme applies

### Requirement: Built-in themes

The system SHALL ship built-in themes registered in the engine and selectable from an
Appearance section in Settings: PosterPilot (default), Darcula, Monokai, Catppuccin
Mocha, White, Overseerr, Sonarr/Radarr, and Terminal. The PosterPilot theme SHALL
reproduce the current default look exactly.

#### Scenario: Selecting a preset

- **WHEN** the user selects a preset in the Appearance settings
- **THEN** the whole app chrome re-renders in that preset immediately, and the choice
  is persisted

#### Scenario: Default appearance for existing installs

- **WHEN** an existing installation loads without any theme setting
- **THEN** the PosterPilot preset applies and the UI looks unchanged from before

#### Scenario: Light preset

- **WHEN** the White preset is active
- **THEN** the app renders with a light background, dark text, and
  `color-scheme: light`, with body text and controls maintaining WCAG AA contrast

#### Scenario: Terminal preset

- **WHEN** the Terminal preset is active
- **THEN** the app renders in a TUI style: monospace type, sharp (zero-radius)
  corners, and a monochrome terminal palette

### Requirement: Per-preset customization

Each preset SHALL declare which customizations it supports: accent color, background
color, background image, and corner radius. The Appearance settings SHALL show only
the controls the active preset supports, and overrides SHALL NOT apply to properties
a preset locks (a preset's locked properties define its identity — e.g. Terminal's
monospace font and zero radius). Overrides SHALL apply on top of the selected preset,
SHALL be resettable back to preset defaults, and SHALL survive switching presets
(re-applying wherever the new preset supports them).

#### Scenario: Override accent color

- **WHEN** the user picks a custom accent color on a preset that allows it
- **THEN** primary actions, active states, and focus rings use that color across the app

#### Scenario: Locked property not customizable

- **WHEN** the active preset locks a property (e.g. Terminal's corner radius)
- **THEN** the Appearance UI shows no control for that property and the preset's own
  value always applies

#### Scenario: Reset overrides

- **WHEN** the user resets an override
- **THEN** the affected property returns to the active preset's value

#### Scenario: Overrides survive preset switch

- **WHEN** the user has set overrides and switches to a different preset
- **THEN** the overrides remain stored and apply wherever the new preset supports them

### Requirement: Custom theme authoring

The system SHALL let the user save the current appearance as a named custom theme
that extends a built-in base theme. Authoring SHALL capture metadata — name
(required), author, URL, version, and description — and the current accepted
overrides as the theme's token deltas. Custom themes SHALL appear in the theme picker
alongside built-ins, and SHALL be selectable, editable, and deletable. Deleting the
active custom theme SHALL fall back to its base theme.

#### Scenario: Save current appearance as a theme

- **WHEN** the user saves the current appearance as a custom theme with a name and
  optional author, URL, version, and description
- **THEN** the theme is stored, appears in the picker with its metadata, and applies
  its base plus token deltas when selected

#### Scenario: Custom theme extends a base

- **WHEN** a custom theme is applied
- **THEN** tokens it does not override come from its base theme

#### Scenario: Delete active custom theme

- **WHEN** the user deletes the currently active custom theme
- **THEN** the app falls back to that theme's base theme

### Requirement: Theme import/export

The system SHALL export any custom theme (or the current appearance wrapped as one)
to a versioned JSON theme file carrying its metadata (name, author, URL, version,
description), and SHALL import such files through strict validation. Imported themes
SHALL register as custom themes and be applied on import. Files that fail validation
SHALL be rejected with a specific error and SHALL NOT be partially applied; files
declaring an unsupported format version SHALL be rejected as requiring a newer
PosterPilot.

#### Scenario: Export a custom theme

- **WHEN** the user exports a custom theme
- **THEN** a JSON theme file downloads containing the format marker, format version,
  metadata, base theme, and token deltas

#### Scenario: Import a valid theme file

- **WHEN** the user imports a theme file that passes validation and ships no CSS
- **THEN** the theme registers as a custom theme and applies immediately

#### Scenario: Reject a malicious or malformed file

- **WHEN** an imported file has an unknown format, an unknown base theme, unknown
  token keys, or token values outside the allowed grammars (e.g. containing `url(`
  or expressions outside the background-image token)
- **THEN** the import is rejected with a specific error message and no theme is
  created or applied

#### Scenario: Reject an unsupported format version

- **WHEN** an imported file declares a newer format version than the app supports
- **THEN** the import is rejected with a message that the file requires a newer
  PosterPilot

### Requirement: Custom background image

On presets that allow it, the system SHALL let the user set a custom background image
by URL, rendered behind the app chrome (cover, fixed) with an adjustable dim overlay
so surfaces and text remain legible. The image SHALL NOT render on presets that lock
the background.

#### Scenario: Setting a background image

- **WHEN** the user provides an image URL on a preset that supports background images
- **THEN** the image renders behind the app chrome across all pages with the dim
  overlay applied

#### Scenario: Adjusting the dim overlay

- **WHEN** the user changes the dim level
- **THEN** the overlay over the background image darkens or lightens while keeping
  text contrast legible

#### Scenario: Background image on a locked preset

- **WHEN** a background image is saved and the user switches to a preset that locks
  the background (e.g. Terminal)
- **THEN** the image is not rendered but remains stored for when a supporting preset
  is active again

### Requirement: Server-side theme application

The active preset and overrides SHALL be applied during server-side rendering (via a
`data-theme` attribute and inline custom properties on the root element) so that the
first paint matches the saved appearance.

#### Scenario: No flash of unthemed content

- **WHEN** the user reloads any page with a non-default theme saved
- **THEN** the first rendered frame already uses the saved theme without a visible swap

### Requirement: Navigation placement

The system SHALL offer a navigation placement option: top bar (default) or left
sidebar. On small viewports the top bar with hamburger menu SHALL be used regardless
of this setting. An extreme theme MAY force its signature chrome layout (e.g.
Overseerr forces the seerr-style left sidebar), in which case the theme's layout
SHALL win over the user's placement setting while that theme is active.

#### Scenario: Sidebar placement on desktop

- **WHEN** the user selects left sidebar placement on a desktop viewport
- **THEN** primary navigation renders as a left sidebar containing the same entries as
  the top bar, and page content shifts to accommodate it

#### Scenario: Mobile fallback

- **WHEN** the viewport is below the desktop breakpoint
- **THEN** navigation renders as the top bar with hamburger menu regardless of the
  placement setting

#### Scenario: Theme-forced layout

- **WHEN** a theme that forces a layout (e.g. Overseerr → left sidebar) is active
- **THEN** the chrome renders in that theme's signature layout regardless of the
  placement setting, the placement control shows the forced layout and is disabled
  with the reason given, and the setting applies again when a non-forcing theme is
  active

### Requirement: Custom CSS

The system SHALL offer a free-form custom CSS field (size-capped) that is applied
verbatim as the last stylesheet on every page, after the active theme and all
overrides. Custom themes SHALL carry an optional CSS field; theme CSS applies
while the theme is active, before the user's own custom CSS. Values containing a
`</style>` breakout SHALL be rejected both at write and at import.

Because a theme file is shared, CSS crossing that boundary SHALL be treated as
third-party: bundling the user's own custom CSS into an authored theme SHALL be
opt-in rather than automatic, theme CSS SHALL additionally reject `@import` and
remote `url()` so a downloaded theme cannot call out to another host, and
importing a theme that ships CSS SHALL disclose that and require confirmation
before the theme is applied.

#### Scenario: Instance CSS does not travel by default

- **WHEN** the user saves the current appearance as a theme without opting in to
  bundling their custom CSS
- **THEN** the authored theme carries no CSS of theirs, and any CSS the theme
  already shipped is preserved rather than dropped

#### Scenario: Imported theme CSS is disclosed

- **WHEN** the user imports a theme file that ships custom CSS
- **THEN** the amount of CSS is shown and the import is applied only after explicit
  confirmation

#### Scenario: Theme CSS cannot phone home

- **WHEN** a theme file's CSS contains `@import` or a remote `url()`
- **THEN** the import is rejected wholesale

#### Scenario: Custom CSS applies last

- **WHEN** the user saves custom CSS
- **THEN** it is injected as the final stylesheet on every page load, winning the
  cascade over the active theme

#### Scenario: Theme CSS round-trips

- **WHEN** a custom theme was authored with custom CSS and is exported
- **THEN** the export file includes the CSS, importing it registers the theme with
  the CSS intact, and selecting that theme applies its CSS before the user's own

#### Scenario: Breakout rejected

- **WHEN** submitted custom CSS or an imported theme's CSS contains `</style>` or
  exceeds the size cap
- **THEN** the write or import is rejected with a validation error

### Requirement: Appearance persistence and i18n

Appearance settings (theme, overrides, custom themes, navigation placement) SHALL be
stored instance-wide in the app settings store and survive restarts. All new
Appearance UI text SHALL be present in every supported locale catalog.

#### Scenario: Persistence across restart

- **WHEN** the application restarts after appearance settings were changed
- **THEN** the saved preset, overrides, and placement are still applied

#### Scenario: Localized appearance UI

- **WHEN** the active locale is not English
- **THEN** the Appearance section labels and descriptions render in the active locale
  (preset names remain as proper nouns)

### Requirement: Theme reskins beyond tokens

A theme SHALL be able to change component shape and affordance, not only color:
built-in themes through `[data-theme]` rules in `src/app.css`, user-authored
themes through their theme file's CSS field, both landing in the same place in
the cascade (unlayered, so a theme can override utilities written into the
markup). The extreme presets SHALL use this to approach the applications they
reskin rather than merely recoloring the default look.

#### Scenario: Extreme presets reskin their references

- **WHEN** an extreme preset is active
- **THEN** its chrome takes on the reference application's signature treatment —
  Overseerr an indigo backdrop wash with elevated cards and gradient primary
  buttons, Sonarr/Radarr flat near-square surfaces with a left accent bar on the
  active navigation row, Terminal a scanlined CRT with phosphor bloom, bracketed
  panel headers and a block cursor on the active row

#### Scenario: Reskin follows an accent override

- **WHEN** a user overrides the accent of a preset whose reskin mixes its own
  shades (gradients, active bars) from the accent
- **THEN** those shades derive from the overridden accent, not the preset's original

### Requirement: Contrast floor across shipped themes

Every shipped theme's text tokens SHALL meet WCAG AA (4.5:1) against both the
theme background and its surface, and each theme's accent foreground SHALL meet
AA against its accent fill. This SHALL be enforced by an automated check reading
the `[data-theme]` blocks, so a new or edited theme cannot ship below the floor.
Where a live user override moves the accent, the accent foreground SHALL be
re-derived so the pairing stays readable.

#### Scenario: A theme below the floor fails the build

- **WHEN** a theme declares a text token that does not clear AA on its surface
- **THEN** the theme contrast check fails

#### Scenario: Accent override keeps a readable foreground

- **WHEN** the user picks an accent whose luminance is opposite the theme's own
- **THEN** the accent foreground flips to the readable one instead of keeping the
  theme's pairing
