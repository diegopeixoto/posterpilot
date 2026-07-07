## 1. Setup

- [x] 1.1 `eslint.config.js` (flat) — `@eslint/js` + `typescript-eslint` recommended + `eslint-plugin-svelte` recommended; ignores `src/lib/paraglide`, `build`, `.svelte-kit`, `drizzle`, `docs`; `.svelte` and `.svelte.ts` pointed at the TS parser; `no-unused-vars` allows `_`-prefixed; type-aware rules off (svelte-check covers types).
- [x] 1.2 Added `lint:eslint` script and folded ESLint into `lint` (`prettier --check . && eslint .`); installed devDeps (eslint, typescript-eslint, eslint-plugin-svelte, @eslint/js, globals, svelte-eslint-parser).

## 2. Findings

- [x] 2.1 Triaged. Two Svelte rules were framework-preference noise (`no-navigation-without-resolve` — needs a base path this app lacks; `prefer-svelte-reactivity` — flags non-reactive one-shot URLSearchParams) → ratcheted **off** with a documented rationale, so the gate is meaningful, not noisy.
- [x] 2.2 Fixed the real findings: removed 4 genuinely unused imports (`inArray`, `existsSync`, `KometaSnapshot`, `DEFAULT_FILENAME`), fixed a `no-useless-assignment` in `hooks.server.ts`, and repaired a pre-existing broken `eslint-disable` comment (split across two lines) on the intentional `{@html}` release-notes render. Gate lands green.

## 3. CI & docs

- [x] 3.1 CI already runs `bun run lint`, which now includes ESLint — no separate step needed.
- [x] 3.2 `bun run lint` (a documented quality gate) now transitively runs ESLint; the gate list is unchanged in wording but stronger.

## 4. Verification

- [x] 4.1 Gates: `bun run check` (0 errors), `bun run test`, `bun run lint` (prettier + eslint, clean).
