## Context

PosterPilot is a self-hosted SvelteKit (Svelte 5 runes) + Bun app with Tailwind v4, Drizzle/SQLite, an in-process job queue, and SSE. The UI is English-only: every label, button, nav item, banner, and status string is hardcoded in `+layout.svelte`, the route `+page.svelte` files (Dashboard, Library `library/`, Item `item/[id]/`, Jobs `jobs/`, Settings `settings/`), and shared components (`PosterCard.svelte`, `JobProgress.svelte`).

Configuration is a key/value `settings` SQLite table read through `src/lib/server/config/index.ts`, where each config key maps to an environment-variable name and env always overrides the persisted value (`resolveConfig`, `ENV_MAP`, `WRITABLE_KEYS`, `isEnvManaged`). The root layout already loads server state (`+layout.server.ts` returns `activeJobs` and `configReady`), so it is the natural place to also surface the resolved locale and the available locales to the client. `src/hooks.server.ts` currently runs startup migrations but exports no `handle` hook yet — so adding a `handle` for per-request locale is additive.

We want to localize the UI into English (default/base), Spanish, Simplified Chinese, Japanese, and Brazilian Portuguese, keep the door open for community-maintained translations, and never regress the English experience.

Constraints: single-container, single-user, self-hosted scale; SvelteKit SSR + client hydration (the chosen locale must be consistent across both); no new runtime services; keep bundle impact small.

## Goals / Non-Goals

**Goals:**

- A fully localized UI in five locales, English as the base, with English-per-key fallback so a partially translated locale never shows raw keys.
- Type-safe message access compiled from per-locale JSON catalogs, so a missing or misnamed message id is a build/type error, and unused messages tree-shake out.
- Per-request locale resolution: persisted `language` setting → `Accept-Language` → English, applied uniformly to SSR and client.
- A header language switcher (on every page) and an equivalent control in Settings, both writing the same `language` setting.
- A community translation path (Weblate) with per-language status surfaced in the README and a documented contributor workflow.
- Reuse the existing settings store and app shell rather than introducing parallel mechanisms.

**Non-Goals:**

- Localizing upstream data values (movie/show titles, overviews, genres, uploader names, Plex section names) — these render as their source data.
- URL-prefixed locales (`/es/...`, `/ja/...`) or per-locale routing — locale is a setting/header, not part of the path.
- Right-to-left layout support — none of the five locales is RTL.
- Server log/error-message localization — logs stay English for operability.
- Number/date/currency formatting frameworks beyond what `Intl` already provides where needed.
- Auto-detecting locale from geolocation or any new client-side storage beyond the existing settings store and Paraglide's cookie.

## Decisions

**1. Use Paraglide JS (inlang) as the i18n library.**
Paraglide is a compiler: it reads `project.inlang/settings.json` (baseLocale + locales + the JSON message-format plugin) and the `messages/<locale>.json` catalogs, and emits tree-shakeable, fully typed message functions plus a small runtime into a generated output dir. This gives compile-time safety (a typo'd id won't compile), minimal bundle cost (only referenced messages ship), and first-class SvelteKit support via a Vite plugin and a server middleware. Catalogs are plain JSON keyed by message id — exactly the shape Weblate's JSON format understands.
_Alternatives:_ `svelte-i18n` / `typesafe-i18n` (runtime dictionaries — larger bundles, weaker tree-shaking, looser typing) and a hand-rolled `messages[locale][key]` map (no type safety, easy to drift, no tooling). Rejected for the safety + bundle + tooling story Paraglide gives for free.

**2. Catalogs as one JSON file per locale under `messages/`, English as the source.**
`messages/en.json` is the complete source catalog (every id). `es.json`, `zh.json`, `ja.json`, `pt-BR.json` hold translations and may be partial. The inlang project (`project.inlang/settings.json`) sets `baseLocale: "en"` and `locales: ["en","es","zh","ja","pt-BR"]` and uses the inlang message-format (JSON) plugin so Weblate and the compiler read the same files. Message ids are namespaced by area for readability (e.g. `nav_dashboard`, `library_filter_type`, `settings_save`, `jobs_status_running`), and runtime values use named parameters (e.g. `library_count({ count })`) rather than string concatenation.
_Alternative:_ a single combined catalog with nested locale objects (rejected — Weblate components map cleanly to one-file-per-language, and per-file diffs are easier to review).

**3. Locale resolution via Paraglide strategies + a custom "setting" strategy, ending at English.**
Paraglide resolves the active locale from an ordered `strategy` list. We configure it as effectively: persisted `language` setting (highest) → `preferredLanguage` (the `Accept-Language` header) → `baseLocale` (English). The persisted setting is injected as a custom/cookie-backed strategy seeded from `resolveConfig().language` so the same value that the Settings page and the header switcher write is the top-priority input. The base locale guarantees a defined result, satisfying "English last resort." The supported-locale set from the inlang config is the single source of truth, so any value outside it (stale setting, crafted header) is ignored.
_Alternative:_ URL-prefixed routing (`url` strategy first) — rejected per Non-Goals; it would reshape every route and link.

