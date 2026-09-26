import {defineConfig} from 'vite-plus'

export default defineConfig({
	pack: {
		// Node refuses to strip types under node_modules, so the published entries are built.
		deps: {alwaysBundle: [/.*/u]},
		dts: true,
		entry: ['src/oxlint.ts'],
		outputOptions: {entryFileNames: '[name].js'}
	}
})
