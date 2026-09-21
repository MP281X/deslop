import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		// Node refuses to strip types under node_modules, so the published entries are built.
		banner: context => (context.fileName === 'install.js' ? '#!/usr/bin/env node' : undefined),
		deps: {alwaysBundle: [/.*/u]},
		entry: ['src/install.ts', 'src/oxlint.ts'],
		format: 'esm',
		outDir: 'dist',
		outputOptions: {entryFileNames: '[name].js'},
		platform: 'node',
		target: 'node26'
	}
})
