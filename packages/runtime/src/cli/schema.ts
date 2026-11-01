// fallow-ignore-file unused-type -- Paired schema types are available to CLI/runtime consumers.
import {Schema} from 'effect'

export class AppError extends Schema.TaggedError<AppError>()('AppError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type AppSettings = typeof AppSettings.Type
export const AppSettings = Schema.Struct({
	auth: Schema.String,
	host: Schema.String,
	port: Schema.Int.check(Schema.isBetween({maximum: 65_535, minimum: 1})),
	public: Schema.Boolean,
	traces: Schema.String,
	url: Schema.String
})

export type AppManifest = typeof AppManifest.Type
export const AppManifest = Schema.Struct({version: Schema.String.check(Schema.isPattern(/^0\.1\.\d+$/u))})

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
	version: Schema.String
})
