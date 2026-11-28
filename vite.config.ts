// oxlint-disable-next-line effecttsgo/node-builtin-import -- Vite+ loads this configuration before an Effect runtime; discover native app boundaries and the test root synchronously.
import {existsSync} from 'node:fs'

import {Array, Boolean} from 'effect'

import {defineConfig} from 'vite-plus'

import {lint} from './tools/coding-standards/src/lint.ts'

// The apps not yet moved to Deploy's feature layout; every other app and the template must follow it, and each app's migration removes its name here.
const UNMIGRATED = ['opm', 'portfolio', 'scope', 'stash', 'trips']

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
		// Without an app argument, the first app with a web page this branch changes, else Portfolio.
		'[ -n "$a" ] || a=$({ git diff --name-only origin/main...HEAD; git status --porcelain --no-renames | cut -c4-; } 2>/dev/null | grep -oP "^apps/\\K[^/]+" | sort -u | while read -r x; do [ -f "apps/$x/index.html" ] && echo "$x"; done | awk NR==1)',
		'a=${a:-portfolio}',
		'[[ $a =~ ^[a-z][a-z0-9-]*$ && ( -f apps/$a/src/server/main.ts || -f apps/$a/src/server.ts ) && -f apps/$a/src/web/main.ts ]] || fail "Not an app: $a"',
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

export default defineConfig({
	create: {
		templates: [
			{description: 'Create a Deslop server with web and iPhone clients', name: 'app', template: './tools/create-app'},
			{description: 'Create a standard Deslop package', name: 'package', template: './tools/create-package'}
		]
	},
	fmt: {
		// Icon Composer writes and reads its own JSON layout; the prototype stays dense because agents read it into context.
		ignorePatterns: ['**/*.gen.ts', '**/*.icon/**', '.claude/skills/visuals/references/prototype.html'],

		arrowParens: 'avoid',
		bracketSpacing: false,
		objectWrap: 'collapse',
		printWidth: 120,
		semi: false,
		singleQuote: true,
		sortPackageJson: {sortScripts: true},
		trailingComma: 'none',
		useTabs: true,

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
		ignorePatterns: ['**/*.gen.ts'],
		overrides: [
			{
				// A source file stays small enough to read whole; a test may be longer.
				excludeFiles: ['**/*.test.ts', ...Array.map(UNMIGRATED, name => `**/apps/${name}/**`)],
				files: ['**/apps/*/**', '**/tools/create-app/template/**'],
				rules: {'eslint/max-lines': ['error', 600]}
			},
			{
				files: ['**/tools/coding-standards/src/lint.test.ts'],
				rules: {
					'@deslop/coding-standards/test-boundaries': ['error', 'read-source-text', 'execute-program'],
					'eslint-js/no-restricted-syntax': lint.rules['eslint-js/no-restricted-syntax']
				}
			},
			{
				// A migration's test reads the rows it rewrote, including another service's tables, which no service answer shows.
				files: ['**/packages/runtime/src/server/tables.test.ts', '**/apps/*/src/server/*/migrations.test.ts'],
				rules: {'@deslop/coding-standards/test-boundaries': ['error', 'inspect-database']}
			},
			{
				// Skill scripts run inside an app's page through preview_evaluate, or in Node to cut a recording, with no Effect runtime and no type information.
				files: ['.claude/skills/**/*.js'],
				rules: {
					'@deslop/coding-standards/library-operation': 'off',
					'@deslop/coding-standards/no-native-method-call': 'off',
					'effecttsgo/async-function': 'off',
					'effecttsgo/global-console': 'off',
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
			}
		],
		rules: {
			'@deslop/coding-standards/app-layout': ['error', ...UNMIGRATED],
			'eslint-js/no-restricted-syntax': [
				...lint.rules['eslint-js/no-restricted-syntax'],
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
