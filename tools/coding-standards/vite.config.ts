import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		deps: {alwaysBundle: [/.*/u], neverBundle: [/^vite-plus(?:\/|$)/u], onlyBundle: false},
		dts: {generator: 'oxc'},
		// Node refuses to strip types under node_modules, so the published entries are built.
		entry: ['src/lint.ts', 'src/main.cli.ts'],
		outputOptions: {entryFileNames: '[name].js'}
	}
})
