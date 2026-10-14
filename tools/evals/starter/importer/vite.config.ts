import {oxlint} from '@deslop/coding-standards'
import {defineConfig} from 'vite-plus'

export default defineConfig({
	fmt: {
		arrowParens: 'avoid',
		bracketSpacing: false,
		ignorePatterns: ['.claude/**', '.codex/**'],
		objectWrap: 'collapse',
		printWidth: 120,
		semi: false,
		singleQuote: true,
		trailingComma: 'none',
		useTabs: true
	},
	lint: {env: {node: true}, extends: [oxlint]},
	test: {include: ['src/**/*.test.ts'], passWithNoTests: true}
})
