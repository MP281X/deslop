import {defineConfig} from 'vite-plus'

import {lint} from './tools/coding-standards/src/lint.ts'

export default defineConfig({
	create: {
		templates: [
			{description: 'Create a full-stack Deslop application', name: 'app', template: './tools/create-app'},
			{description: 'Create a standard Deslop package', name: 'package', template: './tools/create-package'}
		]
	},
	fmt: {
		ignorePatterns: ['**/*.gen.ts', 'packages/components-web/src/svgs/**', 'packages/components-web/src/ui/**'],

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
				{elementNamePattern: ['@deslop/**'], groupName: 'workspace', selector: 'internal'},
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
				'workspace',
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
		extends: [lint],
		// An extended config's ignorePatterns do not carry over, so the preset's generated-file ignore repeats here.
		ignorePatterns: [
			'**/*.gen.ts',
			'tools/*/template/**',
			'packages/components-web/src/svgs/**',
			'packages/components-web/src/ui/**'
		]
	},
	run: {
		tasks: {
			check: ['vp run lint', 'vp run typecheck', 'vp run fallow'],
			fallow: {
				cache: {input: [{auto: true}, '!.fallow/**', '!**/*.tsbuildinfo'], output: []},
				command: [
					'fallow dead-code --format compact --fail-on-issues',
					'fallow dead-code --production --format compact --fail-on-issues',
					'fallow health --complexity --format compact'
				]
			},
			fix: {cache: false, command: 'vp lint --fix --format agent; status=$?; vp fmt && exit $status'},
			lint: ['vp fmt --list-different', 'vp lint --format agent'],
			// The rule tests write lint fixtures while they run; tracked, those writes invalidate the task's own cache.
			test: {cache: {input: [{auto: true}, '!tools/coding-standards/.fixtures/**']}, command: 'vp test'},
			typecheck: {
				cache: {input: [{auto: true}, '!**/*.tsbuildinfo'], output: []},
				command:
					"sh -c 'TSRS_CHECKER_ASSIGNMENT=go tsrs --build . apps/*/tsconfig.json packages/*/tsconfig.json tools/*/tsconfig.json --noEmit --incremental false --force --pretty false'"
			}
		}
	},
	test: {
		environment: 'node',
		include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tools/*/src/**/*.test.ts'],
		passWithNoTests: true,
		pool: 'forks',
		reporters: ['dot'],
		silent: 'passed-only'
	}
})
