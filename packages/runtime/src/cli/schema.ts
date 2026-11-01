// fallow-ignore-file unused-type -- Paired schema types are available to CLI/runtime consumers.
import {Schema} from 'effect'

import {AppVersion, OptionalAuth, Origin, Port, TraceEndpoint} from '#schema.ts'

export class AppError extends Schema.TaggedError<AppError>()('AppError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type AppSettings = typeof AppSettings.Type
export const AppSettings = Schema.Struct({
	auth: OptionalAuth,
	host: Schema.NonEmptyString,
	port: Port,
	traces: TraceEndpoint,
	url: Origin
}).check(
	Schema.makeFilter(value => value.auth === '' || new URL(value.url).protocol === 'https:', {
		expected: 'a canonical HTTPS app origin when Auth is enabled'
	})
)

export type AppManifest = typeof AppManifest.Type
export const AppManifest = Schema.Struct({version: AppVersion})

export type OAuthDiscovery = typeof OAuthDiscovery.Type
export const OAuthDiscovery = Schema.Struct({
	authorization_endpoint: Schema.String,
	issuer: Schema.String,
	registration_endpoint: Schema.String,
	token_endpoint: Schema.String
})

export type PackageMetadata = typeof PackageMetadata.Type
export const PackageMetadata = Schema.Struct({
	bin: Schema.Record(Schema.String, Schema.String),
	engines: Schema.Struct({node: Schema.String}),
	name: Schema.String,
	repository: Schema.Struct({directory: Schema.String, type: Schema.String, url: Schema.String}),
	version: AppVersion
})
