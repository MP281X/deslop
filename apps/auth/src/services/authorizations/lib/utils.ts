import {Array, Result, String, pipe} from 'effect'

import {Url} from 'effect/http'

// What someone typed, as the request id it names: letters only, in capitals.
export function typedCode(text: string) {
	return String.toUpperCase(String.replaceAll(/[^a-z]/giu, '')(text))
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
		) ||
		Result.match(Url.fromString(redirect), {
			onFailure: () => false,
			onSuccess: target =>
				target.protocol === 'http:' &&
				(target.hostname === '127.0.0.1' || target.hostname === 'localhost') &&
				String.isEmpty(target.username) &&
				String.isEmpty(target.password) &&
				String.isEmpty(target.search) &&
				String.isEmpty(target.hash)
		})
	)
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
