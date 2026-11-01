// fallow-ignore-file unused-type -- Paired schema types are available to runtime consumers.
import {Array, Schema} from 'effect'

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

export type OptionalAuth = typeof OptionalAuth.Type
export const OptionalAuth = Schema.Union([Schema.Literal(''), SecureOrigin])
export type TraceEndpoint = typeof TraceEndpoint.Type
export const TraceEndpoint = Schema.Union([Schema.Literal(''), HttpUrl])
export type Port = typeof Port.Type
export const Port = Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1}))
export type AppVersion = typeof AppVersion.Type
export const AppVersion = Schema.String.check(Schema.isPattern(/^0\.1\.\d+$/u))
export type RuntimeConfig = typeof RuntimeConfig.Type
export const RuntimeConfig = Schema.Struct({traces: TraceEndpoint, version: AppVersion})
