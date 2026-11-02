import {assert, it} from '@effect/vitest'

import {Effect, FileSystem, PlatformError, String, pipe} from 'effect'

import {attachProcesses, processes} from '#services/inventory/lib/processes.ts'
import {InventoryItem} from '#services/inventory/schema.ts'

it.effect('collects names with spaces, parent/RSS and tolerates an exited process without reading command lines', () =>
	pipe(
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* processes, [
				{
					cgroup: '0::/user.slice/scope.service\n',
					process: {memory: 1_048_576, name: 'Web Content', parent: 7, pid: 42}
				},
				{cgroup: '0::/user.slice/scope.service\n', process: {memory: 0, name: 'worker', parent: 1, pid: 7}}
			])
		}),
		Effect.provideService(
			FileSystem.FileSystem,
			FileSystem.makeNoop({
				readDirectory: () => Effect.succeed(['42', '7', '99', 'self']),
				readFileString: Effect.fnUntraced(function* (path) {
					if (String.endsWith('/cgroup')(path)) return '0::/user.slice/scope.service\n'
					if (path === '/proc/42/status') return 'Name:\tWeb Content\nPid:\t42\nPPid:\t7\nVmRSS:\t1024 kB\n'
					if (path === '/proc/7/status') return 'Name:\tworker\nPid:\t7\nPPid:\t1\n'
					return yield* PlatformError.badArgument({
						description: 'Process exited',
						method: 'readFileString',
						module: 'fixture'
					})
				})
			})
		)
	)
)

it('attaches only the exact service cgroup in the right scope, or the actual Docker container', () => {
	const item = InventoryItem.make({
		detail: '',
		id: 'dev:user:scope.service',
		kind: 'service',
		name: 'scope.service',
		scope: 'user',
		state: 'running',
		url: '',
		worker: 'dev'
	})
	const process = {memory: 1024, name: 'node', parent: 7, pid: 42}
	const rows = [{cgroup: '0::/user.slice/user-1000.slice/app.slice/scope.service\n', process}]
	assert.deepStrictEqual(attachProcesses([item], rows)[0]?.processes, [process])
	assert.isEmpty(attachProcesses([{...item, scope: 'system'}], rows)[0]?.processes ?? [])
	assert.isEmpty(
		attachProcesses([item], [{...rows[0], cgroup: '0::/user.slice/scope.service-other\n', process}])[0]?.processes ?? []
	)
	assert.deepStrictEqual(
		attachProcesses(
			[{...item, id: 'dev:docker:abcdef123456', kind: 'container'}],
			[{cgroup: '0::/system.slice/docker-abcdef123456789.scope\n', process}]
		)[0]?.processes,
		[process]
	)
})
