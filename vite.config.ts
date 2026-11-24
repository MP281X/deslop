// oxlint-disable-next-line effecttsgo/node-builtin-import -- Vite+ loads this configuration before an Effect runtime; discover native app boundaries and the test root synchronously.
import {existsSync, globSync} from 'node:fs'

import {Array, Boolean, String} from 'effect'

import {defineConfig} from 'vite-plus'

import {lint, restrictedImports} from './tools/coding-standards/src/lint.ts'

// The registry keeps every primitive as a file; this repository's restricted imports own the excluded primitives and their wrapped libraries.
const BANNED_PRIMITIVES = ['alert-dialog', 'carousel', 'command', 'context-menu', 'drawer', 'spinner', 'toast']
const SPINNER_ICONS = ['CircleNotch', 'Spinner', 'SpinnerBall', 'SpinnerGap']

// Each worktree previews in its own systemd user unit, which outlives the agent's turn, on a port derived from its path and shared over tailnet HTTPS.
const PREVIEW_UNIT = Array.join(
	[
		'u=preview-${PWD##*/} p=$((20000 + 0x$(printf %s "$PWD" | sha256sum | cut -c1-4) % 10000)) m=$(git rev-parse --git-path preview-serve) h=$(hostname -s).tailnet-8c4c.ts.net',
		'fail() { printf "%s\\n" "$1" >&2; exit 1; }',
		// Only the marker says this checkout added the tailnet entry, and a marker can outlive it: nothing is removed or reused unless the port's whole entry is still this host's root proxied to this preview's loopback port, and nothing changes while Tailscale cannot say what it serves: its answer is one JSON object whose port and site maps, sites and handlers are objects or absent, and a question that answer cannot settle stops the run.
		'serving() { s=$(tailscale serve status --json) && s=$(jq -ces "select(length == 1) | .[0] | select(type == \\"object\\" and ([.TCP, .Web, (.Web // {} | .[]?), (.Web // {} | .[]? | .Handlers?)] | all(type == \\"object\\" or type == \\"null\\")))" <<<"$s") || fail "Tailscale did not say what it serves on port $p"; }',
		'asked() { local r=0; jq -e "$@" <<<"$s" >/dev/null || r=$?; ((r < 2)) || fail "Tailscale did not say what it serves on port $p"; return $r; }',
		'served() { asked --arg p $p ".TCP // {} | has(\\$p)"; }',
		'proxied() { asked --arg s :$p --arg k $h:$p --arg to http://127.0.0.1:$p "[.Web // {} | to_entries[] | select(.key | endswith(\\$s)) | {key, handlers: .value.Handlers}] == [{key: \\$k, handlers: {\\"/\\": {Proxy: \\$to}}}]"; }',
		'unserve() { [ -f "$m" ] || return 0; serving; ! proxied || sudo tailscale serve --https=$p off >/dev/null || return 1; rm "$m"; }',
		// The unit is named by folder alone, so a checkout elsewhere with the same folder name may own it.
		'd=$(systemctl --user show -P WorkingDirectory $u); [[ -z $d || $d -ef . ]] || fail "$u runs $d, not this checkout"'
	],
	'\n'
)
const PREVIEW = Array.join(
	[
		PREVIEW_UNIT,
		'a=$1 t=${PREVIEW_DEADLINE:-300}',
		// Without an app argument, the first app with a web page this branch changes, else Portfolio; an iOS app's server has no page, so it previews only by name.
		'[ -n "$a" ] || a=$({ git diff --name-only origin/main...HEAD; git status --porcelain --no-renames | cut -c4-; } 2>/dev/null | grep -oP "^apps/\\K[^/]+" | sort -u | while read -r x; do [ -f "apps/$x/index.html" ] && echo "$x"; done | awk NR==1)',
		'a=${a:-portfolio}',
		'[[ $a =~ ^[a-z][a-z0-9-]*$ && -f apps/$a/src/main.server.ts ]] || fail "Not an app: $a"',
		// Tailscale's own listeners on the tailnet addresses carry the serve entry, not an app.
		'listeners() { ss -Hltnp "sport = :$p" | grep -v %tailscale0; }',
		'ours() { local l x; l=$(listeners) && while read -r x; do [[ $x =~ pid=([0-9]+) && $(cat /proc/${BASH_REMATCH[1]}/cgroup 2>/dev/null) == */$u.service ]] || return 1; done <<<"$l"; }',
		// The running preview stops only once Tailscale said what it serves.
		'serving',
		'[ -z "$d" ] || systemctl --user stop $u',
		// Two checkouts can derive the same port: the second fails instead of handing out the first one's app.
		'! l=$(listeners) || fail "Port $p is taken by another server: $l"',
		'! served || { [ -f "$m" ] && proxied; } || fail "Tailnet port $p is served for something else"',
		'systemd-run --user -G -d -u $u -E PATH="$HOME/.vite-plus/bin:$PATH" -E HOST=127.0.0.1 -E PORT=$p vp run --no-cache --filter "@deslop/$a" preview || exit 1',
		'i=$(systemctl --user show -P InvocationID $u)',
		'trap "systemctl --user stop $u 2>/dev/null; unserve" EXIT',
		'die() { printf "%s\\n" "$1" >&2; journalctl --user _SYSTEMD_INVOCATION_ID=$i -o cat -n 20 >&2; exit 1; }',
		// Trips answers 404 at the root, so readiness asks every app's runtime endpoint for its name.
		'until ours && [[ $(curl -s --max-time 5 http://127.0.0.1:$p/api/runtime | jq -r .name 2>/dev/null) == "$a" ]]; do',
		'systemctl --user is-active -q $u || die "$u stopped before serving $a"',
		'! l=$(listeners) || ours || die "Port $p was taken by another server while $a started: $l"',
		'((SECONDS < t)) || die "$a did not answer on port $p within ${t}s"',
		'sleep 2',
		'done',
		': >"$m"',
		'sudo tailscale serve --bg --https=$p http://127.0.0.1:$p >/dev/null || die "Tailscale did not serve port $p"',
		'until [[ $(curl -s --max-time 5 https://$h:$p/api/runtime | jq -r .name 2>/dev/null) == "$a" ]]; do ((SECONDS < t)) || die "https://$h:$p did not answer within ${t}s"; sleep 2; done',
		'trap - EXIT',
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
				// A migration's test reads the rows it rewrote, including another service's tables, which no service answer shows.
				files: ['**/packages/runtime/src/server/tables.test.ts', '**/apps/*/src/services/*/migrations.test.ts'],
				rules: {'@deslop/coding-standards/test-boundaries': ['error', 'inspect-database']}
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
									group: ['expo-notifications', 'expo-notifications/**', 'expo-widgets', 'expo-widgets/**'],
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
				// Skill scripts run inside an app's page through preview_evaluate, or in Node to cut a recording, with no Effect runtime and no type information.
				files: ['.claude/skills/**/*.js'],
				rules: {
					'@deslop/coding-standards/library-operation': 'off',
					'@deslop/coding-standards/no-native-method-call': 'off',
					'effecttsgo/async-function': 'off',
					'effecttsgo/global-date': 'off',
					'effecttsgo/global-json': 'off',
					'effecttsgo/global-timers': 'off',
					'effecttsgo/node-builtin-import': 'off',
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
			// TSRS_FAST checks each tsconfig's whole program, including files lint ignores; the templates get a syntax-only pass. Build output is no source, so a build keeps the cached check.
			check: {
				cache: {input: [{auto: true}, '!**/dist/**']},
				command: [
					'vp fmt --list-different',
					'TSRS_FAST=1 effect-tsgo --tsrs-lint vp lint --type-aware --type-check --ignore-pattern "tools/*/template/**"',
					'vp lint tools/create-app/template tools/create-package/template --report-unused-disable-directives-severity=off',
					'vp run fallow'
				]
			},
			// Fallow judges exports and dependencies across packages, so it reads the whole workspace whichever package it reports on.
			fallow: {
				cache: {input: [{auto: true}, '!.fallow/**', '!**/dist/**'], output: []},
				command: [
					'fallow dead-code --format compact --fail-on-issues --quiet',
					// Production mode drops the test files, so the test zone is empty by design; the run above reports the configuration's own warnings.
					'RUST_LOG=error fallow dead-code --production --format compact --fail-on-issues --quiet',
					'fallow dupes --format compact --fail-on-issues --quiet',
					// Fallow lists a tightening override as stale on every function under it, so only findings and live overrides print.
					`bash -o pipefail -c "fallow health --complexity --format compact --quiet | { grep -Ev '^(vital-signs|cyclomatic-population):|^threshold-override:[0-9]+:[a-z]+:stale:' || true; }"`
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
			// `vp run preview [app]`; bash -c receives the app as $1.
			preview: {cache: false, command: `bash -c '${PREVIEW}' preview`},
			'preview:stop': {
				cache: false,
				command: `bash -c '${PREVIEW_UNIT}\n[ ! -f "$m" ] || serving\n[ -z "$d" ] || systemctl --user stop $u\nunserve'`
			},
			test: 'vp run -r --parallel test'
		}
	},
	// Each package's test script runs Vitest with this config from its own directory; a package's config holds no test settings.
	test: {
		// The only limits: test-synchronization keeps tests, hooks and layers from raising their own.
		hookTimeout: 60_000,
		// A package run scans only its src, since the task cache tracks the listing Vitest reads and a build beside src would void it; a root run serves a test that never reads its app's package, which the runtime takes from the current directory.
		...Boolean.match(existsSync('src'), {
			onFalse: () => ({include: ['{apps,packages,tools}/*/src/**/*.test.ts']}),
			onTrue: () => ({dir: 'src', include: ['**/*.test.ts']})
		}),
		// Only the lint rule suite runs concurrently; eight measured fastest without starving the rest.
		maxConcurrency: 8,
		passWithNoTests: true,
		reporters: ['dot'],
		silent: 'passed-only',
		// Lint rule scenarios run compiler checks in child processes on a loaded host.
		testTimeout: 120_000
	}
})
