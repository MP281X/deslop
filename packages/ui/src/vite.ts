import {String} from 'effect'

import tailwindcss from '@tailwindcss/vite'
import type {UserConfig} from 'vite-plus'

import {serverPack} from '@deslop/runtime/config/vite'

const VIEWPORT_TAG = /<meta\s+name="viewport"[^>]*>/iu
const MOBILE_CAPABLE_TAG = /<meta\s+name="apple-mobile-web-app-capable"[^>]*>/iu

export function webConfig(heapMiB: number) {
	return {
		build: {
			chunkSizeWarningLimit: 750,
			modulePreload: {polyfill: false},
			outDir: 'dist/client',
			rolldownOptions: {output: {codeSplitting: {groups: [{name: 'effect', test: /node_modules[\\/]effect[\\/]/u}]}}},
			target: 'esnext'
		},
		pack: serverPack(heapMiB),
		plugins: [
			tailwindcss({optimize: true}),
			{
				name: 'deslop-installed-viewport',
				transformIndexHtml: {
					handler: html => ({
						html: String.replace(VIEWPORT_TAG, '')(String.replace(MOBILE_CAPABLE_TAG, '')(html)),
						tags: [
							{
								attrs: {
									content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
									name: 'viewport'
								},
								injectTo: 'head-prepend',
								tag: 'meta'
							},
							{attrs: {content: 'yes', name: 'apple-mobile-web-app-capable'}, injectTo: 'head', tag: 'meta'}
						]
					}),
					order: 'pre'
				}
			}
		],
		run: {tasks: {build: {command: 'vp build && vp pack'}}}
	} satisfies UserConfig
}
