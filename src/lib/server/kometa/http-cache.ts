export const PRIVATE_NO_STORE_HEADERS = Object.freeze({
	'cache-control': 'private, no-store'
});

/** Ensure sensitive Kometa responses, including error paths, are never shared or cached. */
export function privateNoStore(response: Response): Response {
	response.headers.set('cache-control', 'private, no-store');
	return response;
}
