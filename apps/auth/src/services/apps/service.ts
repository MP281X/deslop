import type {Stream} from 'effect'
import {Array, Config, Context, Effect, Layer, Option, Schema, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {AuthError, asAuthError} from '@deslop/runtime/shared/auth'
import {RUNTIME_PATH, RuntimeConfig} from '@deslop/runtime/shared/schema'

import {App} from '#services/apps/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly apps: never
	}
}

export class Apps extends Context.Service<
	Apps,
	{
		readonly watch: Stream.Stream<readonly App[], AuthError>
		readonly register: (origin: string) => Effect.Effect<App, AuthError>
	}
>()('@deslop/auth/services/apps/service/Apps') {
	// The table this service owns, made at start; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_apps': Effect.flatMap(
					SqlClient.SqlClient,
					sql => sql`CREATE TABLE apps (origin TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT`
				)
			}),
			table: 'apps_migrations'
		})
	)

	// Apps announce themselves at start; one is listed only when its own server names this Auth, and only on Auth's parent domain, where no stranger can host one.
	static readonly layer = Layer.provide(
		Layer.effect(
			this,
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const self = new URL(yield* Config.String('APP_URL'))
				const domain = pipe(self.hostname, String.split('.'), Array.drop(1), Array.join('.'))
				const client = yield* HttpClient.HttpClient
				const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
				const listApps = SqlSchema.findAll({
					Request: Schema.Void,
					Result: App,
					execute: () => sql`SELECT * FROM ${sql(App.table)} ORDER BY name, origin`
				})
				// Announcing again, as each restart does, keeps one row and takes the app's current name.
				const saveApp = SqlSchema.void({
					Request: App.insert,
					execute: app => sql`
						INSERT INTO ${sql(App.table)} ${sql.insert(app)}
						ON CONFLICT (origin) DO UPDATE SET name = excluded.name
					`
				})
				return Apps.of({
					register: Effect.fn('Apps.register')(function* (origin: string) {
						if (String.isEmpty(domain) || !String.endsWith(`.${domain}`)(new URL(origin).hostname)) {
							return yield* AuthError.make({error: 'access_denied', message: `Only apps on ${domain} are listed`})
						}
						const runtime = yield* pipe(
							client.get(new URL(RUNTIME_PATH, origin).href),
							Effect.flatMap(HttpClientResponse.filterStatusOk),
							Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
							Effect.timeout('10 seconds'),
							asAuthError(`${origin} did not answer ${RUNTIME_PATH}`)
						)
						if (!Option.exists(Option.fromUndefinedOr(runtime.auth), auth => new URL(auth).origin === self.origin)) {
							return yield* AuthError.make({error: 'access_denied', message: `${origin} signs in elsewhere`})
						}
						const app = App.make({name: runtime.name, origin: new URL(origin).origin})
						yield* pipe(
							saveApp(app),
							Reactivity.mutation(['apps']),
							withReactivity,
							asAuthError('The app list could not be saved')
						)
						return app
					}),
					watch: sql.reactive(['apps'], asAuthError('Cannot read the apps')(listApps()))
				})
			})
		),
		this.migrations
	)
}
