# poster-providers — delta

## ADDED Requirements

### Requirement: Optional ThePosterDB authenticated session
The ThePosterDB provider SHALL support optional account credentials (username +
password). When configured, discovery SHALL authenticate via the site's login form
(CSRF token scraped from the form), cache the session in memory with a TTL below the
observed cookie lifetime, deduplicate concurrent logins, and retry once with a fresh
session when a scrape returns empty. When credentials are absent, the provider SHALL
continue anonymous scraping exactly as today — credentials MUST NOT be required for
the provider to be available. A rejected login SHALL surface as a typed error and
never crash discovery of other providers.

#### Scenario: Authenticated discovery
- **WHEN** credentials are configured and discovery runs
- **THEN** requests carry the authenticated session and results include assets that anonymous access would serve as placeholders

#### Scenario: Anonymous fallback
- **WHEN** no credentials are configured
- **THEN** the provider stays available and scrapes anonymously as before

#### Scenario: Rejected credentials
- **WHEN** the site rejects the configured credentials
- **THEN** the provider reports a typed auth failure for its own results only, and other providers' discovery is unaffected

### Requirement: ThePosterDB candidates carry real set identity
ThePosterDB candidates parsed from a title page SHALL be keyed by the contributor's
real set id (`/set/<id>`) with the contributor's name as set author, deduplicating
the webp/jpg pair of each image. Result selection SHALL keep the strict title/year
matching semantics already specified (wrong year → no result rather than a wrong
film). When set markup cannot be parsed, the provider SHALL fall back to the flat
scrape rather than returning nothing.

#### Scenario: Set identity preserved
- **WHEN** a title page lists posters from two contributors
- **THEN** candidates carry two distinct real set ids with their authors, one candidate per image

#### Scenario: Markup drift falls back
- **WHEN** the contributor-card markup fails to parse
- **THEN** the provider falls back to the flat asset scrape

### Requirement: ThePosterDB collection sets map onto members
For a native collection, the system SHALL be able to discover ThePosterDB collection
sets by collection name, open a bounded number of contributor sets (best member
coverage wins), match set posters to collection members via tiered matching (exact
normalized title with year disambiguation, then token-subset, then equal-year), and
inject matched posters as ordinary per-member candidates keyed by the real set id so
the existing set-family engine can surface one coordinated design. Failures SHALL be
logged and produce empty results without affecting other providers' candidates.

#### Scenario: Coordinated collection design
- **WHEN** a ThePosterDB collection set covers most members of a native collection
- **THEN** each covered member gains a candidate from that set and the set family is offered across the collection

#### Scenario: No matching set
- **WHEN** no collection set matches the members
- **THEN** the collection's existing TMDB candidates are unaffected and no wrong-title artwork is injected

### Requirement: Concurrent discovery writes never fail on contention
Provider discovery SHALL be able to run concurrently for several providers without
database writes failing on `SQLITE_BUSY`: the database runs in WAL mode (file-backed
databases only) and discovery/event writes are serialized through an in-process
write queue.

#### Scenario: Parallel discovery is contention-safe
- **WHEN** multiple providers write discovery results concurrently
- **THEN** all writes land and no request fails with a database-locked error
