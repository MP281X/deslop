import {Schema} from 'effect'

import {SecureOrigin} from '@deslop/runtime/schema'

// An app that signs in through this Auth, as its own server describes it; `open` is its site, or an iOS app's URL scheme.
export type App = typeof App.Type
export const App = Schema.Struct({name: Schema.NonEmptyString, open: Schema.NonEmptyString, origin: SecureOrigin})

export type Catalog = typeof Catalog.Type
export const Catalog = Schema.Array(App)

export type AppParams = typeof AppParams.Type
export const AppParams = Schema.Struct({origin: SecureOrigin})
