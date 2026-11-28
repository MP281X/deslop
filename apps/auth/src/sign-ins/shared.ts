import {Array, Option, Result, String, pipe} from 'effect'

import {Url} from 'effect/http'

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
