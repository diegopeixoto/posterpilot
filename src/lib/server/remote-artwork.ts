/**
 * Bounded, redirect-aware downloader for remote raster artwork.
 *
 * This module intentionally has no `$env`, database, or framework imports so every
 * network boundary can share the same policy and the behavior stays unit-testable.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RASTER_CONTENT_TYPES = new Set([
	'image/avif',
	'image/gif',
	'image/jpeg',
	'image/png',
	'image/webp'
]);
const THEPOSTERDB_ARTWORK_HOSTS = new Set([
	'theposterdb.com',
	'www.theposterdb.com',
	'images.theposterdb.com'
]);

type PublicArtworkProviderFamily = 'fanart-tv' | 'theposterdb';

export type RemoteArtworkDownloadErrorCode =
	| 'remote_artwork_options_invalid'
	| 'remote_artwork_url_invalid'
	| 'remote_artwork_target_not_allowed'
	| 'remote_artwork_timeout'
	| 'remote_artwork_request_failed'
	| 'remote_artwork_redirect_invalid'
	| 'remote_artwork_redirect_limit'
	| 'remote_artwork_redirect_loop'
	| 'remote_artwork_response_failed'
	| 'remote_artwork_content_type_invalid'
	| 'remote_artwork_too_large'
	| 'remote_artwork_empty';

/** Stable, locale-neutral failure with no upstream URL or query-string data. */
export class RemoteArtworkDownloadError extends Error {
	constructor(readonly code: RemoteArtworkDownloadErrorCode) {
		super(code);
		this.name = 'RemoteArtworkDownloadError';
	}
}

export interface RemoteArtworkValidationContext {
	hop: number;
	redirected: boolean;
	initialUrl: URL;
	previousUrl: URL | null;
}

export type RemoteArtworkUrlValidator = (
	target: URL,
	context: RemoteArtworkValidationContext
) => boolean;

export type RemoteArtworkFetch = (
	input: RequestInfo | URL,
	init?: RequestInit
) => Promise<Response>;

export interface DownloadRemoteArtworkOptions {
	maxBytes: number;
	timeoutMs: number;
	maxRedirects?: number;
	validateUrl: RemoteArtworkUrlValidator;
	fetchImpl?: RemoteArtworkFetch;
}

export interface DownloadedRemoteArtwork {
	bytes: ArrayBuffer;
	contentType: string;
	finalUrl: string;
}

/** Normalize an explicitly supported raster MIME type, rejecting SVG and generic data. */
export function safeRasterArtworkContentType(value: string | null): string | null {
	const normalized = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
	return RASTER_CONTENT_TYPES.has(normalized) ? normalized : null;
}

/** HTTP(S), without embedded credentials; suitable for a user-supplied initial URL. */
export function safeCustomArtworkTarget(target: URL): boolean {
	return (
		(target.protocol === 'http:' || target.protocol === 'https:') &&
		!target.username &&
		!target.password
	);
}

function publicArtworkProviderFamily(target: URL): PublicArtworkProviderFamily | null {
	if ((target.protocol !== 'http:' && target.protocol !== 'https:') || target.port) return null;
	if (THEPOSTERDB_ARTWORK_HOSTS.has(target.hostname)) return 'theposterdb';
	if (target.hostname === 'fanart.tv' || target.hostname.endsWith('.fanart.tv')) {
		return 'fanart-tv';
	}
	return null;
}

function isSameHostnameHttpsUpgrade(target: URL, initialUrl: URL): boolean {
	return (
		initialUrl.protocol === 'http:' &&
		target.protocol === 'https:' &&
		target.hostname === initialUrl.hostname
	);
}

/**
 * Preserve arbitrary custom targets while allowing only narrowly compatible redirects:
 * same-origin, an HTTP-to-HTTPS upgrade on the same hostname, or HTTPS redirects inside
 * the same known public provider family. Each transition is checked against the previous
 * hop, while the provider-family exception stays anchored to the initial target so a custom
 * host cannot pivot into an allowlist.
 */
export const safeArtworkRedirectPolicy: RemoteArtworkUrlValidator = (target, context) => {
	if (!safeCustomArtworkTarget(target)) return false;
	if (!context.redirected) return true;

	const previousUrl = context.previousUrl ?? context.initialUrl;
	if (target.origin === previousUrl.origin) return true;
	if (isSameHostnameHttpsUpgrade(target, previousUrl)) return true;
	if (target.protocol !== 'https:') return false;

	const initialFamily = publicArtworkProviderFamily(context.initialUrl);
	return initialFamily !== null && publicArtworkProviderFamily(target) === initialFamily;
};

function positiveInteger(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0;
}

function requestIdentity(target: URL): string {
	const value = new URL(target);
	value.hash = '';
	return value.href;
}

function cancelBody(response: Response): void {
	try {
		void response.body?.cancel().catch(() => undefined);
	} catch {
		// Cleanup must never replace the download error being reported.
	}
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
	try {
		reader.releaseLock();
	} catch {
		// A pending read may still own the lock while cancellation settles.
	}
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
	try {
		void reader
			.cancel()
			.catch(() => undefined)
			.finally(() => releaseReader(reader));
	} catch {
		// Cancellation can also fail synchronously for an already-closed reader.
	}
}

