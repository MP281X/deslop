import {Schema, pipe} from 'effect'

import {Model} from 'effect/schema'

import {SecureOrigin} from '@deslop/runtime/shared/schema'

export type AppOrigin = typeof AppOrigin.Type
export const AppOrigin = pipe(SecureOrigin, Schema.brand('AuthAppOrigin'))

// One row of `apps`, and what the sign-in page lists: an app whose own server named this Auth.
export class App extends Model.Class<App>('App')({name: Schema.NonEmptyString, origin: AppOrigin}) {
	static readonly table = 'apps'
}

export type Catalog = typeof Catalog.Type
export const Catalog = Schema.Array(App.json)

export type AppParams = typeof AppParams.Type
export const AppParams = Schema.Struct({origin: AppOrigin})
