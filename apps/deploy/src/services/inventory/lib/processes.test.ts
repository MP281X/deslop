import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Effect, FileSystem, Option, PlatformError, Schema, String} from 'effect'

import {commandLabel} from './command.ts'
import {attachProcesses, processReadings, processes} from './processes.ts'

import {processOwner} from '#services/inventory/lib/utils.ts'
import {AppId, InventoryItem, ItemId, Process, UnitId} from '#services/inventory/schema.ts'

function reading(time: number) {
	return {
		records: [
			{
				owner: Option.none<AppId>(),
				process: Schema.decodeSync(Process)({
					label: {detail: '', name: 'node'},
					memory: time,
					name: 'node',
					parent: 1,
					pid: 42
				}),
				start: DateTime.makeUnsafe(100),
				ticks: Duration.millis(time / 4)
			}
		],
		time: DateTime.makeUnsafe(time),
		total: Duration.millis(time + 800)
	}
}

it.effect(
	'collects names with spaces, parent/RSS, cwd labels and masked arguments, and tolerates an exited process',
	() =>
		Effect.provideService(
			Effect.gen(function* () {
				const collected = yield* processes
				assert.strictEqual(Duration.toMillis(collected.total), 8000)
				assert.deepStrictEqual(
					Array.map(collected.records, record => ({
						...record,
						owner: Schema.encodeSync(AppId)(Option.getOrThrow(record.owner)),
						process: Schema.encodeSync(Process)(record.process),
						start: Duration.toMillis(record.start) / 10,
						ticks: Duration.toMillis(record.ticks) / 10
					})),
					[
						{
							owner: 'service:system:scope.service',
							process: {
								command: ['firefox', '--type=renderer'],
								label: {detail: '', name: 'firefox'},
								memory: 1_048_576,
								name: 'Web Content',
								parent: 7,
								pid: 42
							},
							start: 100,
							ticks: 10
						},
						{
							owner: 'service:system:scope.service',
							process: {
								command: [
									'node',
									'server.js',
									'--api-token',
									'…',
									'GITHUB_TOKEN=…',
									'https://…@example.com/x',
									'…',
									'--session-id=…',
									'--allow-dangerously-skip-permissions',
									'--mode',
									'off',
									'--oauth2-bearer',
									'…'
								],
								label: {detail: 'x', name: 'auth'},
								memory: 0,
								name: 'worker',
								parent: 1,
								pid: 7
							},
							start: 100,
							ticks: 10
						}
					]
				)
			}),
			FileSystem.FileSystem,
			FileSystem.makeNoop({
				readDirectory: () => Effect.succeed(['42', '7', '99', 'self']),
				readFileString: Effect.fnUntraced(function* (path) {
					if (path === '/proc/stat') return 'cpu 100 0 100 600 0 0 0 0\n'
					if (path === '/proc/42/stat' || path === '/proc/7/stat') {
						return `${path} (Web Content) S 0 0 0 0 0 0 0 0 0 0 10 0 0 0 0 0 0 0 100`
					}
					if (String.endsWith('/cgroup')(path)) return '0::/user.slice/scope.service\n'
					if (path === '/proc/42/cmdline') return 'firefox\0--type=renderer\0'
					// Secrets in arguments stay on the worker.
					if (path === '/proc/7/cmdline') {
						return `node\0server.js\0--api-token\0abc\0GITHUB_TOKEN=ghp_x\0https://user:pw@example.com/x\0${String.repeat(40)('a')}\0--session-id=abc\0--allow-dangerously-skip-permissions\0--mode\0off\0--oauth2-bearer\0-short-secret`
					}
					if (path === '/proc/42/status') return 'Name:\tWeb Content\nPid:\t42\nPPid:\t7\nVmRSS:\t1024 kB\n'
					if (path === '/proc/7/status') return 'Name:\tworker\nPid:\t7\nPPid:\t1\n'
					return yield* PlatformError.badArgument({
						description: 'Process exited',
						method: 'readFileString',
						module: 'fixture'
					})
				}),
				readLink: Effect.fnUntraced(function* (path) {
					if (path === '/proc/7/cwd') {
						return '/home/mp281x/.t3/worktrees/deslop/t3-42831c07-bd2adb498ae2fa17/apps/auth'
					}
					return yield* PlatformError.badArgument({
						description: 'Process exited',
						method: 'readLink',
						module: 'fixture'
					})
				})
			})
		)
)

