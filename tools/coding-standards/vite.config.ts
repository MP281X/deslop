import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		// Node refuses to strip types under node_modules, so the published entries are built.
		deps: {alwaysBundle: [/.*/u], neverBundle: [/^vite-plus(?:\/|$)/u], onlyBundle: false},
		dts: {generator: 'oxc'},
		entry: ['src/lint.ts', 'src/main.cli.ts'],
		outputOptions: {entryFileNames: '[name].js'}
	}
})
