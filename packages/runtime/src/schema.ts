// fallow-ignore-file unused-type -- Paired schema types are available to runtime consumers.
import {Array, Number, Option, Schema} from 'effect'

import {User} from '#auth/schema.ts'

type HttpUrl = typeof HttpUrl.Type
const HttpUrl = Schema.String.check(
	Schema.makeFilter(
		(value: string) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			return (
				Array.contains(['http:', 'https:'], url.protocol) &&
				url.username === '' &&
				url.password === '' &&
				url.hash === ''
			)
		},
		{expected: 'an HTTP(S) URL without credentials or a fragment'}
	)
)

export type Origin = typeof Origin.Type
export const Origin = HttpUrl.check(
	Schema.makeFilter(
		(value: string) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			return url.pathname === '/' && url.search === ''
		},
		{expected: 'an HTTP(S) origin without a path or query'}
	)
)

export type SecureOrigin = typeof SecureOrigin.Type
export const SecureOrigin = Origin.check(
	Schema.makeFilter(
		(value: string) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			return url.protocol === 'https:' || Array.contains(['localhost', '127.0.0.1', '[::1]'], url.hostname)
		},
		{expected: 'HTTPS outside loopback'}
	)
)

export type Port = typeof Port.Type
export const Port = Schema.String.check(
	Schema.isPattern(/^\d{1,5}$/u),
	Schema.makeFilter((value: string) => Option.exists(Number.parse(value), port => port >= 1 && port <= 65_535), {
		expected: 'a port between 1 and 65535'
	})
)

export type AppVersion = typeof AppVersion.Type
export const AppVersion = Schema.String.check(Schema.isPattern(/^0\.1\.\d+$/u))

export type RuntimeConfig = typeof RuntimeConfig.Type
// What `/api/runtime` tells clients and Auth: the app's name, the Auth it signs in through, where it exports traces and its release.
export const RuntimeConfig = Schema.Struct({
	auth: Schema.optionalKey(Schema.String),
	name: Schema.String,
	traces: Schema.String,
	version: AppVersion
})

// The socket every app serves its contracts on and every client opens: web, iOS and a peer worker.
export const RPC_PATH = '/api/rpc'

// Who the app bar's account menu shows; `signOut` is false without an issuer, where everyone is the developer.
export type Account = typeof Account.Type
export const Account = Schema.Struct({...User.fields, signOut: Schema.Boolean})

// The app's package: its name, release and the port it listens on by default.
export type PackageMetadata = typeof PackageMetadata.Type
export const PackageMetadata = Schema.Struct({
	config: Schema.Struct({port: Schema.Int}),
	name: Schema.String,
	version: AppVersion
})
