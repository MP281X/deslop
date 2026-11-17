import {Cache, Context, Effect, Function, Layer, Schema, pipe} from 'effect'

import {ChildProcessSpawner} from 'effect/process'

import {executeProcess} from '@deslop/runtime/server/process'
import type {AuthError} from '@deslop/runtime/shared/auth'
import {asAuthError} from '@deslop/runtime/shared/auth'

import {Status, Whois} from './schema.ts'

export class Tailnet extends Context.Service<
	Tailnet,
	{
		readonly status: Effect.Effect<typeof Status.Type, AuthError>
		readonly whois: (address: string) => Effect.Effect<typeof Whois.Type, AuthError>
	}
>()('@deslop/auth/services/tailnet/service/Tailnet') {
	static readonly layer = Layer.effect(
		Tailnet,
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			const status = yield* Cache.makeWith(
				() =>
					pipe(
						executeProcess('tailscale', ['status', '--json']),
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Status))),
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						Effect.timeout('10 seconds'),
						asAuthError('Cannot read the tailnet owner')
					),
				{capacity: 1, timeToLive: Function.constant('1 minute')}
			)
			const whois = yield* Cache.makeWith(
				(address: string) =>
					pipe(
						executeProcess('tailscale', ['whois', '--json', address]),
						Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Whois))),
						Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
						Effect.timeout('10 seconds'),
						asAuthError('Cannot identify the tailnet caller')
					),
				{capacity: 1024, timeToLive: Function.constant('1 minute')}
			)

			return Tailnet.of({status: Cache.get(status, 'self'), whois: address => Cache.get(whois, address)})
		})
	)
}
