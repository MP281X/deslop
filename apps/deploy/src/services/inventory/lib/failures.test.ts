import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {unitFailures} from './failures.ts'

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
	assert.deepStrictEqual(failures['e2e-auth.service'], {at: 1_793_639_294_000, reason: 'Exited with code 130 (SIGINT)'})
	assert.deepStrictEqual(failures['killed.service'], {reason: 'Killed by SIGKILL'})
	assert.strictEqual(failures['heavy.service']?.reason, 'Killed for running out of memory')
	assert.strictEqual(failures['crash.service']?.reason, 'Exited with code 1')
	assert.strictEqual(failures['prestart.service']?.reason, 'Failed before starting')
	assert.deepStrictEqual(unitFailures(''), {})
})
