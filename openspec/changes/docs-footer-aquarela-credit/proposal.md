# Proposal: docs-footer-aquarela-credit

## Why

The docs footer was meant to carry the project credits: the running app version, a
copyright line for Diego Peixoto linking to his GitHub profile, and a plug for
Aquarela (aquarela.io), the maintainer's company. The footer component
(`docs/src/components/Footer.astro`) already ships the version link and the
copyright/GitHub line — but the Aquarela credit was never added, so the company plug
is missing from every docs page. None of this footer behavior is captured in the
`documentation` spec either, so nothing protects the existing credits from regressing.

## What Changes

- Add an Aquarela credit to the docs footer credits row: a link to
  `https://aquarela.io` shown on every docs page and every locale, styled
  consistently with the existing credit links (muted, hover-highlight).
- Keep the existing credits intact: `© <year> Diego Peixoto` →
  `https://github.com/diegopeixoto`, star-count link, and `v<version>` → releases,
  where the version is read from the root `package.json` at build time.
- Capture the full footer-credits behavior (version, copyright, Aquarela plug,
  disclaimer) as requirements in the `documentation` spec so it can't silently
  regress again.
- Extend the same credits to the **app** footer (`src/routes/+layout.svelte`),
  which today shows only the project link, version, and localized disclaimer: add
  `© <year> Diego Peixoto` → GitHub profile and an "An app from Aquarela" →
  aquarela.io credit, localized via a new `footer_aquarela` key in all 5 catalogs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `documentation`: add a requirement that the docs site footer displays project
  credits on every page and locale — current app version (from the root
  `package.json`), copyright attribution for Diego Peixoto linking to his GitHub
  profile, and an Aquarela (aquarela.io) company credit.
- `web-ui`: add a requirement that the app footer displays the same credits —
  copyright attribution linking to the maintainer's GitHub profile and the Aquarela
  company credit — alongside the existing project link, version, and disclaimer.

## Impact

- `docs/src/components/Footer.astro` — add the Aquarela link to the `.pp-credits`
  row.
- `src/routes/+layout.svelte` — add the copyright + Aquarela links to the existing
  app footer.
- `messages/{en,es,zh,ja,pt-BR}.json` — one new `footer_aquarela` key each (catalog
  parity kept). No release tooling changes. No dependency changes.
- The footer already renders through Starlight's `components.Footer` override in
  `docs/astro.config.mjs`; no config change needed.
