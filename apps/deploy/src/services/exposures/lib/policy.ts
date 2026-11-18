import {Array, Option, String, pipe} from 'effect'

import type {RuntimeConfig} from '@deslop/runtime/shared/schema'

import type {ExposeInput, Exposure} from '#services/exposures/schema.ts'
import {CADDY_ADMIN_PORT} from '#services/proxies/service.ts'

// What answers on a port, as Deploy reads it: the inventory's owner, none when nothing listens, and the Deslop runtime it reports, if any.
export type Listener = {readonly owner: Option.Option<string>; readonly runtime: Option.Option<RuntimeConfig>}

// Why `exposure` may not be published over what now listens on its port; none when it may.
export function refusal(exposure: Omit<ExposeInput, 'publicAccess'>, listener: Listener) {
	if (exposure.port === CADDY_ADMIN_PORT) return Option.some('Caddy’s admin port is never published')
	// A Deslop app runs as `deslop-<name>` and says so at its runtime endpoint; a preview or dev server only says so.
	return pipe(
		listener.runtime,
		Option.map(runtime => runtime.name),
		Option.orElse(() =>
			pipe(
				listener.owner,
				Option.flatMap(String.match(/^user:deslop-([a-z0-9-]+?)(?:\.service)?$/u)),
				Option.flatMap(match => Option.fromUndefinedOr(match[1]))
			)
		),
		Option.flatMap(name =>
			Option.match(listener.runtime, {
				onNone: () => Option.some(`${name} did not say how it runs; publish it once it answers`),
				onSome: runtime =>
					Option.match(runtime.auth, {
						// Without a domain the app treats every caller as its developer.
						onNone: () => Option.some(`${name} runs without a domain, so Deploy never publishes it`),
						onSome: auth => {
							if (exposure.name !== name) {
								return Option.some(`Port ${exposure.port} belongs to ${name}; publish it only under the name ${name}`)
							}
							const own = `${name}.${String.replace(/^https:\/\/auth\./u, '')(auth)}`
							if (exposure.kind === 'public' && exposure.hostname !== own) {
								return Option.some(`Publish ${name} only at ${own}`)
							}
							return Option.none()
						}
					})
			})
		)
	)
}

// Why `exposure` may not be saved beside the owned ones: its name is taken, or an owned exposure holds its hostname as a public site or on the same port; none when it may.
export function ownedConflict(owned: readonly Exposure[], exposure: Exposure) {
	if (Array.some(owned, row => row.name === exposure.name)) {
		return Option.some('Remove the existing owned exposure, and let its removal finish, before changing it')
	}
	if (
		Array.some(
			owned,
			row => row.hostname === exposure.hostname && (row.kind === 'public' || row.port === exposure.port)
		)
	) {
		return Option.some('This hostname or port already has an owned exposure')
	}
	return Option.none()
}

// Why a saved exposure is not published again, checked at every restore: nothing listens on its port, its port changed owner, or it may no longer be published.
export function restoreRefusal(row: Exposure, listener: Listener) {
	return Option.match(listener.owner, {
		onNone: () => Option.some(`Nothing listens on 127.0.0.1:${row.port}, so it is not published until its owner does`),
		onSome: current =>
			pipe(
				row.owner,
				Option.filter(saved => saved !== current),
				Option.map(saved => `Port ${row.port} now belongs to ${current}, not ${saved}, so it is not published again`),
				Option.orElse(() => refusal(row, listener))
			)
	})
}
