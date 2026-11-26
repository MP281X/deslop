import {Array, String, pipe} from 'effect'

export function rowLine(parts: readonly unknown[]) {
	return pipe(parts, Array.filter(String.isString), Array.join(' · '))
}
