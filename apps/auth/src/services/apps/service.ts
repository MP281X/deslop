import type {Stream} from 'effect'
import {Array, Config, Context, Effect, Layer, Option, String, SubscriptionRef, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {AuthError, rejected} from '@deslop/runtime/shared/auth'
import {RUNTIME_PATH, RuntimeConfig} from '@deslop/runtime/shared/schema'

import {registerApp} from '#services/apps/lib/utils.ts'
import {App, Catalog} from '#services/apps/schema.ts'

export class Apps extends Context.Service<
	Apps,
	{readonly catalog: Stream.Stream<Catalog>; readonly register: (origin: string) => Effect.Effect<App, AuthError>}
>()('@deslop/auth/services/apps/service/Apps') {
	// Apps announce themselves at start; one is listed only when its own server names this Auth, and only on Auth's parent domain, where no stranger can host one.
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Catalog)
			const state = yield* SubscriptionRef.make<Catalog>(Option.getOrElse(yield* store.get('apps'), () => []))
			const self = new URL(yield* Config.String('APP_URL'))
			const domain = pipe(self.hostname, String.split('.'), Array.drop(1), Array.join('.'))
			const client = yield* HttpClient.HttpClient
			return Apps.of({
				catalog: SubscriptionRef.changes(state),
				register: Effect.fn('Apps.register')(function* (origin: string) {
					if (String.isEmpty(domain) || !String.endsWith(`.${domain}`)(new URL(origin).hostname)) {
						return yield* AuthError.make({error: 'access_denied', message: `Only apps on ${domain} are listed`})
					}
					const runtime = yield* pipe(
						client.get(new URL(RUNTIME_PATH, origin).href),
						Effect.flatMap(HttpClientResponse.filterStatusOk),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
						Effect.timeout('10 seconds'),
						rejected(`${origin} did not answer ${RUNTIME_PATH}`)
					)
					if (!Option.exists(Option.fromUndefinedOr(runtime.auth), auth => new URL(auth).origin === self.origin)) {
						return yield* AuthError.make({error: 'access_denied', message: `${origin} signs in elsewhere`})
					}
					const app = App.make({name: runtime.name, origin: new URL(origin).origin})
					yield* pipe(
						SubscriptionRef.updateEffect(state, current => {
							const next = registerApp(current, app)
							return Effect.as(store.set('apps', next), next)
						}),
						Effect.uninterruptible,
						rejected('The app list could not be saved')
					)
					return app
				})
			})
		})
	)
}
