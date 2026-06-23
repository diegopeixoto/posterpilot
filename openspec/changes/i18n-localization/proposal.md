## Why

PosterPilot's UI is English-only with every label, button, banner, and status message hardcoded directly in Svelte markup. That excludes non-English self-hosters and makes the app impossible to translate without forking. Adding internationalization (i18n) with a small set of high-coverage languages opens the app to a much wider audience, and routing translations through a community workflow lets contributors maintain languages we don't speak ourselves.

## What Changes

- **Add multi-language UI support** for English (default), Spanish (`es`), Simplified Chinese (`zh`), Japanese (`ja`), and Brazilian Portuguese (`pt-BR`), with English as the base/source locale.
- **Adopt Paraglide JS (inlang)** as the i18n library — a compiler-based, type-safe, tree-shakeable solution that is SvelteKit-native. Messages live as one JSON catalog per locale (`messages/en.json`, `es.json`, `zh.json`, `ja.json`, `pt-BR.json`).
- **Externalize all hardcoded UI strings** out of the Svelte components into the English message catalog, then replace them with type-safe message function calls so every page renders localized text.
- **Resolve the active locale** from (in order) a persisted per-install app setting, then the request's `Accept-Language` header, then English. A SvelteKit server `handle` hook applies the resolved locale per request.
- **Add a language switcher** in the app shell header, available on every page; changing it persists the choice as the `language` app setting.
- **Fall back to English per-key**: a message missing in the active locale renders its English text, never a raw key.
- **Add a `language` settings field** to the existing configuration so the preferred locale is persisted alongside the other settings (and can be overridden by environment variable, like every other setting).
- **Wire up Weblate** for community translation: an inlang/Weblate project configuration, a translation-status badge (per-language % complete) in the README, and a "Translators" section in a new `CONTRIBUTING.md` describing the git-based Weblate workflow.

## Capabilities

### New Capabilities

- `i18n`: Localized UI across the supported locales — externalized message catalogs (JSON per locale), per-request locale resolution (setting → `Accept-Language` → English), a header language switcher, per-key English fallback, and a Weblate-based community translation + status-tracking workflow.

### Modified Capabilities

- `web-ui`: Every page (Dashboard, Library, Item detail, Jobs, Settings) renders localized strings instead of hardcoded English, and the shared application shell gains a language switcher in its header.
- `configuration`: Runtime configuration gains a `language` field (preferred UI locale) that is persisted from the settings UI and overridable by environment variable, consistent with the existing settings.

## Impact

- **Dependencies:** add `@inlang/paraglide-js` (dev dependency for its Vite plugin / compiler; emits a generated runtime). No new runtime services.
- **Build:** add the Paraglide Vite plugin to `vite.config.ts` (project + outdir) so the message functions and runtime are compiled from the catalogs at build/dev time; generated `src/lib/paraglide/` output is git-ignored (regenerated on build).
- **Config / project files:** add `project.inlang/settings.json` (baseLocale `en`, locales list, JSON message-format plugin), `messages/<locale>.json` catalogs, and a Weblate component pointed at the catalogs.
- **Code:** add a `handle` hook in `src/hooks.server.ts` running `paraglideMiddleware` for per-request locale; expose the resolved locale + available locales to the client via the root layout load; add the language switcher to `+layout.svelte`; replace hardcoded strings in `+layout.svelte` and every route `+page.svelte` (Dashboard, Library, Item, Jobs, Settings) and shared components with message-function calls.
- **Settings:** add `language` to the writable config keys, `ENV_MAP` (e.g. `APP_LANGUAGE`), and defaults in `src/lib/server/config/index.ts`; surface it in the settings UI (the switcher and the settings page share the same value).
- **Docs:** add `README` translation-status badge and a new `CONTRIBUTING.md` "Translators" section.
- **Depends on / coordinates with** the existing `configuration` (settings persistence) and `web-ui` (shell + pages) capabilities — the locale setting reuses the settings store and the switcher lives in the existing shell. No breaking changes to the apply pipeline, jobs, or APIs; English-only behavior is preserved as the default.