const labelCases = [
	{
		argv: [
			'/bin/sh',
			'-c',
			'{ trap \'\' TERM; read -r _ <&3; kill -TERM 0; sleep 5; kill -KILL 0; } </dev/null >/dev/null 2>&1 &\nexec "$@" 3<&-',
			't3-claude',
			'/bin/sh',
			'-c',
			'{ echo 800 >/proc/self/oom_score_adj; } 2>/dev/null\n: "${XDG_RUNTIME_DIR:=$1}"\nexport XDG_RUNTIME_DIR\nshift\nexec "$@"',
			't3-agent',
			'/run/user/1000',
			'/usr/bin/systemd-run',
			'--user',
			'--scope',
			'--quiet',
			'--slice=app-t3code-agents.slice',
			'--unit=t3code-claude.scope',
			'--property=TimeoutStopSec=10s',
			'--',
			'/home/mp281x/.local/bin/claude',
			'--output-format',
			'stream-json',
			'--effort=high',
			'--model=claude-opus-5-5',
			'--permission-prompt-tool',
			'stdio'
		],
		cwd: Option.none(),
		label: {detail: 'claude-opus-5-5 high', name: 'claude'}
	},
	{
		argv: [
			'/home/mp281x/.vite-plus/js_runtime/node/26.13.0/bin/node',
			'/home/mp281x/.deslop/deploy/current/dist/server.js'
		],
		cwd: Option.none(),
		label: {detail: '', name: 'deploy'}
	},
	{
		argv: ['/home/mp281x/.vite-plus/js_runtime/node/26.13.0/bin/node', '--env-file-if-exists=.env', './dist/server.js'],
		cwd: Option.some('/home/mp281x/.t3/worktrees/deslop/t3-42831c07-bd2adb498ae2fa17/apps/auth'),
		label: {detail: '', name: 'auth'}
	},
	{
		argv: [
			'/home/mp281x/.vite-plus/js_runtime/node/26.13.0/bin/node',
			'/home/mp281x/.t3/worktrees/deslop/t3-42831c07-bd2adb498ae2fa17/node_modules/.pnpm/vite-plus@1.5.0/node_modules/vite-plus/dist/bin.js',
			'run',
			'--no-cache',
			'--filter',
			'@deslop/deploy',
			'preview'
		],
		cwd: Option.none(),
		label: {detail: 'run preview @deslop/deploy', name: 'vp'}
	},
	{
		argv: [
			'/home/mp281x/.vite-plus/js_runtime/node/26.13.0/bin/node',
			'/home/mp281x/.t3/worktrees/deslop/t3-42831c07-bd2adb498ae2fa17/node_modules/.bun/vite-plus@1.5.0/node_modules/vite-plus/dist/bin.js',
			'test',
			'run'
		],
		cwd: Option.none(),
		label: {detail: 'test run', name: 'vp'}
	},
	{
		argv: [
			'/bin/bash',
			'-c',
			"source /home/mp281x/.claude/shell-snapshots/snapshot-bash-1794232405426-w52326.sh 2>/dev/null || true && shopt -u extglob 2>/dev/null || true && { \\builtin unalias -- 'which'; \\builtin unset -f -- 'which'; } >/dev/null 2>&1 || true && eval 'cd apps/gateway && TZ=UTC vp test handlers.test.ts' < /dev/null && pwd -P >| /tmp/claude-a1b2-cwd"
		],
		cwd: Option.none(),
		label: {detail: 'test handlers.test.ts', name: 'vp'}
	},
	{
		argv: ['/bin/bash'],
		cwd: Option.some('/home/mp281x/.t3/worktrees/deslop/t3-ac64c231-c6d7180228e68a5e (deleted)'),
		label: {detail: 't3-ac64c231-c6d7180228e68a5e (deleted)', name: 'bash'}
	},
	{
		argv: ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'macbook-pro', 'cat', '/etc/hosts'],
		cwd: Option.none(),
		label: {detail: 'macbook-pro → cat', name: 'ssh'}
	},
	{
		argv: [
			'/home/mp281x/.t3/tools/chrome-headless-shell/linux64/157.0.8103.38/chrome-headless-shell --type=renderer --headless=old --disable-dev-shm-usage'
		],
		cwd: Option.none(),
		label: {detail: 'renderer', name: 'chrome-headless-shell'}
	},
	{
		argv: [
			'/home/mp281x/.t3/tools/cloudflared/2026.10.4/linux-x64/cloudflared',
			'tunnel',
			'--no-autoupdate',
			'--loglevel',
			'info',
			'--output',
			'default',
			'--metrics',
			'127.0.0.1:0',
			'run'
		],
		cwd: Option.none(),
		label: {detail: 'tunnel run', name: 'cloudflared'}
	}
]

it('labels real process arguments by their program, app and subject flags', () => {
	assert.lengthOf(labelCases, 10)
	Array.forEach(labelCases, entry => assert.deepStrictEqual(commandLabel(entry.argv, entry.cwd), entry.label))
})

