import {defineConfig} from 'vite-plus'

import {oxlint} from '@deslop/workflow'

export default defineConfig({
	create: {
		templates: [
			{name: 'app', description: 'Create a full-stack Deslop application', template: './tools/create-app'},
			{name: 'package', description: 'Create a standard Deslop package', template: './tools/create-package'}
		]
	},
	fmt: {
		ignorePatterns: [
			'**/*.gen.ts',
			'packages/components/src/components/svgs/**',
			'packages/components/src/components/ui/**'
		],

		arrowParens: 'avoid',
		bracketSpacing: false,
		objectWrap: 'collapse',
		printWidth: 120,
		semi: false,
		singleQuote: true,
		sortPackageJson: {sortScripts: true},
		trailingComma: 'none',
		useTabs: true,

		sortTailwindcss: {functions: ['cn']},

		sortImports: {
			customGroups: [
				{elementNamePattern: ['@effect/**'], groupName: 'effectPackages', selector: 'external'},
				{elementNamePattern: ['effect'], groupName: 'effect', selector: 'external'},
				{elementNamePattern: ['@deslop/**'], groupName: 'aiToolkit', selector: 'external'},
				{elementNamePattern: ['@/**', '#*', '~/**'], groupName: 'aliases', selector: 'internal'}
			],
			groups: [
				['side_effect', 'side_effect_style'],
				{newlinesBetween: true},
				'builtin',
				{newlinesBetween: true},
				'effectPackages',
				'effect',
				{newlinesBetween: true},
				'external',
				{newlinesBetween: true},
				'aiToolkit',
				{newlinesBetween: true},
				'aliases',
				{newlinesBetween: true},
				'parent',
				'sibling',
				'index'
			],
			internalPattern: ['@/', '~/', '#', '@deslop/']
		}
	},
	lint: {
		env: {browser: true, builtin: true, node: true},
		extends: [oxlint],
		ignorePatterns: [
			'**/*.gen.ts',
			'tools/*/template/**',
			'tools/workflow/src/agents/**',
			'packages/components/src/components/svgs/**',
			'packages/components/src/components/ui/**'
		],
		jsPlugins: [{name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin'}],
		rules: {'vite-plus/prefer-vite-plus-imports': 'error'}
	},
	test: {
		environment: 'node',
		include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tools/*/src/**/*.test.ts'],
		passWithNoTests: true,
		pool: 'forks'
	}
})
