import {Array, Function, Option, Result, String, pipe} from 'effect'

import {Url} from 'effect/http'

import type {SessionDevice} from '#services/sessions/schema.ts'

// An Android agent also names Linux, so the order decides.
const DEVICES: readonly {name: SessionDevice; token: string}[] = [
	{name: 'iPhone', token: 'iPhone'},
	{name: 'iPad', token: 'iPad'},
	{name: 'Android', token: 'Android'},
	{name: 'Mac', token: 'Macintosh'},
	{name: 'Windows', token: 'Windows'},
	{name: 'Linux', token: 'Linux'}
]

// Edge and Opera keep Chrome's token, and Chrome and Firefox on iOS keep Safari's, so the first match wins.
const BROWSERS = [
	{name: 'Edge', tokens: ['Edg/', 'EdgA/', 'EdgiOS/']},
	{name: 'Opera', tokens: ['OPR/']},
	{name: 'Firefox', tokens: ['Firefox/', 'FxiOS/']},
	{name: 'Chrome', tokens: ['Chrome/', 'CriOS/']},
	{name: 'Safari', tokens: ['Safari/']}
] as const

export function parentDomain(canonical: string) {
	return pipe(new URL(canonical).hostname, String.split('.'), Array.drop(1), Array.join('.'))
}
// The parsed URL, not the string that was checked: parsing drops characters, such as a newline, that no Location header may carry.
export function returnTarget(next: string, canonical: string, local: boolean) {
	return pipe(
		Result.getSuccess(Url.fromString(next)),
		Option.filter(target => {
			if (target.username !== '' || target.password !== '') return false
			if (local) return target.origin === new URL(canonical).origin
			return (
				target.protocol === 'https:' &&
				(target.hostname === parentDomain(canonical) || String.endsWith(`.${parentDomain(canonical)}`)(target.hostname))
			)
		}),
		Option.map(target => target.href)
	)
}

export function deviceOf(userAgent: string) {
	return pipe(
		DEVICES,
		Array.findFirst(device => String.includes(device.token)(userAgent)),
		Option.map(device => device.name)
	)
}

export function browserOf(userAgent: string) {
	return pipe(
		BROWSERS,
		Array.findFirst(candidate => Array.some(candidate.tokens, token => String.includes(token)(userAgent))),
		Option.match({onNone: Function.constant('Browser'), onSome: found => found.name})
	)
}
