import {Schema} from 'effect'

import {StoredOwner} from '#services/tokens/schema.ts'

// The WebAuthn JSON forms `@simplewebauthn` and the browser exchange, so each side decodes what the other sent; arrays stay mutable because the library's own types are, not to satisfy a readonly rule.
export type Transport = typeof Transport.Type
export const Transport = Schema.Literals(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])
type PublicKey = typeof PublicKey.Type
const PublicKey = Schema.Literal('public-key')
type UserVerification = typeof UserVerification.Type
const UserVerification = Schema.Literals(['required', 'preferred', 'discouraged'])
type Descriptor = typeof Descriptor.Type
const Descriptor = Schema.Struct({
	id: Schema.String,
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
	rp: Schema.Struct({id: Schema.optionalKey(Schema.String), name: Schema.String}),
	timeout: Schema.optionalKey(Schema.Finite),
	user: Schema.Struct({displayName: Schema.String, id: Schema.String, name: Schema.String})
})

export type RequestOptions = typeof RequestOptions.Type
export const RequestOptions = Schema.Struct({
	allowCredentials: Schema.optionalKey(Schema.mutable(Schema.Array(Descriptor))),
	challenge: Schema.String,
	rpId: Schema.optionalKey(Schema.String),
	timeout: Schema.optionalKey(Schema.Finite),
	userVerification: Schema.optionalKey(UserVerification)
})

type Attachment = typeof Attachment.Type
const Attachment = Schema.optionalKey(Schema.Literals(['cross-platform', 'platform']))

export type Registration = typeof Registration.Type
export const Registration = Schema.Struct({
	authenticatorAttachment: Attachment,
	clientExtensionResults: Schema.Struct({}),
	id: Schema.String,
	rawId: Schema.String,
	response: Schema.Struct({
		attestationObject: Schema.String,
		clientDataJSON: Schema.String,
		// Any string, since a newer browser may name a transport this list does not know yet.
		transports: Schema.optionalKey(Schema.Array(Schema.String))
	}),
	type: PublicKey
})

export type Assertion = typeof Assertion.Type
export const Assertion = Schema.Struct({
	authenticatorAttachment: Attachment,
	clientExtensionResults: Schema.Struct({}),
	id: Schema.String,
	rawId: Schema.String,
	response: Schema.Struct({
		authenticatorData: Schema.String,
		clientDataJSON: Schema.String,
		signature: Schema.String,
		userHandle: Schema.optionalKey(Schema.String)
	}),
	type: PublicKey
})

export type ClientData = typeof ClientData.Type
export const ClientData = Schema.Struct({challenge: Schema.String})

export type StoredPasskey = typeof StoredPasskey.Type
export const StoredPasskey = Schema.Struct({
	...StoredOwner.fields,
	addedFrom: Schema.String,
	counter: Schema.Int,
	createdAt: Schema.Finite,
	id: Schema.NonEmptyString,
	lastUsed: Schema.Finite,
	publicKey: Schema.NonEmptyString,
	synced: Schema.Boolean,
	transports: Schema.Array(Transport)
})

export type StoredPasskeys = typeof StoredPasskeys.Type
export const StoredPasskeys = Schema.Array(StoredPasskey)

export type Passkey = typeof Passkey.Type
export const Passkey = Schema.Struct({
	addedFrom: Schema.String,
	createdAt: Schema.Finite,
	id: Schema.NonEmptyString,
	lastUsed: Schema.Finite,
	synced: Schema.Boolean
})

export type PasskeyParams = typeof PasskeyParams.Type
export const PasskeyParams = Schema.Struct({id: Schema.NonEmptyString})

export type AddPasskeyParams = typeof AddPasskeyParams.Type
export const AddPasskeyParams = Schema.Struct({response: Registration})

export type PasskeySignIn = typeof PasskeySignIn.Type
export const PasskeySignIn = Schema.Struct({
	next: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(2048))),
	response: Assertion
})
