import tailwindcss from '@tailwindcss/vite'
import {tanstackRouter} from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import type {UserConfig} from 'vite-plus'

export const pack = {
	banner: '#!/usr/bin/env -S node --max-old-space-size=16384 --heapsnapshot-near-heap-limit=3 --report-on-fatalerror',
	clean: false,
	deps: {alwaysBundle: [/./u], onlyBundle: false},
	entry: ['src/main.server.ts'],
	format: 'esm',
	// The icon a server serves at /icon, as its SVG markup.
	loader: {'.svg': 'text'},
	outDir: 'dist',
	outputOptions: {entryFileNames: 'server.js'},
	platform: 'node',
	target: 'node26'
} satisfies UserConfig['pack']

export const config = {
	build: {
		chunkSizeWarningLimit: 750,
		modulePreload: {polyfill: false},
		outDir: 'dist/client',
		rolldownOptions: {
			experimental: {lazyBarrel: true},
			// The largest libraries get their own chunks, which stay cached across releases that only change the app.
			output: {
				codeSplitting: {
					groups: [
						{name: 'effect', test: /node_modules[\\/]effect[\\/]/u},
						{name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/u},
						{name: 'three', test: /node_modules[\\/]three[\\/]/u}
					]
				}
			}
		},
		target: 'esnext'
	},
	future: 'warn',
	pack,
	plugins: [
		// Its scratch files stay out of the checkout, as the app generator's do.
		tanstackRouter({autoCodeSplitting: true, target: 'react', tmpDir: 'node_modules/.cache/tanstack'}),
		react({compiler: true}),
		tailwindcss({optimize: true})
	]
} satisfies UserConfig
