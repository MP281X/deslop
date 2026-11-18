// oxlint-disable-next-line effecttsgo/node-builtin-import -- Vite+ loads this configuration before an Effect runtime; discover native app boundaries synchronously.
import {globSync} from 'node:fs'

import {Array, String} from 'effect'

import {defineConfig} from 'vite-plus'

import {lint, restrictedImports} from './tools/coding-standards/src/lint.ts'

// The registry keeps every primitive as a file; this repository's restricted imports own the excluded primitives and their wrapped libraries.
const BANNED_PRIMITIVES = ['alert-dialog', 'carousel', 'command', 'context-menu', 'drawer', 'spinner', 'toast']
const SPINNER_ICONS = ['CircleNotch', 'Spinner', 'SpinnerBall', 'SpinnerGap']

// Each worktree previews in its own systemd user unit, which outlives the agent's turn, on a port derived from its path and shared over tailnet HTTPS.
const PREVIEW_UNIT = 'u=preview-${PWD##*/} p=$((20000 + 0x$(printf %s "$PWD" | sha256sum | cut -c1-4) % 10000))'
const PREVIEW = Array.join(
	[
		`${PREVIEW_UNIT} h=$(hostname -s).tailnet-8c4c.ts.net a=$1`,
		// Without an app argument, the first web app this branch changes, else Portfolio.
		'[ -n "$a" ] || a=$({ git diff --name-only origin/main...HEAD; git status --porcelain | cut -c4-; } 2>/dev/null | grep -oP "^apps/\\K[^/]+" | sort -u | while read -r x; do [ -f "apps/$x/src/main.client.tsx" ] && echo "$x"; done | awk NR==1)',
		'a=${a:-portfolio}',
		'[[ $a =~ ^[a-z][a-z0-9-]*$ && -f apps/$a/src/main.client.tsx ]] || { printf "Not a web app: %s\\n" "$a" >&2; exit 1; }',
		'systemctl --user stop $u 2>/dev/null; systemctl --user reset-failed $u 2>/dev/null',
		'systemd-run --user -G -d -u $u -E PATH="$HOME/.vite-plus/bin:$PATH" -E HOST=127.0.0.1 -E PORT=$p vp run --no-cache --filter "@deslop/$a" preview || exit 1',
		// Any HTTP answer means the server listens: Trips answers 404 at the root.
		'until curl -so /dev/null http://127.0.0.1:$p; do systemctl --user is-active -q $u || exit 1; sleep 2; done',
		'sudo tailscale serve --bg --https=$p http://127.0.0.1:$p >/dev/null || { systemctl --user stop $u; exit 1; }',
		'echo "$a: https://$h:$p"'
	],
	'\n'
)

