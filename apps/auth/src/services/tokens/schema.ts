import {Context, Schema, Struct, pipe} from 'effect'

import {Jwk} from 'effect/jose'
import {Model} from 'effect/schema'

import {ClientId, ClientRegistration, SignInFamily, User} from '@deslop/runtime/shared/auth'
import {DurationFromSeconds} from '@deslop/runtime/shared/time'

type TokenParts = typeof TokenParts.Type
export const TokenParts = Schema.Struct({
	family: SignInFamily,
	generation: Schema.OptionFromOptional(Schema.FiniteFromString),
	secret: Schema.NonEmptyString
})

export type IncarnationId = typeof IncarnationId.Type
export const IncarnationId = pipe(Schema.NonEmptyString, Schema.brand('IncarnationId'))

// Credentials retain the registration that issued them, never a later membership with the same GitHub id.
export type CredentialOwner = typeof CredentialOwner.Type
export const CredentialOwner = Schema.Struct({incarnation: IncarnationId, user: User})

export class CurrentOwner extends Context.Service<CurrentOwner, CredentialOwner>()(
	'@deslop/auth/services/tokens/schema/CurrentOwner'
) {}

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	client_name: Schema.OptionFromOptionalKey(Schema.String.check(Schema.isMaxLength(100))),
	redirect_uris: ClientRegistration.fields.redirects,
	token_endpoint_auth_method: Schema.optionalKey(Schema.Literal('none'))
})

// What an authorization request must carry before the server may send any answer to its callback.
export type AuthorizeClient = typeof AuthorizeClient.Type
export const AuthorizeClient = Schema.Struct({
	client_id: ClientId.check(Schema.isNonEmpty(), Schema.isMaxLength(2048)),
	redirect_uri: Schema.OptionFromOptionalKey(Schema.String),
	state: Schema.OptionFromOptionalKey(Schema.String)
})

// The rest is checked field by field, so each failure returns its own OAuth error to the callback.
export type AuthorizeParams = typeof AuthorizeParams.Type
export const AuthorizeParams = Schema.Struct({
	code_challenge: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
	code_challenge_method: Schema.OptionFromOptionalKey(Schema.String),
	response_type: Schema.OptionFromOptionalKey(Schema.String),
	scope: Schema.OptionFromOptionalKey(Schema.String)
})

export type ClientRequest = typeof ClientRequest.Type
export const ClientRequest = Schema.Struct({
	challenge: Schema.NonEmptyString,
	clientId: ClientId.check(Schema.isNonEmpty()),
	clientName: Schema.String,
	parent: Schema.OptionFromOptionalKey(SignInFamily),
	redirectUri: Schema.NonEmptyString,
	state: Schema.OptionFromOptionalKey(Schema.NonEmptyString)
})

export type DeviceRequest = typeof DeviceRequest.Type
export const DeviceRequest = Schema.Struct({clientId: ClientId.check(Schema.isNonEmpty()), clientName: Schema.String})

// RFC 8628 §3.1.
export type DeviceParams = typeof DeviceParams.Type
export const DeviceParams = Schema.Struct({
	client_id: ClientId.check(Schema.isNonEmpty(), Schema.isMaxLength(2048)),
	scope: Schema.OptionFromOptionalKey(Schema.String)
})

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

// RFC 8628 §3.4.
export type DeviceTokenParams = typeof DeviceTokenParams.Type
export const DeviceTokenParams = Schema.Struct({
	client_id: ClientId.check(Schema.isNonEmpty()),
	device_code: Schema.NonEmptyString,
	grant_type: Schema.Literal(DEVICE_GRANT)
})

export type TokenGrant = typeof TokenGrant.Type
export const TokenGrant = Schema.Struct({grant_type: Schema.String})

// OAuth 2.1 drops redirect_uri from the code exchange, and a public client may leave client_id out of a refresh; each is checked when sent.
export type TokenParams = typeof TokenParams.Type
export const TokenParams = Schema.Union([
	Schema.Struct({
		client_id: ClientId.check(Schema.isNonEmpty()),
		code: Schema.NonEmptyString,
		code_verifier: Schema.NonEmptyString,
		grant_type: Schema.Literal('authorization_code'),
		redirect_uri: Schema.OptionFromOptionalKey(Schema.String)
	}),
	Schema.Struct({
		client_id: Schema.OptionFromOptionalKey(ClientId),
		grant_type: Schema.Literal('refresh_token'),
		refresh_token: Schema.NonEmptyString
	})
])

