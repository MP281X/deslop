import {VitePWA} from 'vite-plugin-pwa'

import * as ViteConfig from '@deslop/runtime/vite'

const config = await ViteConfig.make()

export default {
	...config,
	define: {'import.meta.env.VITE_OTEL_URL': 'location.origin'},
	plugins: [
		...config.plugins,
		VitePWA({
			injectRegister: 'script-defer',
			manifest: {
				background_color: '#19191d',
				description: 'A private inbox for links and thoughts.',
				display: 'standalone',
				icons: [
					{sizes: '192x192', src: '/icon-192.png', type: 'image/png'},
					{purpose: 'any maskable', sizes: '512x512', src: '/icon-512.png', type: 'image/png'}
				],
				id: '/',
				name: 'Notes',
				scope: '/',
				share_target: {action: '/', method: 'GET', params: {text: 'text', title: 'title', url: 'url'}},
				short_name: 'Notes',
				start_url: '/',
				theme_color: '#19191d'
			},
			registerType: 'autoUpdate',
			workbox: {
				globPatterns: ['**/*.{js,css,html,png,woff2}'],
				maximumFileSizeToCacheInBytes: 4000000,
				navigateFallbackDenylist: [/^\/api\//u]
			}
		})
	]
}
