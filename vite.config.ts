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
		ignorePatterns: ['**/*.gen.ts', 'packages/components-web/src/ui/**'],

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
		ignorePatterns: ['**/*.gen.ts', 'packages/components-web/src/ui/**'],
		overrides: [
			{
				// React Native styles are objects with no Tailwind classes to check.
				files: ['apps/{opm,stash,trips}/**', 'packages/components-mobile/**', 'tools/create-app/template/mobile/**'],
				rules: {
					'shadcn/no-arbitrary-values': 'off',
					'shadcn/no-inline-styles': 'off',
					'shadcn/no-raw-colors': 'off',
					'shadcn/no-restyle': 'off',
					'shadcn/no-unknown-classes': 'off',
					'shadcn/require-static-classes': 'off'
				}
			}
		]
	},
	run: {
		tasks: {
			check: ['vp run lint', 'vp run typecheck', 'vp run fallow'],
			fallow: {
				cache: {input: [{auto: true}, '!.fallow/**', '!**/*.tsbuildinfo'], output: []},
				command: [
					'fallow dead-code --format compact --fail-on-issues --quiet',
					'fallow dead-code --production --format compact --fail-on-issues --quiet',
					'fallow dupes --format compact --fail-on-issues --quiet',
					'fallow health --complexity --format human --quiet'
				]
			},
			fix: {cache: false, command: 'vp lint --fix --format agent; status=$?; vp fmt && exit $status'},
			lint: {
				cache: {input: [{auto: true}, '!**/*.tsbuildinfo'], output: []},
				command: ['vp fmt --list-different', 'vp lint --format agent']
			},
			test: 'vp test',
			typecheck: {
				cache: {input: [{auto: true}, '!**/*.tsbuildinfo'], output: []},
				command:
					"sh -c 'TSRS_CHECKER_ASSIGNMENT=go tsrs --build apps/*/tsconfig.json packages/*/tsconfig.json tools/*/tsconfig.json --force --pretty false'"
			}
		}
	},
	test: {
		// Each project's testTimeout is the only limit; no-test-timeout keeps tests from raising their own.
		projects: [
			{
				extends: true,
				test: {
					exclude: ['**/*.slow.test.ts'],
					include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tools/*/src/**/*.test.ts'],
					name: 'unit',
					testTimeout: 30_000
				}
			},
			{
				extends: true,
				test: {
					include: [
						'apps/*/src/**/*.slow.test.ts',
						'packages/*/src/**/*.slow.test.ts',
						'tools/*/src/**/*.slow.test.ts'
					],
					name: 'slow',
					testTimeout: 300_000
				}
			}
		],
		reporters: ['dot'],
		silent: 'passed-only'
	}
})
