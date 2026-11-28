import {Array, Function, Option, String, pipe} from 'effect'

// An Android agent also names Linux, so the order decides.
const DEVICES = [
	{name: 'iPhone', token: 'iPhone'},
	{name: 'iPad', token: 'iPad'},
	{name: 'Android', token: 'Android'},
	{name: 'Mac', token: 'Macintosh'},
	{name: 'Windows', token: 'Windows'},
	{name: 'Linux', token: 'Linux'}
] as const

// Edge and Opera keep Chrome's token, and Chrome and Firefox on iOS keep Safari's, so the first match wins.
const BROWSERS = [
	{name: 'Edge', tokens: ['Edg/', 'EdgA/', 'EdgiOS/']},
	{name: 'Opera', tokens: ['OPR/']},
	{name: 'Firefox', tokens: ['Firefox/', 'FxiOS/']},
	{name: 'Chrome', tokens: ['Chrome/', 'CriOS/']},
	{name: 'Safari', tokens: ['Safari/']}
] as const

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
