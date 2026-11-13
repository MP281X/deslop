// oxlint-disable-next-line effecttsgo/node-builtin-import -- Vite+ loads this configuration before an Effect runtime; discover native app boundaries synchronously.
import {globSync} from 'node:fs'

import {Array, String} from 'effect'

import {defineConfig} from 'vite-plus'

import {deslopRules, lint, restrictedImports} from './tools/coding-standards/src/lint.ts'

// The registry keeps every primitive as a file; these break AGENTS.md's Design rules (motion, spinners, toasts, context menus, a command palette, a destruction confirmation), so nothing outside it imports them by any spelling, nor the libraries they wrap.
const BANNED_PRIMITIVES = ['alert-dialog', 'carousel', 'command', 'context-menu', 'drawer', 'spinner', 'toast']
const BANNED_BASE_UI = ['alert-dialog', 'context-menu', 'drawer', 'toast']
const SPINNER_ICONS = ['CircleNotch', 'Spinner', 'SpinnerBall', 'SpinnerGap']

const repositoryRestrictedImports = {
	paths: [
		...restrictedImports.paths,
		...Array.map(['@phosphor-icons/react', '@phosphor-icons/react/ssr', '@phosphor-icons/react/dist/ssr'], name => ({
			importNames: Array.flatMap(SPINNER_ICONS, icon => [icon, `${icon}Icon`]),
			message: 'AGENTS.md Design: pending actions have no spinners.',
			name
		})),
		{
			importNames: ['AlertDialog', 'ContextMenu', 'Drawer', 'Toast'],
			message: 'AGENTS.md Design bans this primitive.',
			name: '@base-ui/react'
		}
	],
	patterns: [
		{
			// All restrictions share one ordered group: Oxlint applies a group's negations to other patterns too.
			group: [
				'*',
				'!node:*',
				'!node:*/**',
				'!#*',
				'!#*/**',
				'!.',
				'!./**',
				'!..',
				'!../**',
				'!@deslop',
				'!@deslop/**',
				'!**/*.css',
				'!**/*.svg',
				'!**/*.png',
				'!**/*.jpg',
				'!**/*.jpeg',
				'!**/*.webp',
				'!**/*.gif',
				'!**/*.ico',
				'!**/*.woff',
				'!**/*.woff2',
				'!**/*.ttf',
				'!**/*.otf',
				'!**/*\\?*',
				'!@bacons',
				'!@base-ui',
				'!@effect',
				'!@expo',
				'!@fontsource-variable',
				'!@modelcontextprotocol',
				'!@phosphor-icons',
				'!@shadcn',
				'!@simplewebauthn',
				'!@tailwindcss',
				'!@tanstack',
				'!@typeonce',
				'!@types',
				'!@vitejs',
				...Array.flatMap(
					[
						'@bacons/apple-targets',
						'@base-ui/react',
						'@deslop/coding-standards',
						'@deslop/components-mobile',
						'@deslop/components-web',
						'@deslop/create-package',
						'@deslop/runtime',
						'@effect/ai-anthropic',
						'@effect/atom-react',
						'@effect/platform-node',
						'@effect/sql-sqlite-node',
						'@effect/tsgo',
						'@effect/vitest',
						'@expo/ui',
						'@fontsource-variable/geist',
						'@fontsource-variable/geist-mono',
						'@fontsource-variable/ibm-plex-sans',
						'@fontsource-variable/jetbrains-mono',
						'@modelcontextprotocol/client',
						'@phosphor-icons/react',
						'@shadcn/lint',
						'@shadcn/react',
						'@simplewebauthn/browser',
						'@simplewebauthn/server',
						'@tailwindcss/vite',
						'@tanstack/react-hotkeys',
						'@tanstack/react-router',
						'@tanstack/router-generator',
						'@tanstack/router-plugin',
						'@typeonce/effect-machine',
						'@typeonce/effect-machine-react',
						'@typeonce/oxlint-plugin-effect-machine',
						'@types/node',
						'@types/react',
						'@types/react-dom',
						'@vitejs/plugin-react',
						'cheerio',
						'class-variance-authority',
						'clsx',
						'cmdk',
						'date-fns',
						'domhandler',
						'effect',
						'embla-carousel-react',
						'expo',
						'expo-application',
						'expo-asset',
						'expo-auth-session',
						'expo-calendar',
						'expo-clipboard',
						'expo-constants',
						'expo-crypto',
						'expo-file-system',
						'expo-location',
						'expo-notifications',
						'expo-secure-store',
						'expo-updates',
						'expo-web-browser',
						'expo-widgets',
						'fallow',
						'input-otp',
						'oxc-parser',
						'oxc-transform-react',
						'oxlint-plugin-eslint',
						'oxlint-plugin-react-doctor',
						'react',
						'react-day-picker',
						'react-dom',
						'react-native',
						'react-resizable-panels',
						'recharts',
						'scheduler',
						'shadcn',
						'shiki',
						'tailwind-merge',
						'tailwindcss',
						'toqr',
						'tsrs',
						'vite',
						'vite-plus',
						'vitest'
					],
					name => [`!${name}`, `!${name}/**`]
				),
				...Array.flatMap(restrictedImports.patterns, pattern => pattern.group),
				// Last, so they win over the allowlist above: every spelling of a banned primitive and the libraries behind it.
				...Array.flatMap(BANNED_PRIMITIVES, name => [`**/ui/${name}`, `**/ui/${name}.tsx`]),
				...Array.flatMap(BANNED_BASE_UI, name => [`@base-ui/react/**/${name}`, `@base-ui/react/**/${name}/**`]),
				...Array.flatMap(SPINNER_ICONS, icon => [
					`@phosphor-icons/react/**/${icon}`,
					`@phosphor-icons/react/**/${icon}.*`
				]),
				'cmdk',
				'cmdk/**',
				'embla-carousel*',
				'embla-carousel*/**'
			],
			message:
				'Not a dependency of this repository (ask before adding one), not its public export, or what AGENTS.md Design bans.'
		}
	]
}

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
				files: ['packages/runtime/src/config/expo.ts'],
				rules: {
					'eslint/no-restricted-imports': [
						'error',
						{
							...repositoryRestrictedImports,
							patterns: Array.map(repositoryRestrictedImports.patterns, pattern => ({
								group: [
									...pattern.group,
									'expo/config-plugins',
									'expo/config-plugins/**',
									'@expo/config-plugins',
									'@expo/config-plugins/**'
								],
								message: `${pattern.message} This file's text is not part of the native fingerprint; plugins and mods live in their own module.`
							}))
						}
					]
				}
			},
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
		rules: {...deslopRules, 'eslint/no-restricted-imports': ['error', repositoryRestrictedImports]}
	},
	run: {
		// Each package's test script replays from the cache while its inputs are unchanged; a stopped preview server exits 130, so it is never cached.
		cache: true,
		tasks: {
			// TSRS_FAST checks each tsconfig's whole program, including files lint ignores; the templates get a syntax-only pass.
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
					// The tactics print first, so a step that fails below leaves them above its diagnostics, for the agent fixing it.
					'coding-standards tactics',
					'vp fmt',
					'TSRS_FAST=1 effect-tsgo --tsrs-lint vp lint --fix --type-aware --type-check --ignore-pattern "tools/*/template/**"',
					'vp lint tools/create-app/template tools/create-package/template --fix --report-unused-disable-directives-severity=off',
					'vp run fallow'
				]
			},
			// Jev's questions over the repository, run by hand once per pull request after Verify: an unanswered question costs part of a model call and the answers live in the user's own cache, so `fix`, `check`, `test`, Verify and CI never judge.
			judge: {
				cache: false,
				command:
					"coding-standards judge --ignore '**/*.gen.ts' --ignore 'packages/components-web/src/ui/**' --ignore 'tools/*/template/**'"
			},
			test: 'vp run -r --parallel test'
		}
	},
	// Each package's test script runs Vitest with this config from its own directory; a package's config holds no test settings.
	test: {
		// The only limits: no-test-timeout keeps tests, hooks and layers from raising their own.
		hookTimeout: 60_000,
		// The first glob serves each package's own run; the second a root run of a test that never reads its app's package, which the runtime takes from the current directory.
		include: ['src/**/*.test.ts', '{apps,packages,tools}/*/src/**/*.test.ts'],
		// Only the lint rule suite runs concurrently; eight measured fastest without starving the rest.
		maxConcurrency: 8,
		passWithNoTests: true,
		reporters: ['dot'],
		silent: 'passed-only',
		// The generator test builds and typechecks two generated apps; 120s covers a loaded host without hiding a hang.
		testTimeout: 120_000
	}
})
