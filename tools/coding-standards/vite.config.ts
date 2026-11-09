import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		// oxc-parser loads its native binding by name at run time, so it stays a dependency.
		deps: {alwaysBundle: [/.*/u], neverBundle: [/^vite-plus(?:\/|$)/u, /^oxc-parser$/u], onlyBundle: false},
		dts: {generator: 'oxc'},
		// Node refuses to strip types under node_modules, so the published entries are built.
		entry: ['src/lint.ts', 'src/main.cli.ts'],
		outputOptions: {entryFileNames: '[name].js'}
	}
})
