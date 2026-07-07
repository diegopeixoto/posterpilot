// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Active UI locale resolved per request by the Paraglide handle hook. */
			locale: import('$lib/i18n/resolve').Locale;
			/** Whether the request is authenticated (or auth is disabled / locally bypassed). */
			authed: boolean;
			/** The authenticated username, or null when unauthenticated / auth disabled. */
			authUser: string | null;
			/** Effective auth mode for this request (for the UI to show the logout control). */
			authMode: import('$lib/server/config').AuthMode;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
