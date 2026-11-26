import {assert, it} from '@effect/vitest'

import {DateTime, Option, Record} from 'effect'

import {UnitId} from '#contracts'

import {unitFailures} from './failures.ts'

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