const repositoryRestrictedImports = {
	paths: [
		...restrictedImports.paths,
		{
			importNames: Array.flatMap(SPINNER_ICONS, icon => [icon, `${icon}Icon`]),
			message: 'Pending actions have no spinners; keep their state in the action itself.',
			name: '@phosphor-icons/react'
		}
	],
	patterns: [
		...restrictedImports.patterns,
		{
			group: [
				...Array.flatMap(BANNED_PRIMITIVES, name => [`**/ui/${name}`, `**/ui/${name}.tsx`]),
				'cmdk',
				'cmdk/**',
				'embla-carousel*',
				'embla-carousel*/**'
			],
			message: 'These primitives and their wrapped libraries are excluded by the repository restricted-imports policy.'
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
		// Icon Composer writes and reads its own JSON layout; the prototype stays dense because agents read it into context.
		ignorePatterns: [
			'**/*.gen.ts',
			'**/*.icon/**',
			'packages/components-web/src/ui/**',
			'.claude/skills/proof/references/prototype.html'
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
				files: ['**/tools/coding-standards/src/lint.test.ts'],
				rules: {
					'@deslop/coding-standards/test-boundaries': ['error', 'read-source-text', 'execute-program'],
					'eslint-js/no-restricted-syntax': lint.rules['eslint-js/no-restricted-syntax']
				}
			},
			{
				files: ['**/packages/runtime/src/server/tables.test.ts'],
				rules: {'@deslop/coding-standards/test-boundaries': ['error', 'inspect-database']}
			},
			{
				files: ['tools/coding-standards/src/judge.test.ts'],
				rules: {'@deslop/coding-standards/test-boundaries': ['error', 'execute-program']}
			},
			{
				files: ['packages/**'],
				rules: {
					'eslint/no-restricted-imports': [
						'error',
						{
							...repositoryRestrictedImports,
							patterns: [
								...repositoryRestrictedImports.patterns,
								{
									group: [
										'expo-notifications',
										'expo-notifications/**',
										'expo-calendar',
										'expo-calendar/**',
										'expo-location',
										'expo-location/**',
										'expo-widgets',
										'expo-widgets/**'
									],
									message:
										'App-only native modules and their helpers belong in their consuming app, not a shared package.'
								}
							]
						}
					]
				}
			},
			{
				files: ['packages/runtime/src/config/expo.ts'],
				rules: {
					'eslint/no-restricted-imports': [
						'error',
						{
							...repositoryRestrictedImports,
							patterns: [
								...repositoryRestrictedImports.patterns,
								{
									group: [
										'expo/config-plugins',
										'expo/config-plugins/**',
										'@expo/config-plugins',
										'@expo/config-plugins/**'
									],
									message:
										"This file's text is not part of the native fingerprint; plugins and mods live in their own module."
								}
							]
						}
					]
				}
			},
			{
				// Skill scripts run inside an app's page through preview_evaluate, with no Effect runtime and no type information.
				files: ['.claude/skills/**/*.js'],
				rules: {
					'@deslop/coding-standards/library-operation': 'off',
					'@deslop/coding-standards/no-native-method-call': 'off',
					'effecttsgo/async-function': 'off',
					'effecttsgo/global-date': 'off',
					'effecttsgo/global-timers': 'off',
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
				rules: {'shadcn/no-inline-styles': 'off'}
			},
			{
				// shadcn's utils alias in components.json: the registry imports the `cn` package, and this path re-exports it for the package's own code.
				files: ['packages/components-web/src/lib/utils.ts'],
				rules: {
					'@deslop/coding-standards/no-barrel-module': 'off',
					'@deslop/coding-standards/service-schema-file': 'off'
				}
			},
			{
				// Portfolio is exempt from the Design rules: its links and buttons are its own artwork.
				files: ['apps/portfolio/**'],
				rules: {'@deslop/coding-standards/no-bare-control': 'off'}
			},
			{
				// The web template is no workspace package, so its stylesheet cannot resolve the theme's own utilities.
				files: ['tools/create-app/template/web/**'],
				rules: {'shadcn/no-unknown-classes': 'off'}
			}
		],
		rules: {
			'eslint/no-restricted-imports': ['error', repositoryRestrictedImports],
			'eslint-js/no-restricted-syntax': [
				...lint.rules['eslint-js/no-restricted-syntax'],
				{
					message: 'Use a flat theme token such as bg-card or bg-muted.',
					selector:
						'Literal[value=/(^|[ :])bg-(linear|radial|conic|gradient)(-|$| )|gradient\\(/], TemplateElement[value.raw=/(^|[ :])bg-(linear|radial|conic|gradient)(-|$| )|gradient\\(/]'
				},
				{
					message: 'Draw Phosphor icons light at 20px and above.',
					selector:
						'JSXOpeningElement[name.name=/Icon$/]:has(JSXAttribute[name.name="className"][value.value=/(^| )size-([5-9]|[1-9][0-9]+)( |$)/]):not(:has(JSXAttribute[name.name="weight"][value.value="light"]))'
				},
				{
					message: 'Draw Phosphor icons regular at 16px and below.',
					selector:
						'JSXOpeningElement[name.name=/Icon$/]:has(JSXAttribute[name.name="className"][value.value=/(^| )size-[0-4]( |$)/]) > JSXAttribute[name.name="weight"][value.value="light"]'
				},
				{
					message: "Name an RPC '<service folder>.<verb>', as in 'metrics.history'.",
					selector:
						'CallExpression[callee.object.name="Rpc"][callee.property.name="make"] > Literal.arguments:first-child:not([value=/^[a-z]+(?:-[a-z]+)*\\.[a-z][A-Za-z]*$/])'
				}
			]
		}
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
					// CI installs with a frozen lockfile, so a manifest edit must carry its lockfile.
					'vp install',
					// Before the lint too, so a lint error that stops the run still leaves every file formatted.
					'vp fmt',
					'TSRS_FAST=1 effect-tsgo --tsrs-lint vp lint --fix --type-aware --type-check --ignore-pattern "tools/*/template/**"',
					'vp lint tools/create-app/template tools/create-package/template --fix --report-unused-disable-directives-severity=off',
					// After the lint fixes, whose rewrites are unformatted.
					'vp fmt',
					'vp run fallow'
				]
			},
			// Parked: only an explicit user request runs this paid-capable command, never routine verification.
			judge: {cache: false, command: 'coding-standards judge'},
			// `vp run preview [app]`; bash -c receives the app as $1.
			preview: {cache: false, command: `bash -c '${PREVIEW}' preview`},
			'preview:stop': {
				cache: false,
				command: `bash -c '${PREVIEW_UNIT}; systemctl --user stop $u; sudo tailscale serve --https=$p off 2>/dev/null || true'`
			},
			test: 'vp run -r --parallel test'
		}
	},
	// Each package's test script runs Vitest with this config from its own directory; a package's config holds no test settings.
	test: {
		// The only limits: test-synchronization keeps tests, hooks and layers from raising their own.
		hookTimeout: 60_000,
		// The first glob serves each package's own run; the second a root run of a test that never reads its app's package, which the runtime takes from the current directory.
		include: ['src/**/*.test.ts', '{apps,packages,tools}/*/src/**/*.test.ts'],
		// Only the lint rule suite runs concurrently; eight measured fastest without starving the rest.
		maxConcurrency: 8,
		passWithNoTests: true,
		reporters: ['dot'],
		silent: 'passed-only',
		// Lint rule scenarios run compiler checks in child processes on a loaded host.
		testTimeout: 120_000
	}
})
