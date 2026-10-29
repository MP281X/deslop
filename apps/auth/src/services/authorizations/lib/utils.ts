import {Array, Option, Result, String, pipe} from 'effect'

import {Url} from 'effect/http'

import type {Stored} from '#services/authorizations/schema.ts'

// What someone typed, as the request id it names: letters only, in capitals.
export function typedCode(text: string) {
	return String.toUpperCase(String.replaceAll(/[^a-z]/giu, '')(text))
}

function loopback(redirect: string) {
	return Option.filter(
		Result.getSuccess(Url.fromString(redirect)),
		target =>
			target.protocol === 'http:' &&
			Array.contains(['127.0.0.1', '[::1]', 'localhost'], target.hostname) &&
			String.isEmpty(target.username) &&
			String.isEmpty(target.password) &&
			String.isEmpty(target.search) &&
			String.isEmpty(target.hash)
	)
}

// The iOS apps in their release and Simulator builds, or a loopback callback of a desktop agent.
export function allowedRedirect(redirect: string) {
	return (
		Array.contains(
			[
				'stash://auth/callback',
				'stash-dev://auth/callback',
				'opm://auth/callback',
				'opm-dev://auth/callback',
				'trips://auth/callback',
				'trips-dev://auth/callback'
			],
			redirect
		) || Option.isSome(loopback(redirect))
	)
}

// A loopback callback as written, without its port: RFC 8252 §8.4 compares everything else exactly.
function portless(redirect: string) {
	return Option.map(
		Option.filter(
			String.match(/^(?<origin>http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost))(?::\d{1,5})?(?<rest>\/.*)?$/u)(redirect),
			() => Option.isSome(loopback(redirect))
		),
		found => `${found.groups?.['origin'] ?? ''}${found.groups?.['rest'] ?? ''}`
	)
}

// The callback a request names, or a client's only one when it names none; a loopback callback may use any port, as RFC 8252 §7.3 requires.
export function matchingRedirect(client: typeof Stored.cases.Client.Type, requested: Option.Option<string>) {
	return Option.match(requested, {
		onNone: () => Option.filter(Array.head(client.redirects), () => client.redirects.length === 1),
		onSome: asked =>
			Option.as(
				Array.findFirst(client.redirects, redirect => {
					if (redirect === asked) return true
					return Option.isSome(
						Option.flatMap(portless(redirect), saved => Option.filter(portless(asked), target => target === saved))
					)
				}),
				asked
			)
	})
}

// A parameter sent empty counts as left out, as OAuth 2.1 §3.1 requires.
export function given(value?: string) {
	return Option.filter(Option.fromUndefinedOr(value), String.isNonEmpty)
}

// The session cookie is shared with every app on the auth app's parent domain.
export function cookieDomain(url: string) {
	return pipe(new URL(url).hostname, String.split('.'), Array.drop(1), Array.join('.'))
}

// A web sign-in returns to the page that started it only over https on the auth app's own domain or a subdomain.
export function returnable(next: string, url: string) {
	const domain = cookieDomain(url)
	return Result.match(Url.fromString(next), {
		onFailure: () => false,
		onSuccess: target =>
			target.protocol === 'https:' &&
			(target.hostname === domain || String.endsWith(`.${domain}`)(target.hostname)) &&
			String.isEmpty(target.username) &&
			String.isEmpty(target.password)
	})
}
