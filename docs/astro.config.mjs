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
