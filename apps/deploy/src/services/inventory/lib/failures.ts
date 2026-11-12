import {Array, Match, Number, Option, Record, String, pipe} from 'effect'

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
		Match.when('oom-kill', () => 'Killed for running out of memory'),
		Match.when('timeout', () => 'Timed out'),
		Match.when('watchdog', () => 'Stopped answering its watchdog'),
		Match.when('start-limit-hit', () => 'Restarted too often'),
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
	return Record.fromEntries(
		Array.map(Array.filter(String.split(String.trim(text), /\n\s*\n/u), String.isNonEmpty), block => {
			const fields = Record.fromEntries(
				Array.map(Array.filter(String.split(block, '\n'), String.includes('=')), line => {
					const [key, ...value] = String.split(line, '=')
					return [key, Array.join(value, '=')] as const
				})
			)
			return [
				fields['Id'] ?? '',
				{
					...Option.match(Number.parse(String.replace(/^@/u, '')(fields['StateChangeTimestamp'] ?? '')), {
						onNone: () => ({}),
						onSome: seconds => ({at: seconds * 1000})
					}),
					// A unit whose start step failed never ran its main process, which leaves its code 0.
					reason: failureReason(
						fields['Result'] ?? '',
						Option.getOrElse(Number.parse(fields['ExecMainStatus'] ?? ''), () => 0),
						fields['ExecMainCode'] !== '0'
					)
				}
			] as const
		})
	)
}
