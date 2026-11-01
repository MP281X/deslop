import tailwindcss from '@tailwindcss/vite'
import {tanstackRouter} from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import type {UserConfig} from 'vite-plus'

export const pack = {
	banner: '#!/usr/bin/env -S node --max-old-space-size=16384 --heapsnapshot-near-heap-limit=3 --report-on-fatalerror',
	clean: false,
	deps: {alwaysBundle: [/./u]},
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
		rolldownOptions: {experimental: {lazyBarrel: true}},
		target: 'esnext'
	},
	future: 'warn',
	pack,
	plugins: [
		tanstackRouter({autoCodeSplitting: true, target: 'react'}),
		react({compiler: true}),
		tailwindcss({optimize: true})
	]
} satisfies UserConfig
