import {
	Array,
	Boolean,
	DateTime,
	Filter,
	Function,
	HashSet,
	Iterable,
	Match,
	Number,
	Option,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {APP_LIFECYCLE_MESSAGES, AppId, AppLifecycleEvent, ProcessIdFromString, UnitId} from './contract.ts'
import type {ServiceScope} from './contract.ts'
import {ipv4Reachable} from './shared.ts'

const APP_UNIT = /^deslop-[a-z0-9-]+\.service$/u

const SIGNALS: Record<number, string> = {
	1: 'SIGHUP',
	2: 'SIGINT',
	6: 'SIGABRT',
	9: 'SIGKILL',
	11: 'SIGSEGV',
	15: 'SIGTERM'
}

const [STARTED, , RESTART_SCHEDULED] = APP_LIFECYCLE_MESSAGES

export function appUnitName(name: string) {
	return !String.endsWith('-update.service')(name) && Option.isSome(String.match(APP_UNIT)(name))
}

// The installer puts apps, not update jobs or helper services, in this slice.
export function ownedUnits(text: string) {
	return pipe(
		String.trim(text),
		String.split(/\n\s*\n/u),
		Array.filterMap(
			Filter.fromPredicateOption(block => {
				const fields = Record.fromEntries(
					pipe(
						block,
						String.split('\n'),
						Array.filterMap(
							Filter.fromPredicateOption(line =>
								Option.map(
									String.indexOf('=')(line),
									at => [String.slice(0, at)(line), String.slice(at + 1)(line)] as const
								)
							)
						)
					)
				)
				const name = fields['Id'] ?? ''
				const type = fields['Type'] ?? ''
				return Option.liftPredicate(
					UnitId.make(name),
					unit =>
						appUnitName(unit) &&
						fields['LoadState'] === 'loaded' &&
						fields['Slice'] === 'deslop.slice' &&
						fields['TriggeredBy'] === '' &&
						type !== '' &&
						type !== 'oneshot'
				)
			})
		),
		HashSet.fromIterable
	)
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

// Why each failed unit stopped and when, by unit, from `systemctl show -p Id,ActiveState,Result,ExecMainCode,ExecMainStatus,StateChangeTimestamp --timestamp=unix`. A unit that recovered between its listing and this read is no longer failed, so it has no reason.
export function unitFailures(text: string) {
	return pipe(
		String.trim(text),
		String.split(/\n\s*\n/u),
		Array.filter(String.isNonEmpty),
		Array.flatMap(block => {
			const fields = pipe(
				block,
				String.split('\n'),
				Array.filter(String.includes('=')),
				Record.fromIterableWith(line => {
					const [key, ...value] = String.split(line, '=')
					return [key, Array.join(value, '=')] as const
				})
			)
			const id = fields['Id'] ?? ''
			const result = fields['Result'] ?? ''
			const status = Number.parse(fields['ExecMainStatus'] ?? '')
			if (
				!String.isNonEmpty(id) ||
				!String.isNonEmpty(fields['ExecMainCode'] ?? '') ||
				fields['ActiveState'] !== 'failed' ||
				!String.isNonEmpty(result) ||
				result === 'success'
			) {
				return []
			}
			return Option.match(status, {
				onNone: () => [],
				onSome: exitStatus => [
					[
						UnitId.make(id),
						{
							at: Option.map(Number.parse(String.replace(/^@/u, '')(fields['StateChangeTimestamp'] ?? '')), seconds =>
								DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => seconds * 1000)
							),
							// A unit whose start step failed never ran its main process, which leaves its code 0.
							reason: failureReason(result, exitStatus, fields['ExecMainCode'] !== '0')
						}
					] as const
				]
			})
		}),
		Record.fromEntries
	)
}

export function socketLine(line: string) {
	const fields = String.split(String.trim(line), /\s+/u)
	const address = fields[4] ?? ''
	const state = fields[1] ?? ''
	if (!Array.contains(['tcp', 'udp'], fields[0]) || !String.isNonEmpty(state) || !String.isNonEmpty(address)) {
		return Option.none()
	}
	return Option.map(Number.parse(Array.lastNonEmpty(String.split(address, ':'))), port => ({
		address,
		port,
		// A name may itself hold a quote; it ends at the quote before its pid.
		process: Option.flatMap(String.match(/users:\(\("(.+?)",pid=([0-9]+)/u)(line), match =>
			Option.map(Schema.decodeOption(ProcessIdFromString)(match[2] ?? ''), pid => ({name: match[1] ?? '', pid}))
		),
		protocol: fields[0],
		state
	}))
}

export function probeSocket(listener: Option.Option.Value<ReturnType<typeof socketLine>>, process: string) {
	return (
		listener.protocol === 'tcp' &&
		listener.port >= 1024 &&
		ipv4Reachable(listener.address) &&
		Option.isNone(String.match(/^(?:postgres|redis|ssh|cloudflared|tailscaled|caddy)$/u)(process))
	)
}

// The service a cgroup path names, and whether a user manager runs it, so a user and a system unit of one name stay apart.
export function socketUnit(cgroup: string) {
	return Option.map(
		Iterable.findLast(String.matchAll(/\/([^/]+\.service)(?=\/|\n|$)/gu)(cgroup), Function.constTrue),
		match => ({
			scope: Boolean.match(Option.isSome(String.match(/\/user@[0-9]+\.service\/.*\.service(?:\/|\n|$)/u)(cgroup)), {
				onFalse: Function.constant<ServiceScope>('system'),
				onTrue: Function.constant<ServiceScope>('user')
			}),
			unit: UnitId.make(match[1] ?? '')
		})
	)
}

export type AppAction = typeof AppAction.Type

const AppAction = Schema.Literals(['restart', 'stop'])

export function appUnit(id: AppId) {
	return pipe(
		id,
		String.match(/^service:user:(.+)$/u),
		Option.flatMap(match => Array.get(match, 1)),
		Option.filter(appUnitName),
		Option.map(name => UnitId.make(name))
	)
}

export function ownedProcess(uid: number, cgroup: string) {
	return pipe(
		cgroup,
		String.match(/^0::\/user\.slice\/user-(\d+)\.slice\/user@(\d+)\.service\/deslop\.slice\/([^/\n]+)/u),
		Option.filter(match => match[1] === `${uid}` && match[2] === `${uid}`),
		Option.flatMap(match => Array.get(match, 3)),
		Option.filter(appUnitName),
		Option.map(unit => AppId.make(`service:user:${unit}`))
	)
}

// A completed start needs evidence of an earlier run in this boot. A stop or scheduled restart can supply it after the earlier start has rotated away.
export function restartTimes(text: string, after: DateTime.Utc, now: DateTime.Utc) {
	return pipe(
		text,
		String.split('\n'),
		Array.filterMap(Filter.fromPredicateOption(line => Schema.decodeOption(AppLifecycleEvent)(line))),
		Array.reduce(
			{boots: HashSet.empty<string>(), invocations: HashSet.empty<string>(), restarts: Array.empty<DateTime.Utc>()},
			(state, entry) => {
				const boots = HashSet.add(state.boots, entry._BOOT_ID)
				if (entry.MESSAGE_ID === RESTART_SCHEDULED) return {...state, boots}
				const id = entry.USER_INVOCATION_ID ?? ''
				if (id === '' || HashSet.has(state.invocations, id)) return state
				const time = DateTime.makeUnsafe(Math.floor(entry.__REALTIME_TIMESTAMP / 1000))
				if (
					entry.MESSAGE_ID === STARTED &&
					HashSet.has(state.boots, entry._BOOT_ID) &&
					DateTime.isGreaterThan(time, after) &&
					DateTime.isLessThanOrEqualTo(time, now)
				) {
					return {boots, invocations: HashSet.add(state.invocations, id), restarts: Array.append(state.restarts, time)}
				}
				return {...state, boots, invocations: HashSet.add(state.invocations, id)}
			}
		),
		state => state.restarts
	)
}
