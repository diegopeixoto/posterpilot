-- Scraped provider pages (MediUX listings, ThePosterDB search/set pages) used to be cached
-- whole: ~12,000 HTML pages, 4.4 GB, in three days on one install. Discovery now caches
-- only each page's parsed result under a different key, so these rows are never read again.
-- Drop them now rather than waiting for the 30-day prune. JSON API responses are kept.
-- The file shrinks only after a VACUUM; the freed pages are reused until then.
DELETE FROM `http_cache` WHERE `body` LIKE '<!DOCTYPE%' OR `body` LIKE '<html%';
