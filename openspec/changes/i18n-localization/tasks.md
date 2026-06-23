## 1. Paraglide setup & project config

- [ ] 1.1 Add `@inlang/paraglide-js` as a dev dependency
- [ ] 1.2 Create `project.inlang/settings.json` with `baseLocale: "en"`, `locales: ["en","es","zh","ja","pt-BR"]`, and the inlang message-format (JSON, key-value) plugin pointed at `./messages/{locale}.json`
- [ ] 1.3 Create `messages/en.json` (empty source catalog) and stub `messages/es.json`, `zh.json`, `ja.json`, `pt-BR.json`
- [ ] 1.4 Add `paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })` to `vite.config.ts`
- [ ] 1.5 Git-ignore the generated `src/lib/paraglide/` output; confirm it regenerates on `bun run dev`/`build`/`check`
- [ ] 1.6 Confirm `bun run check` compiles the catalogs and the generated runtime imports from `$lib/paraglide`

## 2. Locale resolution (capability: i18n)

- [ ] 2.1 Add `export const handle` to `src/hooks.server.ts` that wraps `resolve` in `paraglideMiddleware(event.request, ({ request, locale }) => resolve({ ...event, request }))`, keeping the existing startup `migrateDb`/`markInterruptedJobs` side effects
- [ ] 2.2 Configure the resolution strategy so order is: persisted `language` setting → `Accept-Language` (`preferredLanguage`) → English (`baseLocale`); seed the persisted setting from `resolveConfig().language`
- [ ] 2.3 Ensure values outside the supported-locale set are ignored at resolution (stale setting / crafted header) and English is always the last resort
- [ ] 2.4 Return `locale` and `availableLocales` from `src/routes/+layout.server.ts` so the client can read the active and available locales
- [ ] 2.5 Test resolution precedence: setting wins over header; header used when no setting; English when neither matches; unsupported value ignored

## 3. Language setting (capability: configuration)

- [ ] 3.1 Add `language` to `AppConfig`, `ENV_MAP` (`APP_LANGUAGE`), `WRITABLE_KEYS`, and `DEFAULTS` in `src/lib/server/config/index.ts`
- [ ] 3.2 Validate `language` against the supported locales in `resolveConfig`; treat absent/unsupported as unset (no error)
- [ ] 3.3 Ensure `isEnvManaged('language')` and the env-override precedence work like other settings (`APP_LANGUAGE` locks it)
- [ ] 3.4 Test: persisted language honored; env override wins and is env-managed; invalid value treated as unset

## 4. Extract strings into the source catalog (capabilities: i18n, web-ui)

- [ ] 4.1 Extract app-shell strings (nav labels, configure-to-get-started banner) from `src/routes/+layout.svelte` into `messages/en.json`; replace with message calls
- [ ] 4.2 Extract Settings page strings (`src/routes/settings/+page.svelte`): field labels, helper text, validation messages, buttons
- [ ] 4.3 Extract Library page strings (`src/routes/library/+page.svelte`): filter/sort labels, placeholders, status badges, empty state
- [ ] 4.4 Extract Item detail strings (`src/routes/item/[id]/+page.svelte`): discover/apply/revert actions, section and slot labels, method/option labels
- [ ] 4.5 Extract Jobs page strings (`src/routes/jobs/+page.svelte`): column headers, status and job-type labels, progress text
- [ ] 4.6 Extract Dashboard strings (`src/routes/+page.svelte`) and shared components (`PosterCard.svelte`, `JobProgress.svelte`)
- [ ] 4.7 Define parameterized messages (counts, item titles, etc.) with named parameters; no string concatenation at call sites
- [ ] 4.8 Run `bun run check` after each page so any missed/renamed message id surfaces as a type error; confirm `en.json` is the complete source catalog

## 5. Language switcher & settings control (capabilities: i18n, web-ui)

- [ ] 5.1 Add a language switcher to the `+layout.svelte` header, available on every page, populated from `availableLocales`, each option labeled in its own language, reflecting the active locale
- [ ] 5.2 On selection, persist the choice as the `language` setting via the existing settings API and re-render via Paraglide `setLocale` (no raw reload required); confirm it stays sticky across reload/SSR
- [ ] 5.3 Add an equivalent preferred-language control to the Settings page that writes the same `language` setting
- [ ] 5.4 Verify the header switcher and the Settings field stay consistent (one source of truth)

## 6. Translations (capability: i18n)

- [ ] 6.1 Provide initial translations (or seed for Weblate) in `messages/es.json`, `zh.json`, `ja.json`, `pt-BR.json`
- [ ] 6.2 Confirm per-key English fallback: a missing/empty target-locale key renders English, never a raw id
- [ ] 6.3 Apply `Intl`-based locale-aware formatting for any displayed numbers (e.g. ratings/counts) using the active locale

## 7. Weblate & contributor docs (capability: i18n)

- [ ] 7.1 Configure a Weblate component: file mask `messages/*.json`, source language `en`, JSON key-value format, git push-back
- [ ] 7.2 Add a Weblate translation-status badge (per-language % complete) to the README
- [ ] 7.3 Add a "Translators" section to `CONTRIBUTING.md` describing the Weblate workflow, that English is the source of truth, how new keys surface, and how translations land back via git (plus the direct-PR fallback)

## 8. Verification

- [ ] 8.1 `bun run check`, `bun run test`, `bun run format`, and `bun run build` pass
- [ ] 8.2 Manually switch through all five locales on every page (Dashboard, Library, Item, Jobs, Settings) and confirm localized strings, no raw keys, no hydration mismatch
- [ ] 8.3 Confirm precedence end-to-end: setting > `Accept-Language` > English; clearing the setting falls back to the header
- [ ] 8.4 `openspec validate i18n-localization` passes
