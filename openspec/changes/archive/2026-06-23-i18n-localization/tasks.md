## 1. Paraglide setup & project config

- [x] 1.1 Add `@inlang/paraglide-js` as a dev dependency
- [x] 1.2 Create `project.inlang/settings.json` with `baseLocale: "en"`, `locales: ["en","es","zh","ja","pt-BR"]`, and the inlang message-format (JSON, key-value) plugin pointed at `./messages/{locale}.json`
- [x] 1.3 Create `messages/en.json` (source catalog) and `messages/es.json`, `zh.json`, `ja.json`, `pt-BR.json`
- [x] 1.4 Add `paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide', strategy: [...] })` to `vite.config.ts`
- [x] 1.5 Git-ignore the generated `src/lib/paraglide/` output; confirmed it regenerates on `bun run dev`/`build`/`check`
- [x] 1.6 Confirmed `bun run check` compiles the catalogs and the generated runtime imports from `$lib/paraglide`

## 2. Locale resolution (capability: i18n)

- [x] 2.1 Added `export const handle` to `src/hooks.server.ts` wrapping `resolve` in `paraglideMiddleware(...)`, keeping the existing startup `migrateDb`/`markInterruptedJobs` side effects
- [x] 2.2 Strategy order is: persisted `language` setting (`custom-setting`, seeded from `resolveConfig().language`) → `Accept-Language` (`preferredLanguage`) → English (`baseLocale`)
- [x] 2.3 Values outside the supported-locale set are ignored at resolution (`normalizeLocale` validates the setting; Paraglide ignores unsupported header tags); English is always the last resort
- [x] 2.4 `src/routes/+layout.server.ts` returns `locale` and `availableLocales` (from `event.locals.locale`)
- [x] 2.5 Tested resolution precedence in `src/lib/i18n/resolve.test.ts` (setting > header > English; unsupported ignored) and verified end-to-end against the running server

## 3. Language setting (capability: configuration)

- [x] 3.1 Added `language` to `AppConfig`, `ENV_MAP` (`LANGUAGE`), `WRITABLE_KEYS`, and `PublicConfig` in `src/lib/server/config/index.ts` (no `DEFAULTS` entry — unset falls through to Accept-Language)
- [x] 3.2 `resolveConfig` validates `language` against the supported locales via `normalizeLocale`; absent/unsupported → null (no error)
- [x] 3.3 `isEnvManaged('language')` and env-override precedence work like other settings (`LANGUAGE` locks it); verified env-managed surfacing
- [x] 3.4 Tested: persisted language honored (verified against the running server); env override wins via the shared `rawValue`/`isEnvManaged` path; invalid value treated as unset

## 4. Extract strings into the source catalog (capabilities: i18n, web-ui)

- [x] 4.1 Extracted app-shell strings (nav labels, configure banner) from `src/routes/+layout.svelte`; replaced with message calls
- [x] 4.2 Extracted Settings page strings (`src/routes/settings/+page.svelte`): field labels, helper text, status messages, buttons
- [x] 4.3 Extracted Library page strings (`src/routes/library/+page.svelte`): filter/sort labels, placeholders, status badges, empty state
- [x] 4.4 Extracted Item detail strings (`src/routes/item/[id]/+page.svelte`): discover/apply/revert actions, section and slot labels, method/option labels, status messages
- [x] 4.5 Extracted Jobs page strings (`src/routes/jobs/+page.svelte`): column headers, progress text, empty state
- [x] 4.6 Extracted Dashboard strings (`src/routes/+page.svelte`) and shared components (`PosterCard.svelte`, `JobProgress.svelte`)
- [x] 4.7 Parameterized messages (counts, ids, titles, errors) use named parameters; no string concatenation at call sites
- [x] 4.8 Ran `bun run check` (0 errors); `en.json` is the complete source catalog

## 5. Language switcher & settings control (capabilities: i18n, web-ui)

- [x] 5.1 Added a header language switcher to `+layout.svelte`, available on every page, populated from `availableLocales`, each option labeled in its own language, reflecting the active locale
- [x] 5.2 On selection it persists the choice as the `language` setting (client custom strategy POSTs to `/api/settings`) and re-renders via Paraglide `setLocale` (default reload); confirmed sticky across reload/SSR
- [x] 5.3 Added an equivalent preferred-language control to the Settings page that writes the same `language` setting
- [x] 5.4 Both controls use `setLocale` → the same `language` write (one source of truth)

## 6. Translations (capability: i18n)

- [x] 6.1 Provided translations in `messages/es.json`, `zh.json`, `ja.json`, `pt-BR.json` (full coverage of the source catalog)
- [x] 6.2 Confirmed per-key English fallback (Paraglide resolves missing/empty target keys to the English source)
- [x] 6.3 Applied `Intl`-based locale-aware formatting for displayed numbers (item rating via `Intl.NumberFormat`, job timestamps via `toLocaleString(locale)`)

## 7. Weblate & contributor docs (capability: i18n)

- [ ] 7.1 Configure the live Weblate component on Hosted Weblate (file mask `messages/*.json`, source `en`, JSON key-value, git push-back). **Deferred — out-of-band maintainer step.** The mapping is pre-declared in `.weblate`.
- [x] 7.2 Added a Weblate translation-status badge to the README (resolves once the live project exists)
- [x] 7.3 Added a "Translators" section to `CONTRIBUTING.md` (Weblate workflow, English as source of truth, how new keys surface, git push-back, plus the direct-PR fallback) and a "Translating" section to the README

## 8. Verification

- [x] 8.1 `bun run check` (0 errors), `bun run test` (all pass), and `bun run build` (succeeds) pass; ran `bunx prettier --write` on the created/edited files (per task: not repo-wide `bun run format`)
- [x] 8.2 Verified locale switching across pages against the running server (Dashboard/Library/Settings in en/es/ja/zh), localized strings render, `<html lang>` updates, no raw keys
- [x] 8.3 Confirmed precedence end-to-end against the running server: persisted setting (`ja`) > `Accept-Language` (`es`) > English; clearing/invalidating the setting falls back to the header
- [x] 8.4 `openspec validate i18n-localization` passes
