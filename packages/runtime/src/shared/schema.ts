import {Array, Number, Option, Result, Schema} from 'effect'

import {Url} from 'effect/http'

import {User} from '#shared/auth.ts'

type HttpUrl = typeof HttpUrl.Type
const HttpUrl = Schema.String.check(
	Schema.makeFilter(
		(value: string) =>
			Option.exists(
				Result.getSuccess(Url.fromString(value)),
				url =>
					Array.contains(['http:', 'https:'], url.protocol) &&
					url.username === '' &&
					url.password === '' &&
					url.hash === ''
			),
		{expected: 'an HTTP(S) URL without credentials or a fragment'}
	)
)

const Origin = HttpUrl.check(
	Schema.makeFilter(
		(value: string) =>
			Option.exists(Result.getSuccess(Url.fromString(value)), url => url.pathname === '/' && url.search === ''),
		{expected: 'an HTTP(S) origin without a path or query'}
	)
)

export type SecureOrigin = typeof SecureOrigin.Type
export const SecureOrigin = Origin.check(
	Schema.makeFilter(
		(value: string) =>
			Option.exists(
				Result.getSuccess(Url.fromString(value)),
				url => url.protocol === 'https:' || Array.contains(['localhost', '127.0.0.1', '[::1]'], url.hostname)
			),
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

export const RUNTIME_PATH = '/api/runtime'

export const ACCOUNT_PATH = '/api/account'

export type RuntimeConfig = typeof RuntimeConfig.Type
export const RuntimeConfig = Schema.Struct({
	auth: Schema.OptionFromOptionalKey(Origin),
	name: Schema.String,
	traces: Schema.OptionFromOptionalKey(Origin),
	version: AppVersion
})

export const RPC_PATH = '/api/rpc'

export const MCP_PATH = '/mcp'

// The browser's installable web app manifest.
export const MANIFEST_PATH = '/manifest.webmanifest'

// `signOut` is true only for a browser signed in at Auth; the developer and tailnet callers have nothing to end.
export type Account = typeof Account.Type
export const Account = Schema.Struct({...User.fields, signOut: Schema.Boolean})

export type PackageMetadata = typeof PackageMetadata.Type
export const PackageMetadata = Schema.Struct({
	config: Schema.Struct({port: Schema.Int}),
	name: Schema.String,
	version: AppVersion
})
