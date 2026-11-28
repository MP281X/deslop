import type {UserConfig} from 'vite-plus'

export function serverPack(heapMiB: number) {
	return {
		banner: `#!/usr/bin/env -S node --max-old-space-size=${heapMiB} --report-on-fatalerror`,
		clean: false,
		deps: {alwaysBundle: [/./u], onlyBundle: false},
		entry: ['src/server/main.ts'],
		format: 'esm',
		// The icon a server serves at /icon, as its SVG markup.
		loader: {'.svg': 'text'},
		outDir: 'dist',
		outputOptions: {entryFileNames: 'server.js'},
		platform: 'node',
		target: 'node26'
	} satisfies UserConfig['pack']
}

// The web client's build and the server pack that an app on the runtime's shell shares: the server starts at src/server.ts.
export function appBuild(heapMiB: number) {
	return {
		build: {
			chunkSizeWarningLimit: 750,
			modulePreload: {polyfill: false},
			outDir: 'dist/client',
			rolldownOptions: {output: {codeSplitting: {groups: [{name: 'effect', test: /node_modules[\\/]effect[\\/]/u}]}}},
			target: 'esnext'
		},
		pack: {...serverPack(heapMiB), entry: ['src/server.ts']}
	} satisfies UserConfig
}