export type TokenResponse = typeof TokenResponse.Type
export const TokenResponse = Schema.Struct({
	access_token: Schema.NonEmptyString,
	expires_in: DurationFromSeconds,
	refresh_token: Schema.NonEmptyString,
	scope: Schema.Literal('deslop'),
	token_type: Schema.Literal('Bearer')
})

// A replayed grant still revokes its family, so the token endpoint answers it as a result rather than a failure.
export type Exchange = typeof Exchange.Type
export const Exchange = Schema.TaggedUnion({Granted: {tokens: TokenResponse}, Replayed: {message: Schema.String}})

// Where a request came from, as Traefik and the client report it; it names a sign-in, it never proves one.
export type Origin = typeof Origin.Type
export const Origin = Schema.Struct({
	address: Schema.OptionFromOptionalKey(Schema.String),
	userAgent: Schema.OptionFromOptionalKey(Schema.String)
})

// How a browser signed in: GitHub and a passkey prove the owner's browser; a code may have been approved for someone else's.
export type SessionVia = typeof SessionVia.Type
export const SessionVia = Schema.Literals(['Code', 'GitHub', 'Passkey'])

// What every sign-in keeps: its family, whose it is, how the list names it, and the hash of its one live secret. Only the address is kept of where it came from; the user agent labels it when it is made.
const SignInFields = {
	address: Model.FieldOption(Schema.String),
	client: Schema.String,
	device: Schema.String,
	expiresAt: Schema.DateTimeUtcFromMillis,
	family: SignInFamily,
	hash: Model.Sensitive(Schema.String),
	incarnation: Model.Sensitive(CredentialOwner.fields.incarnation),
	lastActive: Schema.DateTimeUtcFromMillis,
	userId: User.fields.id,
	userName: User.fields.name
}

// One row of `browser_sessions`: a browser signed in to Auth by its session cookie.
export class BrowserSession extends Model.Class<BrowserSession>('BrowserSession')({...SignInFields, via: SessionVia}) {
	static readonly table = 'browser_sessions'
}

// One row of `app_grants`: an app, agent or command holding a refresh token; a web app's sign-in ends with the browser it came from.
export class AppGrant extends Model.Class<AppGrant>('AppGrant')({
	...SignInFields,
	clientId: ClientId.check(Schema.isNonEmpty()),
	generation: Schema.Int,
	parent: Model.FieldOption(BrowserSession.fields.family)
}) {
	static readonly table = 'app_grants'
}

// One row of `spent_refresh_tokens`: a refresh token already exchanged, kept until its family ends so a replay of it ends the family.
export class SpentRefreshToken extends Model.Class<SpentRefreshToken>('SpentRefreshToken')({
	family: AppGrant.fields.family,
	hash: Model.Sensitive(Schema.String)
}) {
	static readonly table = 'spent_refresh_tokens'
}

// The one row of `signing_keys`: the key access tokens are signed with, so they stay valid across a restart.
export class SigningKey extends Model.Class<SigningKey>('SigningKey')({
	privateJwk: Model.Sensitive(Schema.fromJsonString(Schema.RedactedFromValue(Jwk.PrivateJwk)))
}) {
	static readonly table = 'signing_keys'
}

// A sign-in by its family, if it is still live at `now`.
export type SignInLookup = typeof SignInLookup.Type
export const SignInLookup = Schema.Struct({family: SignInFamily, now: Schema.DateTimeUtcFromMillis})

// An account's sign-ins still live at `now`.
export type OwnedSignIns = typeof OwnedSignIns.Type
export const OwnedSignIns = Schema.Struct({now: Schema.DateTimeUtcFromMillis, owner: CredentialOwner})

// What the signed-in list shows of a browser session or an app grant.
export class SignedInApp extends Model.Class<SignedInApp>('SignedInApp')({
	...Struct.pick(Model.fields(AppGrant), ['address', 'client', 'device', 'family', 'lastActive', 'parent']),
	kind: Schema.Literals(['App', 'Browser'])
}) {}

export type RevokeParams = typeof RevokeParams.Type
export const RevokeParams = Schema.Struct({
	client_id: ClientId.check(Schema.isNonEmpty()),
	token: Schema.NonEmptyString
})
