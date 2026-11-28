import {assert, it} from '@effect/vitest'

import {Array, DateTime, HashSet, Option, Record, Schema} from 'effect'

import {APP_LIFECYCLE_MESSAGES, AppId, AppLifecycleEvent, UnitId} from './contract.ts'
import {appUnit, ownedProcess, ownedUnits, restartTimes, socketLine, unitFailures} from './parse.ts'
import {ipv4Reachable} from './shared.ts'

function unit(name: string, slice: string, trigger = '', type = 'simple') {
	return `Id=${name}.service\nLoadState=loaded\nSlice=${slice}.slice\nTriggeredBy=${trigger}\nType=${type}`
}

function entry(message: AppLifecycleEvent['MESSAGE_ID'], time: number, id: string, boot = 'a') {
	return Schema.encodeSync(AppLifecycleEvent)({
		__REALTIME_TIMESTAMP: time * 1000,
		_BOOT_ID: boot,
		MESSAGE_ID: message,
		USER_INVOCATION_ID: id
	})
}

it('accepts canonical apps in the managed user slice, but not helpers or jobs', () => {
	const properties = [
		unit('deslop-scope', 'deslop'),
		unit('deslop-metrics', 'deslop', 'job.timer'),
		unit('deslop-setup', 'deslop', '', 'oneshot'),
		unit('deslop-scope-update', 'deslop'),
		unit('deslop-caddy', 'app'),
		unit('foreign', 'deslop')
	]
	assert.deepStrictEqual(ownedUnits(Array.join(properties, '\n\n')), HashSet.make(UnitId.make('deslop-scope.service')))
	assert.deepStrictEqual(appUnit(AppId.make('service:system:deslop-scope.service')), Option.none())
	assert.deepStrictEqual(appUnit(AppId.make('service:user:deslop-*.service')), Option.none())
})

it('samples only processes in the matching user manager and slice', () => {
	const cgroup = '0::/user.slice/user-1000.slice/user@1000.service/deslop.slice/deslop-scope.service/worker\n'
	assert.deepStrictEqual(ownedProcess(1000, cgroup), Option.some(AppId.make('service:user:deslop-scope.service')))
	assert.deepStrictEqual(ownedProcess(1001, cgroup), Option.none())
})

it('marks a new invocation at the journalled start, not when the restart was queued', () => {
	const [started, stopped, scheduled] = APP_LIFECYCLE_MESSAGES
	const journal = Array.join(
		[
			entry(stopped, 300, 'old'),
			entry(started, 432, 'new'),
			entry(started, 500, 'new'),
			entry(started, 700, 'first', 'b'),
			entry(scheduled, 850, '', 'b'),
			entry(started, 921, 'second', 'b'),
			entry(scheduled, 950, '', 'b')
		],
		'\n'
	)
	assert.deepStrictEqual(restartTimes(journal, DateTime.makeUnsafe(350), DateTime.makeUnsafe(1000)), [
		DateTime.makeUnsafe(432),
		DateTime.makeUnsafe(921)
	])
})

it('distinguishes a failed start from a process exit and retains when it failed', () => {
	const failures = unitFailures(
		'Id=app.service\nActiveState=failed\nResult=exit-code\nExecMainCode=0\nExecMainStatus=203\nStateChangeTimestamp=@123\n\nId=worker.service\nActiveState=failed\nResult=exit-code\nExecMainCode=1\nExecMainStatus=137\nStateChangeTimestamp=@124\n'
	)
	assert.deepStrictEqual(
		Record.get(failures, UnitId.make('app.service')),
		Option.some({at: Option.some(DateTime.makeUnsafe(123_000)), reason: 'Failed before starting'})
	)
	assert.strictEqual(
		Option.getOrThrow(Record.get(failures, UnitId.make('worker.service'))).reason,
		'Exited with code 137 (SIGKILL)'
	)
})

it('gives no reason for a unit that recovered after it was listed', () => {
	assert.isTrue(
		Record.isEmptyRecord(
			unitFailures(
				'Id=systemd-journald.service\nActiveState=active\nResult=success\nExecMainCode=0\nExecMainStatus=0\nStateChangeTimestamp=@125\n'
			)
		)
	)
})

it('reads a quoted process name and keeps a dual-stack wildcard within loopback reach', () => {
	const socket = Option.getOrThrow(socketLine('tcp LISTEN 0 5 *:31000 *:* users:(("name"quote",pid=111,fd=5))'))
	assert.deepStrictEqual(
		Option.map(socket.process, process => process.name),
		Option.some('name"quote')
	)
	assert.isTrue(ipv4Reachable(socket.address))
	assert.isFalse(ipv4Reachable('[::]:31000'))
	assert.isFalse(ipv4Reachable('[::1]:31000'))
})
