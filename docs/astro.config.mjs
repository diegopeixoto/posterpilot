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
					label: 'Start here',
					translations: {
						es: 'Primeros pasos',
						zh: '从这里开始',
						ja: 'はじめに',
						'pt-BR': 'Comece aqui'
					},
					items: [
						{
							label: 'Overview',
							translations: { es: 'Resumen', zh: '概览', ja: '概要', 'pt-BR': 'Visão geral' },
							link: '/'
						},
						{
							label: 'Installation',
							translations: {
								es: 'Instalación',
								zh: '安装',
								ja: 'インストール',
								'pt-BR': 'Instalação'
							},
							link: '/installation/'
						},
						{
							label: 'Configuration',
							translations: {
								es: 'Configuración',
								zh: '配置',
								ja: '設定',
								'pt-BR': 'Configuração'
							},
							link: '/configuration/'
						},
						{
							label: 'Usage',
							translations: { es: 'Uso', zh: '使用', ja: '使い方', 'pt-BR': 'Uso' },
							link: '/usage/'
						}
					]
				},
				{
					label: 'Guides',
					translations: { es: 'Guías', zh: '指南', ja: 'ガイド', 'pt-BR': 'Guias' },
					items: [
						{
							label: 'Safety and undo',
							translations: {
								es: 'Seguridad y deshacer',
								zh: '安全与撤销',
								ja: '安全性と元に戻す',
								'pt-BR': 'Segurança e desfazer'
							},
							link: '/safety/'
						},
						{
							label: 'Automation and recovery',
							translations: {
								es: 'Automatización y recuperación',
								zh: '自动化与恢复',
								ja: '自動化と復旧',
								'pt-BR': 'Automação e recuperação'
							},
							link: '/automation-recovery/'
						},
						{
							label: 'FUN and collections',
							translations: {
								es: 'FUN y colecciones',
								zh: 'FUN 与合集',
								ja: 'FUN とコレクション',
								'pt-BR': 'FUN e coleções'
							},
							link: '/fun-collections/'
						},
						{
							label: 'Multi-server migration',
							translations: {
								es: 'Migración multiservidor',
								zh: '多服务器迁移',
								ja: '複数サーバー移行',
								'pt-BR': 'Migração multi-servidor'
							},
							link: '/multi-server-migration/'
						},
						{
							label: 'Kometa manager',
							translations: {
								es: 'Gestor de Kometa',
								zh: 'Kometa 管理器',
								ja: 'Kometa マネージャー',
								'pt-BR': 'Gerenciador do Kometa'
							},
							link: '/kometa-config-sync/'
						}
					]
				},
				{
					label: 'Project',
					translations: { es: 'Proyecto', zh: '项目', ja: 'プロジェクト', 'pt-BR': 'Projeto' },
					items: [
						{
							label: 'Contributing',
							translations: {
								es: 'Contribuir',
								zh: '贡献',
								ja: 'コントリビューション',
								'pt-BR': 'Contribuindo'
							},
							link: '/contributing/'
						},
						{
							label: 'Translating',
							translations: { es: 'Traducir', zh: '翻译', ja: '翻訳', 'pt-BR': 'Tradução' },
							link: '/translating/'
						}
					]
				}
			]
		})
	]
});