**4. Apply the locale per request with a `handle` hook running `paraglideMiddleware`.**
Add (a new) `export const handle` to `src/hooks.server.ts` that wraps `resolve` in `paraglideMiddleware(event.request, ({ request, locale }) => resolve({ ...event, request }))`. The middleware resolves the locale once per request and makes it the ambient locale for all server rendering; on the client, Paraglide's runtime keeps the same locale active after hydration. The existing startup work (`migrateDb`, `markInterruptedJobs`) stays as top-level side effects in the same file. The root `+layout.server.ts` additionally returns the resolved `locale` and the `availableLocales` list so the switcher and any locale-aware client code can read them from `data`.
_Alternative:_ resolving locale ad hoc in each `load` (rejected — duplicative and easy to miss; a single hook covers every route).

**5. The language switcher and Settings field write one `language` setting through the existing config system.**
Add `language` to `AppConfig`, `ENV_MAP` (`APP_LANGUAGE`), `WRITABLE_KEYS`, and `DEFAULTS` in `config/index.ts`, validated against the supported locales (invalid → treated as unset). The header switcher (in `+layout.svelte`) and the Settings page both POST to the existing settings API to persist `language`; selecting in the header is just a fast path to the same write, after which the app re-renders in the new locale (Paraglide's `setLocale` updates the client immediately and the persisted value keeps it sticky across reloads/SSR). Because it flows through `resolveConfig`, an `APP_LANGUAGE` env var locks the locale and shows as env-managed, exactly like other settings.
_Alternative:_ a dedicated locale cookie owned outside the settings store (rejected — would create two sources of truth for "preferred language"; reusing the setting keeps one).

**6. Per-key English fallback is inherent to the compiler + a complete English source.**
Because `en.json` is the guaranteed-complete source catalog and `baseLocale` is `en`, any id missing/empty in a target locale resolves to its English text rather than the raw id. We additionally treat empty strings in a target catalog as "missing" so a blank Weblate entry also falls back. This satisfies "never show a raw key."

**7. Weblate for community translation, pointed at the JSON catalogs over git.**
Configure a Weblate component with file mask `messages/*.json`, source language `en`, JSON (key-value) format, and git push-back (Weblate proposes commits/PRs to the repo). New English strings added to `en.json` automatically appear as untranslated entries for every locale in Weblate. Add a Weblate translation-status badge to the README (per-language % complete) and a "Translators" section to a new `CONTRIBUTING.md` describing: how to join the Weblate project, that English is the source of truth, how new keys surface, and how completed translations land back via git.
_Alternative:_ Crowdin / Lokalise (rejected — Weblate is FOSS with free libre hosting and a native git/JSON workflow that matches a self-hosted OSS project).

**8. Generated Paraglide output is git-ignored and produced by the Vite plugin.**
Add `paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide' })` to `vite.config.ts`; the generated `src/lib/paraglide/` is git-ignored and regenerated on `dev`/`build`/`check`. Source of truth in git is only `project.inlang/settings.json` + `messages/*.json`. Components import message functions and the runtime from `$lib/paraglide`.

## Risks / Trade-offs

- **String-extraction churn touches every page** → A one-time, mechanical pass: extract to `en.json`, replace with message calls. Mitigate by doing it page-by-page with `bun run check` after each so type errors catch any missed/renamed id. Behavior is unchanged for English.
- **SSR/client locale mismatch (hydration flash)** → The `handle` middleware resolves locale before SSR and Paraglide reuses the same locale on the client, so server and client agree; the persisted setting and cookie keep them in sync. Verify no hydration warning in dev.
- **Partial translations look inconsistent** → Acceptable by design: per-key English fallback means untranslated strings show English, never blanks or keys; the README badge makes coverage visible so contributors can prioritize.
- **Generated output not in git could break CI that skips the Vite build** → The compile runs as part of `dev`/`build`/`check` (and can be a `prepare`/pre-`check` step); CI already runs `bun run check`, so the runtime is generated before type-checking. Document this so a fresh clone runs a build/check before importing `$lib/paraglide`.
- **Adding a `handle` hook to a file that currently only does startup work** → `handle` is additive and independent of the existing top-level `await`s; keep them and just add the export. No change to job/SSE behavior.
- **Weblate push-back permissions** → Weblate needs write access (a bot account / token) to open PRs; until configured, translations can still be contributed via direct PRs editing `messages/*.json`. Document both paths.
- **Locale-specific formatting (numbers, ratings)** → Use `Intl.NumberFormat`/`Intl.DateTimeFormat` with the active locale where a formatted number is shown; for the small set of such cases this is sufficient and needs no extra dependency.

## Migration Plan

1. Add `@inlang/paraglide-js`; create `project.inlang/settings.json` (baseLocale `en`, the five locales, JSON message plugin) and `messages/en.json` (initially empty) and stub `es/zh/ja/pt-BR.json`.
2. Wire the Vite plugin (`outdir: src/lib/paraglide`), git-ignore the output, and add the `handle` hook with `paraglideMiddleware` to `src/hooks.server.ts`.
3. Extend `config/index.ts` with the `language` setting (env `APP_LANGUAGE`, writable, validated) and surface `locale` + `availableLocales` from `+layout.server.ts`.
4. Extract strings page-by-page into `en.json`, replacing hardcoded text with message calls; run `bun run check` after each page. Start with the shell (`+layout.svelte` nav + banner), then Settings, Library, Item, Jobs, Dashboard, and shared components.
5. Add the header language switcher and the Settings language field, both writing `language`.
6. Translate (or seed via Weblate) `es/zh/ja/pt-BR.json`.
7. Configure the Weblate component; add the README status badge and the `CONTRIBUTING.md` "Translators" section.
8. Verify `bun run check`, `bun run test`, `bun run build` pass; manually switch through all five locales on every page and confirm fallback behavior.

Rollback: remove the Vite plugin + `handle` hook, the language switcher/field, and the `language` config key; the English source catalog can stay (it is inert) or strings can be inlined again. No schema migration is involved (the `language` setting is just another row in the existing key/value `settings` table), so there is nothing to revert in the database.

## Open Questions

- Exact message-id naming convention (flat `area_thing` vs nested groups) — decide before the extraction pass so ids are stable for translators; leaning flat snake_case by area.
- Whether the header switcher should immediately re-render via `setLocale` (no reload) or trigger a navigation/invalidate to re-fetch SSR strings — prefer client `setLocale` for snappiness, confirm it keeps SSR and persisted setting consistent.
- Whether to treat `zh` as `zh` or `zh-Hans` for the catalog/locale id (Simplified) — default to `zh` for brevity, revisit if Traditional Chinese is ever added.
- Whether Brazilian Portuguese should fall back to a generic `pt` before English if a `pt` catalog is ever added — out of scope now (only `pt-BR` exists), but keep the resolver tolerant of regioned tags.

## Implementation notes (as built)

Paraglide JS (`@inlang/paraglide-js` 2.x) set up cleanly under Bun + Vite 8, so the **in-house fallback was not needed**. A few specifics differ from the plan and are recorded here so the docs match the code:

- **Locale env var is `LANGUAGE`** (`ENV_MAP.language = 'LANGUAGE'`), not `APP_LANGUAGE` — kept consistent with the existing un-prefixed env names (`PLEX_URL`, `TMDB_KEY`, …). It still flows through `resolveConfig`/`isEnvManaged` like every other setting, so the env locks the locale and shows as env-managed.
- **Resolution strategy** is Paraglide `['custom-setting', 'preferredLanguage', 'baseLocale']`. `custom-setting` is a custom strategy registered on both server and client: the server handler reads the persisted/validated `language` from `resolveConfig()` (highest precedence); `preferredLanguage` is Paraglide's `Accept-Language` matcher; `baseLocale` is English. A pure, `$env`/`$app`-free `resolveLocale(setting, acceptLanguage)` in `src/lib/i18n/resolve.ts` mirrors this precedence and is unit-tested (`resolve.test.ts`); `resolveConfig` reuses its `normalizeLocale` to validate/normalize the `language` value (tolerant of regioned tags: `pt`→`pt-BR`, `zh-Hans`→`zh`), treating unsupported values as unset.
- **Switcher behavior**: the header switcher and the Settings language field both call Paraglide `setLocale(locale)`. The client `custom-setting` strategy persists the choice via `POST /api/settings { language }` (the same write the Settings page uses), and Paraglide then reloads so the next SSR pass re-renders in the new locale — keeping SSR, the persisted setting, and the client in sync (one source of truth).
- **`<html lang>`** is set per request via the `handle` hook's `transformPageChunk` replacing a `%lang%` placeholder in `app.html` with the resolved locale.
- **Generated output** lives at `src/lib/paraglide/` (git-ignored), compiled by the Vite plugin; components import `m` from `$lib/paraglide/messages` and the runtime from `$lib/paraglide/runtime`.
- **Weblate** is documented and pre-configured (`.weblate`, README badge + "Translating" section, CONTRIBUTING "Translators" section), but creating the live Hosted Weblate project/component remains an out-of-band maintainer step.
