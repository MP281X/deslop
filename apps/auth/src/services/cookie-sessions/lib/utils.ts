import {Array, Function, Result, String, pipe} from 'effect'

import {Url} from 'effect/http'

export function parentDomain(canonical: string) {
	return pipe(new URL(canonical).hostname, String.split('.'), Array.drop(1), Array.join('.'))
}
export function returnable(next: string, canonical: string, local: boolean) {
	return Result.match(Url.fromString(next), {
		onFailure: Function.constFalse,
		onSuccess: target => {
			if (target.username !== '' || target.password !== '') return false
			if (local) return target.origin === new URL(canonical).origin
			return (
				target.protocol === 'https:' &&
				(target.hostname === parentDomain(canonical) || String.endsWith(`.${parentDomain(canonical)}`)(target.hostname))
			)
		}
	})
}
