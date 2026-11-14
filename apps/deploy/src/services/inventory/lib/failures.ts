import {Array, DateTime, Function, Match, Number, Option, Record, String, pipe} from 'effect'

import {UnitId} from '#services/inventory/schema.ts'

const SIGNALS: Record<number, string> = {
	1: 'SIGHUP',
	2: 'SIGINT',
	6: 'SIGABRT',
	9: 'SIGKILL',
	11: 'SIGSEGV',
	15: 'SIGTERM'
}

function failureReason(result: string, status: number, ran: boolean) {
	if (result === 'exit-code' && !ran) return 'Failed before starting'
	const signal = SIGNALS[status] ?? `signal ${status}`
	return pipe(
		Match.value(result),
		Match.when('exit-code', () =>
			Option.match(Option.fromUndefinedOr(SIGNALS[status - 128]), {
				onNone: () => `Exited with code ${status}`,
				onSome: name => `Exited with code ${status} (${name})`
			})
		),
		Match.when('signal', () => `Killed by ${signal}`),
		Match.when('core-dump', () => `Crashed with ${signal}`),
		Match.when('oom-kill', Function.constant('Killed for running out of memory')),
		Match.when('timeout', Function.constant('Timed out')),
		Match.when('watchdog', Function.constant('Stopped answering its watchdog')),
		Match.when('start-limit-hit', Function.constant('Restarted too often')),
		Match.orElse(() => `Failed: ${result}`)
	)
}

// Why a launch agent stopped, from the last exit status `launchctl list` shows: a negative one is the signal that ended it.
export function exitFailure(status: number) {
	if (status < 0) return failureReason('signal', -status, true)
	return failureReason('exit-code', status, true)
}

// Why each failed unit stopped and when, by unit, from `systemctl show -p Id,Result,ExecMainCode,ExecMainStatus,StateChangeTimestamp --timestamp=unix`.
export function unitFailures(text: string) {
	return pipe(
		String.trim(text),
		String.split(/\n\s*\n/u),
		Array.filter(String.isNonEmpty),
		Record.fromIterableWith(block => {
			const fields = pipe(
				block,
				String.split('\n'),
				Array.filter(String.includes('=')),
				Record.fromIterableWith(line => {
					const [key, ...value] = String.split(line, '=')
					return [key, Array.join(value, '=')] as const
				})
			)
			return [
				UnitId.make(fields['Id'] ?? ''),
				{
					at: Option.map(Number.parse(String.replace(/^@/u, '')(fields['StateChangeTimestamp'] ?? '')), seconds =>
						DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => seconds * 1000)
					),
					// A unit whose start step failed never ran its main process, which leaves its code 0.
					reason: failureReason(
						fields['Result'] ?? '',
						Option.getOrElse(Number.parse(fields['ExecMainStatus'] ?? ''), Function.constant(0)),
						fields['ExecMainCode'] !== '0'
					)
				}
			] as const
		})
	)
}
