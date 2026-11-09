import {Schema} from 'effect'

import {SecureOrigin} from '@deslop/runtime/schema'

export type App = typeof App.Type
export const App = Schema.Struct({name: Schema.NonEmptyString, open: Schema.NonEmptyString, origin: SecureOrigin})

export type Catalog = typeof Catalog.Type
export const Catalog = Schema.Array(App)

export type AppParams = typeof AppParams.Type
export const AppParams = Schema.Struct({origin: SecureOrigin})
