import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		banner: '#!/usr/bin/env node',
		deps: {alwaysBundle: [/.*/u]},
		entry: ['src/main.ts'],
		format: 'esm',
		outDir: 'dist',
		outputOptions: {entryFileNames: 'main.js'},
		platform: 'node',
		target: 'node26'
	}
})
