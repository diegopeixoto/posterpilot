## Why

The `lint` script is **Prettier-only** (`prettier --check .`) — it enforces formatting but catches no
correctness or code-smell issues. The plan flagged adding ESLint as a follow-up. A linter would catch
unused vars, floating promises, `svelte`-specific pitfalls, and accessibility issues in markup that
neither `svelte-check` nor Prettier flags, and give the CI a real static-analysis gate.

## What Changes

- Add **ESLint** (flat config) with TypeScript + Svelte plugins tuned to this codebase (Svelte 5 runes,
  `$env`-free test convention, adapter-node server code). Include `eslint-plugin-svelte` and the
  Svelte a11y rules.
- Wire it into the quality gates: a `lint:eslint` (or fold into `lint`) script and a CI step.
- Fix the findings the initial run surfaces (or ratchet: baseline-ignore then burn down, decided in
  design) so the gate lands green.

## Capabilities

### New Capabilities
- `code-quality`: introduces a static-analysis gate — ESLint (TypeScript + Svelte + a11y rules) runs
  as a quality gate and in CI, passing cleanly on main.

## Impact

- **Tooling:** `eslint.config.js` (flat), new devDependencies, `package.json` scripts.
- **CI:** `.github/workflows/ci.yml` gains an ESLint step.
- **Code:** targeted fixes for the initial findings; no behavior change.
- **Docs:** the quality-gates list in `CLAUDE.md`/contributing mentions ESLint.
- **Decision for design:** fail-on-all vs a baseline-ignore ratchet, and how strict the rule set is.
