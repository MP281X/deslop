// oxlint-disable-next-line effecttsgo/node-builtin-import -- Vite+ loads this configuration before an Effect runtime; discover native app boundaries synchronously.
import {globSync} from 'node:fs'

import {Array, String} from 'effect'

import {defineConfig} from 'vite-plus'

import {deslopRules, lint} from './tools/coding-standards/src/lint.ts'

export default defineConfig({
	create: {
		templates: [
			{description: 'Create a full-stack Deslop application', name: 'app', template: './tools/create-app'},
			{description: 'Create a standard Deslop package', name: 'package', template: './tools/create-package'}
		]
	},
	fmt: {
		// Icon Composer writes and reads its own JSON layout.
		ignorePatterns: ['**/*.gen.ts', '**/*.icon/**', 'packages/components-web/src/ui/**'],

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
				// Skill scripts run inside an app's page through preview_evaluate, with no Effect runtime and no type information.
				files: ['.claude/skills/**/*.js'],
				rules: {
					'@deslop/coding-standards/no-native-emptiness-check': 'off',
					'@deslop/coding-standards/no-native-method-call': 'off',
					'effecttsgo/prefer-effect-array': 'off',
					'effecttsgo/prefer-effect-string': 'off',
					'eslint/no-restricted-globals': 'off',
					'eslint/no-restricted-properties': 'off',
					'typescript/no-unsafe-argument': 'off',
					'typescript/no-unsafe-assignment': 'off',
					'typescript/no-unsafe-call': 'off',
					'typescript/no-unsafe-member-access': 'off',
					'typescript/no-unsafe-return': 'off',
					'typescript/prefer-nullish-coalescing': 'off',
					'typescript/strict-boolean-expressions': 'off',
					'unicorn/consistent-function-scoping': 'off'
				}
			},
			{
				// React Native styles are objects with no Tailwind classes to check.
				files: [
					...Array.map(Array.fromIterable(globSync('apps/*/app.config.ts', {cwd: import.meta.dirname})), file =>
						String.replace('/app.config.ts', '/**')(file)
					),
					'packages/components-mobile/**',
					'tools/create-app/template/mobile/**'
				],
				rules: {
					'shadcn/no-arbitrary-values': 'off',
					'shadcn/no-inline-styles': 'off',
					'shadcn/no-raw-colors': 'off',
					'shadcn/no-restyle': 'off',
					'shadcn/no-unknown-classes': 'off',
					'shadcn/require-static-classes': 'off'
				}
			},
			{
				// The web template is no workspace package, so its stylesheet cannot resolve the theme's own utilities.
				files: ['tools/create-app/template/web/**'],
				rules: {'shadcn/no-unknown-classes': 'off'}
			}
		],
		rules: deslopRules
	},
	run: {
		// Each package's test script replays from the cache while its inputs are unchanged; a stopped preview server exits 130, so it is never cached.
		cache: true,
		tasks: {
			// Oxfmt, the typed lint pass on tsrs (Effect rules and TypeScript diagnostics), a syntax-only pass for the templates, then Fallow. `fix` writes the fixes instead of only reporting them. TSRS_FAST checks each tsconfig's whole program, including files lint ignores.
			check: [
				'vp fmt --list-different',
				'TSRS_FAST=1 effect-tsgo --tsrs-lint vp lint --type-aware --type-check --ignore-pattern "tools/*/template/**"',
				'vp lint tools/create-app/template tools/create-package/template --report-unused-disable-directives-severity=off',
				'vp run fallow'
			],
			// Fallow judges exports and dependencies across packages, so it reads the whole workspace whichever package it reports on.
			fallow: {
				cache: {input: [{auto: true}, '!.fallow/**'], output: []},
				command: [
					'fallow dead-code --format compact --fail-on-issues --quiet',
					'fallow dead-code --production --format compact --fail-on-issues --quiet',
					'fallow dupes --format compact --fail-on-issues --quiet',
					'fallow health --complexity --format human --quiet'
				]
			},
			fix: {
				cache: false,
				command: [
					'vp fmt',
					// Jev's verdicts for units no cached verdict covers, which the judged lint rules then report; `check` skips it, so CI never calls Jev.
					"node tools/coding-standards/src/main.cli.ts judge --ignore '**/*.gen.ts' --ignore 'packages/components-web/src/ui/**' --ignore 'tools/*/template/**'",
					'TSRS_FAST=1 effect-tsgo --tsrs-lint vp lint --fix --type-aware --type-check --ignore-pattern "tools/*/template/**"',
					'vp lint tools/create-app/template tools/create-package/template --fix --report-unused-disable-directives-severity=off',
					'vp run fallow'
				]
			},
			test: 'vp run -r --parallel test'
		}
	},
	// Each package's test script runs Vitest with this config from its own directory; a package's config holds no test settings.
	test: {
		// The only limits: no-test-timeout keeps tests, hooks and layers from raising their own.
		hookTimeout: 60_000,
		// The first glob serves each package's own run, the second a run from the root, such as one test file by path.
		include: ['src/**/*.test.ts', '{apps,packages,tools}/*/src/**/*.test.ts'],
		passWithNoTests: true,
		reporters: ['dot'],
		silent: 'passed-only',
		testTimeout: 60_000
	}
})