function declaredLength(response: Response): number | null {
	const raw = response.headers.get('content-length');
	if (raw === null || !/^\d+$/.test(raw.trim())) return null;
	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Read response bytes incrementally and cancel as soon as the configured cap is exceeded. */
export async function readBoundedArtworkBody(
	response: Response,
	maxBytes: number,
	signal?: AbortSignal
): Promise<ArrayBuffer> {
	if (!positiveInteger(maxBytes)) {
		throw new RemoteArtworkDownloadError('remote_artwork_options_invalid');
	}
	const length = declaredLength(response);
	if (length !== null && length > maxBytes) {
		cancelBody(response);
		throw new RemoteArtworkDownloadError('remote_artwork_too_large');
	}
	if (!response.body) throw new RemoteArtworkDownloadError('remote_artwork_empty');

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let abortHandler: (() => void) | null = null;
	const aborted = signal
		? new Promise<never>((_resolve, reject) => {
				abortHandler = () => reject(new RemoteArtworkDownloadError('remote_artwork_timeout'));
				if (signal.aborted) abortHandler();
				else signal.addEventListener('abort', abortHandler, { once: true });
			})
		: null;
	try {
		while (true) {
			const read = reader.read();
			const { done, value } = await (aborted ? Promise.race([read, aborted]) : read);
			if (done) break;
			if (!value?.byteLength) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				cancelReader(reader);
				throw new RemoteArtworkDownloadError('remote_artwork_too_large');
			}
			chunks.push(value);
		}
	} catch (error) {
		if (signal?.aborted) {
			cancelReader(reader);
			throw new RemoteArtworkDownloadError('remote_artwork_timeout');
		}
		throw error;
	} finally {
		if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
		releaseReader(reader);
	}
	if (total === 0) throw new RemoteArtworkDownloadError('remote_artwork_empty');

	const combined = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return combined.buffer;
}

function parseTarget(value: string | URL): URL {
	try {
		return new URL(value);
	} catch {
		throw new RemoteArtworkDownloadError('remote_artwork_url_invalid');
	}
}

/** Download one validated raster image under an overall timeout and byte budget. */
export async function downloadRemoteArtwork(
	source: string | URL,
	options: DownloadRemoteArtworkOptions
): Promise<DownloadedRemoteArtwork> {
	const maxRedirects = options.maxRedirects ?? 3;
	if (
		!positiveInteger(options.maxBytes) ||
		!positiveInteger(options.timeoutMs) ||
		!Number.isSafeInteger(maxRedirects) ||
		maxRedirects < 0 ||
		typeof options.validateUrl !== 'function'
	) {
		throw new RemoteArtworkDownloadError('remote_artwork_options_invalid');
	}

	const initialUrl = parseTarget(source);
	let currentUrl = initialUrl;
	let previousUrl: URL | null = null;
	let redirects = 0;
	const seen = new Set<string>();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
	const fetchImpl = options.fetchImpl ?? fetch;
	const aborted = new Promise<never>((_resolve, reject) => {
		controller.signal.addEventListener(
			'abort',
			() => reject(new RemoteArtworkDownloadError('remote_artwork_timeout')),
			{ once: true }
		);
	});

	try {
		while (true) {
			const identity = requestIdentity(currentUrl);
			if (seen.has(identity)) {
				throw new RemoteArtworkDownloadError('remote_artwork_redirect_loop');
			}
			let allowed = false;
			try {
				allowed = options.validateUrl(currentUrl, {
					hop: redirects,
					redirected: redirects > 0,
					initialUrl,
					previousUrl
				});
			} catch {
				// A validator is part of the security boundary. Treat failure as denial
				// without allowing its error to expose a signed source URL.
				allowed = false;
			}
			if (!allowed) {
				throw new RemoteArtworkDownloadError('remote_artwork_target_not_allowed');
			}
			seen.add(identity);

			let response: Response;
			try {
				response = await Promise.race([
					fetchImpl(currentUrl, {
						redirect: 'manual',
						signal: controller.signal
					}),
					aborted
				]);
			} catch (error) {
				if (controller.signal.aborted) {
					throw new RemoteArtworkDownloadError('remote_artwork_timeout');
				}
				if (error instanceof RemoteArtworkDownloadError) throw error;
				throw new RemoteArtworkDownloadError('remote_artwork_request_failed');
			}

			if (REDIRECT_STATUSES.has(response.status)) {
				if (redirects >= maxRedirects) {
					cancelBody(response);
					throw new RemoteArtworkDownloadError('remote_artwork_redirect_limit');
				}
				const location = response.headers.get('location');
				if (!location) {
					cancelBody(response);
					throw new RemoteArtworkDownloadError('remote_artwork_redirect_invalid');
				}
				let next: URL;
				try {
					next = new URL(location, currentUrl);
				} catch {
					cancelBody(response);
					throw new RemoteArtworkDownloadError('remote_artwork_redirect_invalid');
				}
				cancelBody(response);
				previousUrl = currentUrl;
				currentUrl = next;
				redirects += 1;
				continue;
			}

			if (!response.ok) {
				cancelBody(response);
				throw new RemoteArtworkDownloadError('remote_artwork_response_failed');
			}
			const contentType = safeRasterArtworkContentType(response.headers.get('content-type'));
			if (!contentType) {
				cancelBody(response);
				throw new RemoteArtworkDownloadError('remote_artwork_content_type_invalid');
			}
			try {
				const bytes = await readBoundedArtworkBody(response, options.maxBytes, controller.signal);
				return { bytes, contentType, finalUrl: currentUrl.href };
			} catch (error) {
				if (controller.signal.aborted) {
					throw new RemoteArtworkDownloadError('remote_artwork_timeout');
				}
				if (error instanceof RemoteArtworkDownloadError) throw error;
				throw new RemoteArtworkDownloadError('remote_artwork_request_failed');
			}
		}
	} finally {
		clearTimeout(timeout);
	}
}
