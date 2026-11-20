import {Cache, Context, Effect, Exit, Function, Layer, Schema, String, pipe} from 'effect'

import {ChildProcessSpawner} from 'effect/process'

import {AppError, executeProcess} from '@deslop/runtime/server/process'
import {AuthError} from '@deslop/runtime/shared/auth'

import {StatusJson, WhoisJson} from './schema.ts'
import type {Status, Whois} from './schema.ts'

// Only Tailscale saying it knows no such peer refuses a caller; a stopped daemon or an unreadable answer is an outage.
function unavailable(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AppError)(cause) && String.includes('peer not found')(cause.message)) {
			return AuthError.make({cause, message: 'Sign in first'})
		}
		return AuthError.make({cause, error: 'temporarily_unavailable', message})
	})
}

export class Tailnet extends Context.Service<
	Tailnet,
	{
		readonly status: Effect.Effect<Status, AuthError>
		readonly whois: (address: string) => Effect.Effect<Whois, AuthError>
	}
>()('@deslop/auth/services/tailnet/service/Tailnet') {
	static readonly layer = Layer.effect(
		Tailnet,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			// An answer is kept a minute; a failure is asked again on the next request.
			const status = yield* Cache.makeWith(
				() =>
					pipe(
						executeProcess('tailscale', ['status', '--json'], {timeout: '10 seconds'}),
						Effect.flatMap(Schema.decodeUnknownEffect(StatusJson)),
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						unavailable('Cannot read the tailnet owner')
					),
				{
					capacity: 1,
					timeToLive: Exit.match({onFailure: Function.constant(0), onSuccess: Function.constant('1 minute')})
				}
			)
			const whois = yield* Cache.makeWith(
				(address: string) =>
					pipe(
						executeProcess('tailscale', ['whois', '--json', address], {timeout: '10 seconds'}),
						Effect.flatMap(Schema.decodeUnknownEffect(WhoisJson)),
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						unavailable('Cannot identify the tailnet caller')
					),
				{
					capacity: 1024,
					timeToLive: Exit.match({onFailure: Function.constant(0), onSuccess: Function.constant('1 minute')})
				}
			)

			return Tailnet.of({status: Cache.get(status, 'self'), whois: address => Cache.get(whois, address)})
		})
	)
}
