import {Array, DateTime, Filter, HashSet, Option, Record, Schema, String, pipe} from 'effect'

import {AppId, UnitId} from '#contracts'

import {APP_LIFECYCLE_MESSAGES, AppLifecycleEvent} from '#server/inventory/schema.ts'

const APP_UNIT = /^deslop-[a-z0-9-]+\.service$/u
const [STARTED, , RESTART_SCHEDULED] = APP_LIFECYCLE_MESSAGES

export function appUnitName(name: string) {
	return !String.endsWith('-update.service')(name) && Option.isSome(String.match(APP_UNIT)(name))
}

export function appUnit(id: AppId) {
	return pipe(
		id,
		String.match(/^service:user:(.+)$/u),
		Option.flatMap(match => Array.get(match, 1)),
		Option.filter(appUnitName),
		Option.map(name => UnitId.make(name))
	)
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
