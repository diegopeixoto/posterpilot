## 1. Setup

- [ ] 1.1 Add ESLint flat config (`eslint.config.js`) with `typescript-eslint` + `eslint-plugin-svelte` (+ Svelte a11y), tuned for Svelte 5 runes and adapter-node server code; ignore `src/lib/paraglide/`, `build/`, `.svelte-kit/`.
- [ ] 1.2 Add devDependencies + `lint:eslint` script; decide whether `lint` runs both Prettier and ESLint.

## 2. Findings

- [ ] 2.1 Run ESLint; triage findings. Decide fail-on-all vs baseline ratchet (design).
- [ ] 2.2 Fix (or baseline) the findings so the gate is green; no behavior change.

## 3. CI & docs

- [ ] 3.1 Add an ESLint step to `.github/workflows/ci.yml`.
- [ ] 3.2 Note ESLint in the quality-gates list (`CLAUDE.md` / contributing docs).

## 4. Verification

- [ ] 4.1 Gates: `bun run check`, `bun run test`, `bun run build`, `bun run lint`, `bun run lint:eslint` — all green.
