import type {Stream} from 'effect'
import {Array, Boolean, Config, Context, Effect, Layer, Option, Order, String, SubscriptionRef, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {AuthError} from '@deslop/runtime/auth/schema'
import {rejected} from '@deslop/runtime/auth/utils'
import {RuntimeConfig} from '@deslop/runtime/schema'

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
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			return Apps.of({
				catalog: SubscriptionRef.changes(state),
				register: Effect.fn('Apps.register')(function* (origin: string) {
					if (String.isEmpty(domain) || !String.endsWith(`.${domain}`)(new URL(origin).hostname)) {
						return yield* AuthError.make({error: 'access_denied', message: `Only apps on ${domain} are listed`})
					}
					const runtime = yield* pipe(
						client.get(new URL('/api/runtime', origin).href),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
						Effect.timeout('10 seconds'),
						rejected(`${origin} did not answer /api/runtime`)
					)
					if (!Option.exists(Option.fromUndefinedOr(runtime.auth), auth => new URL(auth).origin === self.origin)) {
						return yield* AuthError.make({error: 'access_denied', message: `${origin} signs in elsewhere`})
					}
					// A web app serves its manifest; an iOS app's server has no pages and opens through the app's scheme.
					const web = yield* pipe(
						client.get(new URL('/manifest.webmanifest', origin).href),
						Effect.timeout('10 seconds'),
						Effect.as(true),
						Effect.orElseSucceed(() => false)
					)
					const app = App.make({
						name: runtime.name,
						open: Boolean.match(web, {onFalse: () => `${runtime.name}://`, onTrue: () => new URL(origin).origin}),
						origin: new URL(origin).origin
					})
					yield* pipe(
						SubscriptionRef.modifyEffect(state, current => {
							const next = Array.sort(
								[...Array.filter(current, known => known.origin !== app.origin), app],
								Order.mapInput(String.Order, (known: App) => known.name)
							)
							return Effect.as(store.set('apps', next), [undefined, next] as const)
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
