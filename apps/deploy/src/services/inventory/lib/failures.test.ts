import {assert, it} from '@effect/vitest'

import {DateTime, Option, Record} from 'effect'

import {exitFailure, unitFailures} from './failures.ts'

import {UnitId} from '#services/inventory/schema.ts'

it('distinguishes a failed start from a process exit and retains when it failed', () => {
	const failures = unitFailures(
		'Id=app.service\nResult=exit-code\nExecMainCode=0\nExecMainStatus=203\nStateChangeTimestamp=@123\n\nId=worker.service\nResult=exit-code\nExecMainCode=1\nExecMainStatus=137\nStateChangeTimestamp=@124\n'
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

it('explains a signalled launch agent and a numeric exit separately', () => {
	assert.strictEqual(exitFailure(-11), 'Killed by SIGSEGV')
	assert.strictEqual(exitFailure(2), 'Exited with code 2')
})
