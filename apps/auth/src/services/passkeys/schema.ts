import {Schema, pipe} from 'effect'

import {Model} from 'effect/schema'

import {User} from '@deslop/runtime/shared/auth'

import {CredentialOwner} from '#services/tokens/schema.ts'

export type PasskeyId = typeof PasskeyId.Type
export const PasskeyId = pipe(Schema.String, Schema.brand('PasskeyId'))

export type WebAuthnUserHandle = typeof WebAuthnUserHandle.Type
export const WebAuthnUserHandle = pipe(Schema.String, Schema.brand('WebAuthnUserHandle'))

export type RelyingPartyId = typeof RelyingPartyId.Type
export const RelyingPartyId = pipe(Schema.String, Schema.brand('RelyingPartyId'))

// The WebAuthn JSON forms `@simplewebauthn` and the browser exchange, so each side decodes what the other sent; arrays stay mutable because the library's own types are, not to satisfy a readonly rule.
export type Transport = typeof Transport.Type
export const Transport = Schema.Literals(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])
type PublicKey = typeof PublicKey.Type
const PublicKey = Schema.Literal('public-key')
type UserVerification = typeof UserVerification.Type
const UserVerification = Schema.Literals(['required', 'preferred', 'discouraged'])
type Descriptor = typeof Descriptor.Type
const Descriptor = Schema.Struct({
	id: PasskeyId,
	transports: Schema.optionalKey(Schema.mutable(Schema.Array(Transport))),
	type: PublicKey
})

export type CreationOptions = typeof CreationOptions.Type
export const CreationOptions = Schema.Struct({
	attestation: Schema.optionalKey(Schema.Literals(['direct', 'enterprise', 'indirect', 'none'])),
	authenticatorSelection: Schema.optionalKey(
		Schema.Struct({
			authenticatorAttachment: Schema.optionalKey(Schema.Literals(['cross-platform', 'platform'])),
			requireResidentKey: Schema.optionalKey(Schema.Boolean),
			residentKey: Schema.optionalKey(Schema.Literals(['discouraged', 'preferred', 'required'])),
			userVerification: Schema.optionalKey(UserVerification)
		})
	),
	challenge: Schema.String,
	excludeCredentials: Schema.optionalKey(Schema.mutable(Schema.Array(Descriptor))),
	pubKeyCredParams: Schema.mutable(Schema.Array(Schema.Struct({alg: Schema.Finite, type: PublicKey}))),
	rp: Schema.Struct({id: Schema.optionalKey(RelyingPartyId), name: Schema.String}),
	timeout: Schema.OptionFromOptionalKey(pipe(Schema.Finite, Schema.decodeTo(Schema.DurationFromMillis))),
	user: Schema.Struct({displayName: Schema.String, id: WebAuthnUserHandle, name: Schema.String})
})

export type RequestOptions = typeof RequestOptions.Type
export const RequestOptions = Schema.Struct({
	allowCredentials: Schema.optionalKey(Schema.mutable(Schema.Array(Descriptor))),
	challenge: Schema.String,
	rpId: Schema.optionalKey(RelyingPartyId),
	timeout: Schema.OptionFromOptionalKey(pipe(Schema.Finite, Schema.decodeTo(Schema.DurationFromMillis))),
	userVerification: Schema.optionalKey(UserVerification)
})

type Attachment = typeof Attachment.Type
const Attachment = Schema.optionalKey(Schema.Literals(['cross-platform', 'platform']))

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	authenticatorAttachment: Attachment,
	clientExtensionResults: Schema.Struct({}),
	id: PasskeyId,
	rawId: PasskeyId,
	response: Schema.Struct({
		attestationObject: Schema.String,
		clientDataJSON: Schema.String,
		// Any string, since a newer browser may name a transport this list does not know yet.
		transports: Schema.OptionFromOptionalKey(Schema.Array(Schema.String))
	}),
	type: PublicKey
})

export type Assertion = typeof Assertion.Type
export const Assertion = Schema.Struct({
	authenticatorAttachment: Attachment,
	clientExtensionResults: Schema.Struct({}),
	id: PasskeyId,
	rawId: PasskeyId,
	response: Schema.Struct({
		authenticatorData: Schema.String,
		clientDataJSON: Schema.String,
		signature: Schema.String,
		userHandle: Schema.optionalKey(WebAuthnUserHandle)
	}),
	type: PublicKey
})

export type ClientData = typeof ClientData.Type
export const ClientData = Schema.Struct({challenge: Schema.String})

// One row of `passkeys`, and what the account menu lists of it: where it was added and whether it syncs. The key, its counter and its owner never leave the server.
export class Passkey extends Model.Class<Passkey>('Passkey')({
	addedFrom: Schema.String,
	counter: Model.Sensitive(Schema.Int),
	// The credential id the authenticator chose.
	id: PasskeyId.check(Schema.isNonEmpty()),
	incarnation: Model.Sensitive(CredentialOwner.fields.incarnation),
	// The COSE public key, as URL-safe base64.
	publicKey: Model.Sensitive(Schema.NonEmptyString),
	synced: Model.BooleanSqlite,
	transports: Model.Sensitive(Schema.fromJsonString(Schema.Array(Transport))),
	userId: Model.Sensitive(User.fields.id),
	userName: Model.Sensitive(User.fields.name)
}) {
	static readonly table = 'passkeys'
}

export type PasskeyParams = typeof PasskeyParams.Type
export const PasskeyParams = Schema.Struct({id: Passkey.fields.id})

export type AddPasskeyParams = typeof AddPasskeyParams.Type
export const AddPasskeyParams = Schema.Struct({response: Registration})

export type PasskeySignIn = typeof PasskeySignIn.Type
export const PasskeySignIn = Schema.Struct({
	next: Schema.OptionFromOptionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(2048))),
	response: Assertion
})
