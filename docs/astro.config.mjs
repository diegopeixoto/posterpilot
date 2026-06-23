// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	// GitHub project Pages: served under https://<user>.github.io/<repo>/.
	// If the site later moves to a user/custom domain, change `site` to the new
	// origin and set `base` to '/' (or remove it).
	site: 'https://diegopeixoto.github.io',
	base: '/posterpilot',
	integrations: [
		starlight({
			title: 'PosterPilot',
			description:
				'Self-hosted web app to browse a Plex/Jellyfin/Emby library, find artwork covers across multiple providers, and apply them to your media server and/or via Kometa YAML.',
			// Match the app's locales. English is the root locale, so it stays at
			// /posterpilot/ with no /en prefix; the others get a /<locale>/ prefix.
			// Starlight adds a language picker to the header automatically and falls
			// back to the default locale for any untranslated page.
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				es: { label: 'Español', lang: 'es' },
				zh: { label: '简体中文', lang: 'zh' },
				ja: { label: '日本語', lang: 'ja' },
				'pt-br': { label: 'Português (BR)', lang: 'pt-BR' }
			},
			logo: {
				light: './src/assets/logo-light.png',
				dark: './src/assets/logo-dark.png',
				replacesTitle: true,
				alt: 'PosterPilot'
			},
			favicon: '/favicon.svg',
			lastUpdated: true,
			components: {
				Footer: './src/components/Footer.astro'
			},
			head: [
				{ tag: 'link', attrs: { rel: 'icon', href: '/favicon.ico', sizes: '32x32' } },
				{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } }
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/diegopeixoto/posterpilot'
				}
			],
			editLink: {
				baseUrl: 'https://github.com/diegopeixoto/posterpilot/edit/main/docs/'
			},
			sidebar: [
				{
					label: 'Overview',
					link: '/'
				},
				{
					label: 'Installation',
					link: '/installation/'
				},
				{
					label: 'Configuration',
					link: '/configuration/'
				},
				{
					label: 'Usage',
					link: '/usage/'
				},
				{
					label: 'Contributing',
					link: '/contributing/'
				},
				{
					label: 'Translating',
					link: '/translating/'
				}
			]
		})
	]
});
