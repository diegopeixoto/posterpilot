## MODIFIED Requirements

### Requirement: Resilient discovery

The system SHALL isolate provider failures so that an error, timeout, or unparseable response from one provider does not prevent the others from returning candidates. When an upstream provider responds with a rate-limit or unavailable status (429 or 503) that carries a `Retry-After` header, the system SHALL wait at least the indicated delay (bounded by a maximum) before its next retry attempt, instead of retrying on a fixed backoff schedule alone.

#### Scenario: One provider fails

- **WHEN** one enabled provider errors or returns an unparseable response during discovery
- **THEN** the system records that provider's failure, skips it, and still stores the candidates from the providers that succeeded

#### Scenario: Retry-After is honored

- **WHEN** a provider request receives a 429 or 503 with a `Retry-After` header
- **THEN** the system delays the next retry by at least the header's indicated time (up to a maximum cap) rather than the default backoff

#### Scenario: Missing or invalid Retry-After falls back to backoff

- **WHEN** a retryable response has no `Retry-After` header or an unparseable one
- **THEN** the system retries on its normal exponential backoff schedule