it('measures CPU as a share of machine capacity without reusing a PID or bridging counter resets and idle gaps', () => {
	const previous = {
		records: [
			{
				owner: Option.none<AppId>(),
				process: Schema.decodeSync(Process)({
					label: {detail: '', name: 'node'},
					memory: 1024,
					name: 'node',
					parent: 1,
					pid: 42
				}),
				start: DateTime.makeUnsafe(100),
				ticks: Duration.millis(10)
			}
		],
		time: DateTime.makeUnsafe(0),
		total: Duration.millis(800)
	}
	const current = {
		...previous,
		records: Array.map(previous.records, record => ({...record, ticks: Duration.millis(60)})),
		time: DateTime.makeUnsafe(10_000),
		total: Duration.millis(1000)
	}
	const baseline = Option.some(processReadings(previous, Option.none()))
	assert.deepStrictEqual(processReadings(current, baseline).readings[0]?.process.cpu, Option.some(25))
	assert.deepStrictEqual(processReadings(current, Option.none()).readings[0]?.process.cpu, Option.none())
	assert.deepStrictEqual(
		processReadings({...current, time: DateTime.makeUnsafe(100)}, baseline).readings[0]?.process.cpu,
		Option.none()
	)
	// A reading 30 seconds on still measures; one past 90 seconds does not.
	assert.deepStrictEqual(
		processReadings({...current, time: DateTime.makeUnsafe(30_000)}, baseline).readings[0]?.process.cpu,
		Option.some(25)
	)
	assert.deepStrictEqual(
		processReadings({...current, time: DateTime.makeUnsafe(91_000)}, baseline).readings[0]?.process.cpu,
		Option.none()
	)
	assert.deepStrictEqual(
		processReadings({...current, total: Duration.millis(100)}, baseline).readings[0]?.process.cpu,
		Option.none()
	)
	assert.deepStrictEqual(
		processReadings(
			{...current, records: Array.map(current.records, record => ({...record, start: DateTime.makeUnsafe(101)}))},
			baseline
		).readings[0]?.process.cpu,
		Option.none()
	)
})

it('shares meaningful CPU deltas between staggered viewers without returning stale memory or reused-PID CPU', () => {
	const first = processReadings(reading(0), Option.none())
	const early = processReadings(reading(1000), Option.some(first))
	assert.deepStrictEqual(early.readings[0]?.process.cpu, Option.none())
	// A process the cached read can't measure carries no cpu key, so the snapshot it lands in still validates.
	assert.deepStrictEqual(Schema.encodeSync(Process)(Option.getOrThrow(Array.head(early.readings)).process), {
		label: {detail: '', name: 'node'},
		memory: 1000,
		name: 'node',
		parent: 1,
		pid: 42
	})
	assert.strictEqual(DateTime.toEpochMillis(early.baseline.time), 0)
	const viewerA = processReadings(reading(5000), Option.some(early))
	const viewerB = processReadings(reading(6000), Option.some(viewerA))
	assert.deepStrictEqual(viewerA.readings[0]?.process.cpu, Option.some(25))
	assert.deepStrictEqual(viewerB.readings[0]?.process.cpu, Option.some(25))
	assert.strictEqual(viewerB.readings[0]?.process.memory, 6000)
	assert.strictEqual(DateTime.toEpochMillis(viewerB.baseline.time), 5000)
	assert.deepStrictEqual(
		processReadings(
			{
				...reading(6500),
				records: Array.map(reading(6500).records, record => ({...record, start: DateTime.makeUnsafe(101)}))
			},
			Option.some(viewerB)
		).readings[0]?.process.cpu,
		Option.none()
	)
	assert.deepStrictEqual(
		processReadings(reading(10_000), Option.some(viewerB)).readings[0]?.process.cpu,
		Option.some(25)
	)
})

it('attaches only the exact service cgroup in the right scope, or the actual Docker container', () => {
	const item = Schema.decodeSync(InventoryItem)({
		detail: '',
		id: 'dev:user:scope.service',
		kind: 'service',
		name: 'scope.service',
		scope: 'user',
		state: 'running',
		url: '',
		worker: 'dev'
	})
	const process = Schema.decodeSync(Process)({
		label: {detail: '', name: 'node'},
		memory: 1024,
		name: 'node',
		parent: 7,
		pid: 42
	})
	const rows = [
		{owner: processOwner('0::/user.slice/user-1000.slice/user@1000.service/app.slice/scope.service\n'), process}
	]
	assert.deepStrictEqual(attachProcesses([item], rows)[0]?.processes, Option.some([process]))
	assert.deepStrictEqual(
		attachProcesses([{...item, scope: Option.some('system')}], rows)[0]?.processes,
		Option.some([])
	)
	assert.isEmpty(
		Option.getOrElse(
			attachProcesses([item], [{owner: processOwner('0::/user.slice/scope.service-other\n'), process}])[0]?.processes ??
				Option.none(),
			() => []
		)
	)
	assert.deepStrictEqual(
		attachProcesses(
			[{...item, id: ItemId.make('dev:docker:abcdef123456'), kind: 'container'}],
			[{owner: processOwner('0::/system.slice/docker-abcdef123456789.scope\n'), process}]
		)[0]?.processes,
		Option.some([process])
	)
	assert.deepStrictEqual(
		attachProcesses(
			[{...item, kind: 'service', name: UnitId.make('user@1000.service'), scope: Option.some('system')}],
			[{owner: processOwner('0::/user.slice/user-1000.slice/user@1000.service/init.scope\n'), process}]
		)[0]?.processes,
		Option.some([process])
	)
	assert.deepStrictEqual(
		attachProcesses(
			[{...item, kind: 'service', name: UnitId.make('user@1000.service'), scope: Option.some('system')}],
			rows
		)[0]?.processes,
		Option.some([])
	)
})
