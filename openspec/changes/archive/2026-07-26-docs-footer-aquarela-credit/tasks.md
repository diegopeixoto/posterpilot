# Tasks: docs-footer-aquarela-credit

## 1. Implement

- [x] 1.1 Add the Aquarela credit to `.pp-credits` in `docs/src/components/Footer.astro`: `·` separator + `<a href="https://aquarela.io" rel="noopener external">An app from Aquarela</a>`, placed after the version link; no style changes needed (inherits the existing `.pp-credits a` rules)
- [x] 1.2 Add `© <year> Diego Peixoto` → `https://github.com/diegopeixoto` and "An app from Aquarela" → `https://aquarela.io` links to the app footer in `src/routes/+layout.svelte`, `·`-separated, same classes as the existing project link (`hover:text-neutral-200`, `target="_blank" rel="noopener"`); Aquarela label localized via new `footer_aquarela` key in all 5 catalogs

## 2. Verify

- [x] 2.1 `cd docs && bun install && bun run build` — build green, then inspect a built page (e.g. `dist/index.html` and one non-English locale page) confirming all four credit entries render: copyright→GitHub, stargazers, `v0.9.x`→releases, Aquarela→aquarela.io
- [x] 2.2 Preview both footers and check visually: muted color, hover highlight, no layout wrap regression on a narrow (~360px) viewport; app gates green (`bun run check && bun run test && bun run build && bun run lint`)

## 3. Ship

- [x] 3.1 Branch + PR per repo convention (`docs:` conventional commit, e.g. `docs: add Aquarela credit to the docs footer`), no AI attribution, signed commit; self-review the diff and leave the merge to the maintainer
