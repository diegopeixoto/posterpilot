# i18n — delta

## MODIFIED Requirements

### Requirement: Supported locales

The system SHALL support a fixed set of UI locales — English (`en`), Spanish (`es`), Simplified Chinese (`zh`), Japanese (`ja`), Brazilian Portuguese (`pt-BR`), and French (`fr`) — with English as the base (source) locale and the default. The set of supported locales SHALL be the single source of truth used by both the locale resolver and the language switcher, so the two can never offer or resolve a locale that is not translated.

#### Scenario: All supported locales are selectable

- **WHEN** the language switcher is rendered
- **THEN** it offers exactly the supported locales — English, Spanish, Simplified Chinese, Japanese, Brazilian Portuguese, and French — each labeled in its own language

#### Scenario: English is the base locale

- **WHEN** no other locale can be resolved for a request
- **THEN** the system renders the UI in English

#### Scenario: Unknown locale is not honored

- **WHEN** a locale value outside the supported set is supplied (e.g. via a stale setting or a crafted request)
- **THEN** the system ignores it and continues resolving as if it were absent, never rendering an unsupported locale

#### Scenario: French catalog at parity

- **WHEN** a message key exists in the English catalog
- **THEN** `messages/fr.json` contains a French translation for it, keeping all six catalogs at key parity
