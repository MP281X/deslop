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
