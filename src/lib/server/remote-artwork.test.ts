import { describe, expect, it, vi } from 'vitest';
import {
	downloadRemoteArtwork,
	RemoteArtworkDownloadError,
	sameOriginCustomArtworkPolicy,
	type RemoteArtworkFetch,
	type RemoteArtworkUrlValidator
} from './remote-artwork';

const allowHttps: RemoteArtworkUrlValidator = (target) =>
	target.protocol === 'https:' && !target.username && !target.password;

function response(bytes: number[], init: ResponseInit = {}): Response {
	return new Response(new Uint8Array(bytes), {
		...init,
		headers: { 'content-type': 'image/jpeg', ...init.headers }
	});
}

function code(error: unknown): string | undefined {
	return error instanceof RemoteArtworkDownloadError ? error.code : undefined;
}

describe('downloadRemoteArtwork', () => {
	it('streams a raster response and normalizes its content type', async () => {
		const fetchImpl = vi.fn(async () =>
			response([1, 2, 3], { headers: { 'content-type': 'IMAGE/WEBP; charset=binary' } })
		);
		const result = await downloadRemoteArtwork('https://images.example/poster.webp', {
			maxBytes: 3,
			timeoutMs: 1_000,
			validateUrl: allowHttps,
			fetchImpl
		});

		expect(new Uint8Array(result.bytes)).toEqual(new Uint8Array([1, 2, 3]));
		expect(result.contentType).toBe('image/webp');
		expect(result.finalUrl).toBe('https://images.example/poster.webp');
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL('https://images.example/poster.webp'),
			expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) })
		);
	});

	it('rejects an oversized declared response before reading it', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1]));
			}
		});
		const fetchImpl = vi.fn(
			async () =>
				new Response(body, {
					headers: { 'content-type': 'image/jpeg', 'content-length': '101' }
				})
		);

		await expect(
			downloadRemoteArtwork('https://images.example/large.jpg', {
				maxBytes: 100,
				timeoutMs: 1_000,
				validateUrl: allowHttps,
				fetchImpl
			})
		).rejects.toSatisfy((error: unknown) => code(error) === 'remote_artwork_too_large');
	});

	it('cancels a chunked response as soon as its accumulated bytes exceed the limit', async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2, 3]));
				controller.enqueue(new Uint8Array([4, 5, 6]));
			},
			cancel() {
				cancelled = true;
			}
		});
		const fetchImpl = vi.fn(
			async () => new Response(body, { headers: { 'content-type': 'image/png' } })
		);

		await expect(
			downloadRemoteArtwork('https://images.example/chunked.png', {
				maxBytes: 5,
				timeoutMs: 1_000,
				validateUrl: allowHttps,
				fetchImpl
			})
		).rejects.toSatisfy((error: unknown) => code(error) === 'remote_artwork_too_large');
		expect(cancelled).toBe(true);
	});

	it.each(['text/html', 'image/svg+xml', 'application/octet-stream', null])(
		'rejects unsupported content type %s before consuming the body',
		async (contentType) => {
			let cancelled = false;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1]));
				},
				cancel() {
					cancelled = true;
				}
			});
			const headers = contentType ? { 'content-type': contentType } : undefined;
			const fetchImpl = vi.fn(async () => new Response(body, { headers }));

			await expect(
				downloadRemoteArtwork('https://images.example/not-raster', {
					maxBytes: 10,
					timeoutMs: 1_000,
					validateUrl: allowHttps,
					fetchImpl
				})
			).rejects.toSatisfy(
				(error: unknown) => code(error) === 'remote_artwork_content_type_invalid'
			);
			expect(cancelled).toBe(true);
		}
	);

	it('rejects a successful raster response with an empty body', async () => {
		await expect(
			downloadRemoteArtwork('https://images.example/empty.jpg', {
				maxBytes: 10,
				timeoutMs: 1_000,
				validateUrl: allowHttps,
				fetchImpl: async () => response([])
			})
		).rejects.toSatisfy((error: unknown) => code(error) === 'remote_artwork_empty');
	});

	it('uses one timeout for the whole request, including body streaming', async () => {
		vi.useFakeTimers();
		try {
			const fetchImpl: RemoteArtworkFetch = async (_input, init) => {
				const signal = init?.signal;
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						signal?.addEventListener('abort', () =>
							controller.error(new DOMException('Aborted', 'AbortError'))
						);
					}
				});
				return new Response(body, { headers: { 'content-type': 'image/jpeg' } });
			};
			const pending = downloadRemoteArtwork('https://images.example/slow.jpg', {
				maxBytes: 10,
				timeoutMs: 50,
				validateUrl: allowHttps,
				fetchImpl
			});
			const assertion = expect(pending).rejects.toSatisfy(
				(error: unknown) => code(error) === 'remote_artwork_timeout'
			);
			await vi.advanceTimersByTimeAsync(50);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it('enforces the timeout even when the fetch implementation ignores its signal', async () => {
		vi.useFakeTimers();
		try {
			const pending = downloadRemoteArtwork('https://images.example/stuck.jpg', {
				maxBytes: 10,
				timeoutMs: 50,
				validateUrl: allowHttps,
				fetchImpl: async () => new Promise<Response>(() => undefined)
			});
			const assertion = expect(pending).rejects.toSatisfy(
				(error: unknown) => code(error) === 'remote_artwork_timeout'
			);
			await vi.advanceTimersByTimeAsync(50);
			await assertion;
		} finally {
			vi.useRealTimers();
		}
	});

	it('follows validated redirects and resolves relative locations', async () => {
		const fetchImpl = vi
			.fn<RemoteArtworkFetch>()
			.mockResolvedValueOnce(
				new Response(null, { status: 302, headers: { location: '/final.jpg' } })
			)
			.mockResolvedValueOnce(response([7, 8]));
		const result = await downloadRemoteArtwork('https://images.example/start.jpg', {
			maxBytes: 10,
			timeoutMs: 1_000,
			validateUrl: allowHttps,
			fetchImpl
		});

		expect(result.finalUrl).toBe('https://images.example/final.jpg');
		expect(fetchImpl.mock.calls.map(([target]) => target.toString())).toEqual([
			'https://images.example/start.jpg',
			'https://images.example/final.jpg'
		]);
	});

	it('rejects a cross-origin redirect before requesting its target', async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: { location: 'http://127.0.0.1/private' }
				})
		);

		await expect(
			downloadRemoteArtwork('https://images.example/start.jpg', {
				maxBytes: 10,
				timeoutMs: 1_000,
				validateUrl: sameOriginCustomArtworkPolicy,
				fetchImpl
			})
		).rejects.toSatisfy((error: unknown) => code(error) === 'remote_artwork_target_not_allowed');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('detects a redirect loop without repeating a request', async () => {
		const fetchImpl = vi.fn(
			async () => new Response(null, { status: 302, headers: { location: '/start.jpg#again' } })
		);

		await expect(
			downloadRemoteArtwork('https://images.example/start.jpg', {
				maxBytes: 10,
				timeoutMs: 1_000,
				validateUrl: allowHttps,
				fetchImpl
			})
		).rejects.toSatisfy((error: unknown) => code(error) === 'remote_artwork_redirect_loop');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it('enforces the redirect cap', async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const current = new URL(input instanceof Request ? input.url : input.toString());
			return new Response(null, {
				status: 302,
				headers: { location: `/hop-${Number(current.pathname.match(/\d+/)?.[0] ?? 0) + 1}.jpg` }
			});
		});

		await expect(
			downloadRemoteArtwork('https://images.example/hop-0.jpg', {
				maxBytes: 10,
				timeoutMs: 1_000,
				maxRedirects: 2,
				validateUrl: allowHttps,
				fetchImpl
			})
		).rejects.toSatisfy((error: unknown) => code(error) === 'remote_artwork_redirect_limit');
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('never includes a signed source URL in an error message', async () => {
		const signed = 'https://images.example/poster.jpg?token=top-secret';
		const error = await downloadRemoteArtwork(signed, {
			maxBytes: 10,
			timeoutMs: 1_000,
			validateUrl: allowHttps,
			fetchImpl: async () => new Response(null, { status: 500 })
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RemoteArtworkDownloadError);
		expect(String(error)).not.toContain('top-secret');
		expect(String(error)).not.toContain(signed);
	});

	it('sanitizes failures raised while streaming a response body', async () => {
		const secret = 'signed-token-value';
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new Error(secret));
			}
		});
		const error = await downloadRemoteArtwork('https://images.example/poster.jpg', {
			maxBytes: 10,
			timeoutMs: 1_000,
			validateUrl: allowHttps,
			fetchImpl: async () => new Response(body, { headers: { 'content-type': 'image/jpeg' } })
		}).catch((caught: unknown) => caught);

		expect(code(error)).toBe('remote_artwork_request_failed');
		expect(String(error)).not.toContain(secret);
	});
});
