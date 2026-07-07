## Why

The Starlight docs (`docs/src/content/docs/`) are text-only. A poster/artwork manager is an
inherently visual tool, and screenshots dramatically improve installation, configuration, and usage
docs — showing the library wall, item detail, the apply flow, the Kometa manager, and Settings makes
the product legible before install. The plan flagged adding them.

## What Changes

- Capture a consistent set of screenshots (dark theme, representative library) of the key surfaces:
  dashboard, library grid, item detail / apply, Settings (incl. the new Security tab), the Kometa
  manager, and the first-run wizard.
- Embed them at the right points in `installation.md`, `configuration.md`, and `usage.md`, with alt
  text; store the assets under the docs' static/assets path so the build bundles them.

## Capabilities

### Modified Capabilities
- `documentation`: adds a requirement that the key product surfaces be illustrated with screenshots
  (with alt text) in the installation, configuration, and usage docs and bundled by the build.

## Impact

- **Docs:** image assets + `<img>`/Markdown embeds with alt text across installation/configuration/usage;
  possibly localized captions (English first; translated docs follow the existing translation workflow).
- **Build:** ensure Starlight bundles the assets; keep file sizes reasonable (optimized PNG/WebP).
- **No app code change.**
- **Decision for design:** the exact screenshot list + capture conventions (viewport, theme, sample
  data), and whether to include localized variants now or later.
