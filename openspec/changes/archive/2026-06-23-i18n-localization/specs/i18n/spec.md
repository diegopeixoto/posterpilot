## ADDED Requirements

### Requirement: Supported locales

The system SHALL support a fixed set of UI locales — English (`en`), Spanish (`es`), Simplified Chinese (`zh`), Japanese (`ja`), and Brazilian Portuguese (`pt-BR`) — with English as the base (source) locale and the default. The set of supported locales SHALL be the single source of truth used by both the locale resolver and the language switcher, so the two can never offer or resolve a locale that is not translated.

#### Scenario: All supported locales are selectable

- **WHEN** the language switcher is rendered
- **THEN** it offers exactly the supported locales — English, Spanish, Simplified Chinese, Japanese, and Brazilian Portuguese — each labeled in its own language

#### Scenario: English is the base locale

- **WHEN** no other locale can be resolved for a request
- **THEN** the system renders the UI in English

#### Scenario: Unknown locale is not honored

- **WHEN** a locale value outside the supported set is supplied (e.g. via a stale setting or a crafted request)
- **THEN** the system ignores it and continues resolving as if it were absent, never rendering an unsupported locale

### Requirement: Externalized message catalogs

The system SHALL store all user-facing UI strings in per-locale message catalogs (one JSON file per locale: `messages/en.json`, `messages/es.json`, `messages/zh.json`, `messages/ja.json`, `messages/pt-BR.json`), keyed by a stable message id, rather than hardcoded in components. The English catalog SHALL be the complete source catalog containing every message id. The UI SHALL reference messages only through the generated type-safe message functions, never by interpolating a raw catalog string at the call site.

#### Scenario: Source catalog is complete

- **WHEN** the application is built
- **THEN** every UI string the user can see corresponds to a message id present in the English source catalog

#### Scenario: Messages referenced by id

- **WHEN** a component needs to display a label, button, heading, banner, or status text
- **THEN** it calls the message function for that id and the active locale's text is rendered

#### Scenario: Parameterized messages

- **WHEN** a message contains a runtime value (e.g. a count or item title)
- **THEN** the message is defined with a named parameter in the catalog and rendered by passing that parameter to the message function, not by string concatenation in the component

### Requirement: Per-request locale resolution

The system SHALL resolve the active locale for each request in the following precedence order: (1) the persisted preferred-language app setting when it names a supported locale, (2) the request's `Accept-Language` header matched against the supported locales, (3) English. The resolved locale SHALL apply to all server-rendered and client-rendered strings for that request.

#### Scenario: Setting takes precedence

- **WHEN** the preferred-language setting names a supported locale
- **THEN** the request is rendered in that locale regardless of the `Accept-Language` header

#### Scenario: Header fallback

- **WHEN** no preferred-language setting is configured but the `Accept-Language` header lists a supported locale
- **THEN** the request is rendered in the best-matching supported locale from the header

#### Scenario: English last resort

- **WHEN** neither the setting nor the `Accept-Language` header yields a supported locale
- **THEN** the request is rendered in English

### Requirement: Language switcher

The system SHALL present a language switcher in the application shell header on every page. Selecting a language SHALL persist that choice as the preferred-language app setting and SHALL re-render the UI in the selected locale, with the switcher reflecting the currently active locale.

#### Scenario: Switch language from the header

- **WHEN** the user selects a different language in the header switcher
- **THEN** the system persists the choice as the preferred-language setting and the UI re-renders in the selected locale

#### Scenario: Switcher reflects active locale

- **WHEN** any page loads
- **THEN** the header switcher shows the currently active locale as selected

#### Scenario: Persisted choice survives reload

- **WHEN** the user reloads or revisits the app after selecting a language
- **THEN** the previously selected locale is still active because it was persisted as a setting

### Requirement: Per-key English fallback

The system SHALL fall back to the English text for any message id that is missing or empty in the active locale's catalog, and SHALL never render a raw message id or an empty string in place of a missing translation.

#### Scenario: Missing key falls back to English

- **WHEN** a message id has no translation in the active (non-English) locale
- **THEN** the system renders that message's English text

#### Scenario: Raw keys never shown

- **WHEN** rendering the UI in any locale
- **THEN** no raw message id is ever displayed to the user

### Requirement: Community translation via Weblate

The system SHALL be translatable through a Weblate project configured against the per-locale message catalogs, using a git-based workflow (Weblate proposes translation changes back to the repository as commits/PRs). The project SHALL expose per-language translation completeness, and the repository SHALL document the contributor workflow and surface translation status.

#### Scenario: Weblate component is configured

- **WHEN** the Weblate project is set up
- **THEN** it is pointed at the message catalogs (`messages/<locale>.json`) with English as the source language and the supported locales as translation targets, syncing changes through git

#### Scenario: Translation status surfaced

- **WHEN** a contributor or maintainer views the README
- **THEN** a translation-status badge shows per-language completion derived from the Weblate project

#### Scenario: Contributor workflow documented

- **WHEN** a would-be translator reads `CONTRIBUTING.md`
- **THEN** a "Translators" section explains how to translate via Weblate, how new strings flow from the English source catalog, and how completed translations land back in the repository
