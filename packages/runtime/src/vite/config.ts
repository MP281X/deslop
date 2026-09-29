import {Config, Context, Effect, pipe} from 'effect'

import tailwindcss from '@tailwindcss/vite'
import {tanstackRouter} from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import type {UserConfig} from 'vite-plus'

import {serverPlugin} from './server.ts'

export function make() {
	return Effect.runPromiseWith(Context.empty())(
		Effect.map(
			pipe(Config.String('HOST'), Config.withDefault('0.0.0.0')),
			host =>
				({
					build: {
						chunkSizeWarningLimit: 750,
						modulePreload: {polyfill: false},
						outDir: 'dist/client',
						rolldownOptions: {experimental: {lazyBarrel: true}},
						target: 'esnext'
					},
					future: 'warn',
					pack: {
						banner:
							'#!/usr/bin/env -S node --max-old-space-size=16384 --heapsnapshot-near-heap-limit=3 --report-on-fatalerror',
						clean: false,
						entry: ['src/main.ts'],
						format: 'esm',
						outDir: 'dist',
						outputOptions: {entryFileNames: 'server.js'},
						platform: 'node',
						target: 'node26'
					},
					plugins: [
						tanstackRouter({autoCodeSplitting: true, target: 'react'}),
						react({compiler: true}),
						tailwindcss({optimize: true}),
						serverPlugin()
					],
					server: {forwardConsole: true, host, warmup: {clientFiles: ['./src/main.client.tsx']}}
				}) satisfies UserConfig
		)
	)
}
