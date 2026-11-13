import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option} from 'effect'

import {unitFailures} from './failures.ts'

import {UnitId} from '#services/inventory/schema.ts'

it('says why a failed service stopped and when, instead of repeating its command', () => {
	const failures = unitFailures(
		Array.join(
			[
				'Result=exit-code\nExecMainCode=1\nExecMainStatus=130\nId=e2e-auth.service\nStateChangeTimestamp=@1793639294',
				'Result=signal\nExecMainStatus=9\nId=killed.service\nStateChangeTimestamp=',
				'Result=oom-kill\nExecMainStatus=0\nId=heavy.service\nStateChangeTimestamp=@1',
				'Result=exit-code\nExecMainCode=1\nExecMainStatus=1\nId=crash.service\nStateChangeTimestamp=@2',
				'Result=exit-code\nExecMainCode=0\nExecMainStatus=0\nId=prestart.service\nStateChangeTimestamp=@3'
			],
			'\n\n'
		)
	)
	assert.deepStrictEqual(failures[UnitId.make('e2e-auth.service')], {
		at: Option.some(DateTime.makeUnsafe(1_793_639_294_000)),
		reason: 'Exited with code 130 (SIGINT)'
	})
	assert.deepStrictEqual(failures[UnitId.make('killed.service')], {at: Option.none(), reason: 'Killed by SIGKILL'})
	assert.strictEqual(failures[UnitId.make('heavy.service')]?.reason, 'Killed for running out of memory')
	assert.strictEqual(failures[UnitId.make('crash.service')]?.reason, 'Exited with code 1')
	assert.strictEqual(failures[UnitId.make('prestart.service')]?.reason, 'Failed before starting')
	assert.deepStrictEqual(unitFailures(''), {})
})
