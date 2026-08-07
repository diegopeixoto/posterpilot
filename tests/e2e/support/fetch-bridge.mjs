const fixtureOrigin = 'https://api.mediux.pro';
const fixturePrefix = '/e2e-assets/';
const localOrigin = process.env.POSTERPILOT_E2E_ASSET_ORIGIN;

if (!localOrigin) {
	throw new Error('POSTERPILOT_E2E_ASSET_ORIGIN is required by the E2E fetch bridge.');
}

const nativeFetch = globalThis.fetch;

/**
 * Keep provider URLs realistic while serving deterministic bytes offline. The
 * application still validates the original api.mediux.pro URL before this
 * test-process-only transport bridge maps the request to the fake server.
 */
globalThis.fetch = (input, init) => {
	const source = new URL(input instanceof Request ? input.url : input);
	if (source.origin !== fixtureOrigin || !source.pathname.startsWith(fixturePrefix)) {
		return nativeFetch(input, init);
	}

	const target = new URL(localOrigin);
	target.pathname = `/assets/${source.pathname.slice(fixturePrefix.length)}`;
	target.search = source.search;
	const mapped = input instanceof Request ? new Request(target, input) : target;
	return nativeFetch(mapped, init);
};
