## ADDED Requirements

### Requirement: Cached poster-thumbnail endpoint keyed by item id

The system SHALL provide an endpoint that serves an item's poster as a grid-sized image, addressed
by **item id** (never by a client-supplied URL). The endpoint SHALL resolve the media-server poster
URL **server-side**, so the media-server token or API key is never exposed to the client and there is
no server-side request-forgery surface. Served bytes SHALL carry long-lived, immutable cache headers.

#### Scenario: Poster served by id

- **WHEN** the grid requests the poster thumbnail for an item id
- **THEN** the system returns the item's poster image, resolving the media-server URL server-side, and
  the response does not expose the media-server token or API key

#### Scenario: No client-supplied URL

- **WHEN** the poster-thumbnail endpoint is called
- **THEN** it accepts only an item id (not an arbitrary URL), so it cannot be coerced into fetching an
  unintended host

#### Scenario: Missing poster

- **WHEN** the requested item has no current poster
- **THEN** the endpoint responds so the grid can show its "no poster" placeholder rather than a broken
  image

### Requirement: Server-side resize without an image-processing dependency

The system SHALL obtain a grid-sized image by requesting a resized render **from the media server
itself** (e.g. Plex photo transcode, Emby/Jellyfin image `fillWidth`), rather than resizing in-process,
so no image-processing dependency is required. When a backend cannot produce a resized image, the
system SHALL fall back to the full-size image (still cached).

#### Scenario: Resized by the media server

- **WHEN** a poster thumbnail is fetched for the grid
- **THEN** the system requests a grid-sized render from the active media server and serves that,
  without an in-process image-resizing step

#### Scenario: Resize-unsupported fallback

- **WHEN** the active media server cannot produce a resized render
- **THEN** the system serves and caches the full-size image instead of failing

### Requirement: Reuse the on-disk thumbnail cache

The system SHALL cache resized poster bytes using the existing on-disk thumbnail cache (TTL freshness
and total-size LRU eviction), so a given item+size is fetched from the media server once and served
from disk thereafter.

#### Scenario: Cache hit on revisit

- **WHEN** a poster thumbnail that was previously fetched is requested again within its TTL
- **THEN** the system serves it from the on-disk cache without contacting the media server

#### Scenario: Bounded by the cache budget

- **WHEN** the thumbnail cache exceeds its configured size budget
- **THEN** the least-recently-used entries are evicted, sharing the existing cache bound
