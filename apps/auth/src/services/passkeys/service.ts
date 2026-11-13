import {Array, Boolean, Clock, Config, Context, Effect, HashMap, Layer, Option, Ref, Schema, Stream, pipe} from 'effect'

import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse
} from '@simplewebauthn/server'
import {Base64Url} from 'effect/encoding'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, asAuthError} from '@deslop/runtime/shared/auth'

import type {Assertion, Registration} from '#services/passkeys/schema.ts'
import {ClientData, CreationOptions, Passkey, RequestOptions, Transport} from '#services/passkeys/schema.ts'
import {browserLabel, credentialOwnerOf, deviceLabel} from '#services/tokens/lib/utils.ts'
import {CredentialOwner} from '#services/tokens/schema.ts'
import type {Origin, SessionVia} from '#services/tokens/schema.ts'

// How long a challenge stays answerable.
const LIFETIME = 5 * 60_000

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly passkeys: never
	}
}

// The WebAuthn library rejects a response it cannot verify, such as one for another site or with a bad signature.
function asPasskeyError(cause: unknown) {
	return AuthError.make({cause, message: 'The passkey’s answer could not be verified'})
}

const unknown = AuthError.make({
	error: 'access_denied',
	message: 'This passkey is not known here; add it again while signed in'
})

// A passkey signs in for a year, so only a browser that proved itself the owner's adds one; a code may have been approved for someone else's.
const owned = Effect.fnUntraced(function* (via: SessionVia) {
	if (via === 'Code') {
		return yield* AuthError.make({
			error: 'access_denied',
			message: 'Sign in with GitHub or a passkey on this browser to add a passkey'
		})
	}
})

const challengeFromClientData = Effect.fnUntraced(function* (clientDataJSON: string) {
	return (yield* Schema.decodeEffect(Schema.fromJsonString(ClientData))(
		yield* Effect.fromResult(Base64Url.decodeString(clientDataJSON))
	)).challenge
})

// Challenges still answerable at `now`, so expired ones never pile up.
function live<K, V extends {expiresAt: number}>(issued: HashMap.HashMap<K, V>, now: number) {
	return HashMap.filter(issued, entry => entry.expiresAt > now)
}

function registrationKey(owner: CredentialOwner) {
	return `${owner.user.id}/${owner.incarnation}`
}

// Passkeys sit beside tokens, below People: People forgets an account's passkeys with its sessions, and callers check access.
export class Passkeys extends Context.Service<
	Passkeys,
	{
		readonly add: (
			response: Registration,
			session: {from: Origin; owner: CredentialOwner; via: SessionVia}
		) => Effect.Effect<void, AuthError>
		readonly forget: (owner: CredentialOwner) => Effect.Effect<void, AuthError>
		readonly watch: (owner: CredentialOwner) => Stream.Stream<readonly Passkey[], AuthError>
		readonly registration: (owner: CredentialOwner, via: SessionVia) => Effect.Effect<CreationOptions, AuthError>
		readonly remove: (id: string, owner: CredentialOwner) => Effect.Effect<void, AuthError>
		readonly request: Effect.Effect<RequestOptions, AuthError>
		// The account the passkey belongs to; the caller checks it may still sign in.
		readonly signIn: (response: Assertion) => Effect.Effect<CredentialOwner, AuthError>
	}
>()('@deslop/auth/services/passkeys/service/Passkeys') {
	// The table this service owns, made at start; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_passkeys': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE passkeys (
							id TEXT PRIMARY KEY,
							userId TEXT NOT NULL,
							userName TEXT NOT NULL,
							incarnation TEXT NOT NULL,
							addedFrom TEXT NOT NULL,
							publicKey TEXT NOT NULL,
							counter INTEGER NOT NULL,
							synced INTEGER NOT NULL,
							transports TEXT NOT NULL
						) STRICT
					`
					yield* sql`CREATE INDEX passkeys_by_owner ON passkeys (userId, incarnation)`
				})
			}),
			table: 'passkeys_migrations'
		})
	)

	static readonly layer = Layer.provide(
		Layer.effect(
			Passkeys,
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const origin = new URL(yield* Config.String('APP_URL')).origin
				// Every mp281x.xyz app can use a passkey later; without an issuer it belongs to this host alone.
				const rpID = Boolean.match(yield* localAuth, {
					onFalse: () => 'mp281x.xyz',
					onTrue: () => new URL(origin).hostname
				})
				// A challenge answers once, within five minutes, taken in one step: registrations by account, sign-ins by the challenge itself.
				const registering = yield* Ref.make(HashMap.empty<string, {challenge: string; expiresAt: number}>())
				const signingIn = yield* Ref.make(HashMap.empty<string, {expiresAt: number}>())
				const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
				const passkeys = yield* SqlModel.makeRepository(Passkey, {
					idColumn: 'id',
					spanPrefix: 'Passkeys',
					tableName: Passkey.table
				})
				// An account's passkeys in the order they were added.
				const listOwned = SqlSchema.findAll({
					Request: CredentialOwner,
					Result: Passkey,
					execute: owner => sql`
						SELECT * FROM ${sql(Passkey.table)}
						WHERE userId = ${owner.user.id} AND incarnation = ${owner.incarnation}
						ORDER BY rowid
					`
				})
				const deleteOwned = SqlSchema.void({
					Request: CredentialOwner,
					execute: owner => sql`
						DELETE FROM ${sql(Passkey.table)} WHERE userId = ${owner.user.id} AND incarnation = ${owner.incarnation}
					`
				})
				const deleteOne = SqlSchema.void({
					Request: Schema.Struct({id: Passkey.fields.id, owner: CredentialOwner}),
					execute: request => sql`
						DELETE FROM ${sql(Passkey.table)}
						WHERE id = ${request.id} AND userId = ${request.owner.user.id} AND incarnation = ${request.owner.incarnation}
					`
				})
				// Two sign-ins at once never move the counter back.
				const raiseCounter = SqlSchema.void({
					Request: Schema.Struct({counter: Passkey.fields.counter, id: Passkey.fields.id}),
					execute: request => sql`
						UPDATE ${sql(Passkey.table)} SET counter = max(counter, ${request.counter}) WHERE id = ${request.id}
					`
				})

				return Passkeys.of({
					add: Effect.fn('Passkeys.add')(
						function* (response: Registration, session: {from: Origin; owner: CredentialOwner; via: SessionVia}) {
							yield* owned(session.via)
							const key = registrationKey(session.owner)
							const from = session.from
							const now = yield* Clock.currentTimeMillis
							const challenge = yield* pipe(
								Ref.modify(registering, issued => [
									HashMap.get(live(issued, now), key),
									HashMap.remove(live(issued, now), key)
								]),
								Effect.flatMap(Effect.fromOption),
								Effect.mapError(() => AuthError.make({message: 'Adding the passkey took too long; start again'}))
							)
							// A transport a newer browser names, and this list does not know yet, is left out rather than failing the passkey.
							const transports = Array.filter(response.response.transports ?? [], Schema.is(Transport))
							const verified = yield* Effect.tryPromise({
								catch: asPasskeyError,
								try: () =>
									verifyRegistrationResponse({
										expectedChallenge: challenge.challenge,
										expectedOrigin: origin,
										expectedRPID: rpID,
										requireUserVerification: true,
										response: {...response, response: {...response.response, transports}}
									})
							})
							if (!verified.verified) return yield* AuthError.make({message: 'The passkey could not be verified'})
							const credential = verified.registrationInfo.credential
							yield* pipe(
								Effect.gen(function* () {
									// WebAuthn §7.1 step 22: uniqueness is checked in the same transaction as the saved registration.
									if (Option.isSome(yield* Effect.catchNoSuchElement(passkeys.findById(credential.id)))) {
										return yield* AuthError.make({message: 'This passkey is already added'})
									}
									yield* passkeys.insertVoid({
										addedFrom: `${browserLabel(from)} · ${deviceLabel(from)}`,
										counter: credential.counter,
										id: credential.id,
										incarnation: session.owner.incarnation,
										publicKey: Base64Url.encode(credential.publicKey),
										synced: verified.registrationInfo.credentialDeviceType === 'multiDevice',
										transports,
										userId: session.owner.user.id,
										userName: session.owner.user.name
									})
								}),
								Reactivity.mutation(['passkeys']),
								sql.withTransaction
							)
						},
						withReactivity,
						asAuthError('Cannot add the passkey')
					),
					forget: Effect.fn('Passkeys.forget')(
						function* (owner: CredentialOwner) {
							yield* Reactivity.mutation(deleteOwned(owner), ['passkeys'])
							yield* Ref.update(registering, HashMap.remove(registrationKey(owner)))
						},
						withReactivity,
						asAuthError('Cannot remove the account’s passkeys')
					),
					registration: Effect.fn('Passkeys.registration')(function* (owner: CredentialOwner, via: SessionVia) {
						yield* owned(via)
						const user = owner.user
						const existing = yield* listOwned(owner)
						const options = yield* Effect.tryPromise({
							catch: asPasskeyError,
							try: () =>
								generateRegistrationOptions({
									attestationType: 'none',
									authenticatorSelection: {residentKey: 'required', userVerification: 'required'},
									excludeCredentials: Array.map(existing, found => ({id: found.id, transports: [...found.transports]})),
									rpID,
									rpName: 'Deslop',
									userDisplayName: user.name,
									userID: new TextEncoder().encode(user.id),
									userName: user.name
								})
						})
						const now = yield* Clock.currentTimeMillis
						yield* Ref.update(registering, issued =>
							HashMap.set(live(issued, now), registrationKey(owner), {
								challenge: options.challenge,
								expiresAt: now + LIFETIME
							})
						)
						// As the JSON the browser receives, where a key the library left undefined is simply absent.
						return yield* Schema.decodeEffect(Schema.fromJsonString(CreationOptions))(
							yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(options)
						)
					}, asAuthError('Cannot start adding a passkey')),
					remove: Effect.fn('Passkeys.remove')(
						function* (id: string, owner: CredentialOwner) {
							yield* Reactivity.mutation(deleteOne({id, owner}), ['passkeys'])
						},
						withReactivity,
						asAuthError('Cannot remove the passkey')
					),
					request: pipe(
						Effect.tryPromise({
							catch: asPasskeyError,
							try: () => generateAuthenticationOptions({rpID, userVerification: 'required'})
						}),
						Effect.tap(options =>
							Effect.flatMap(Clock.currentTimeMillis, now =>
								Ref.update(signingIn, issued =>
									HashMap.set(live(issued, now), options.challenge, {expiresAt: now + LIFETIME})
								)
							)
						),
						Effect.flatMap(Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))),
						Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(RequestOptions))),
						asAuthError('Cannot start a passkey sign-in'),
						Effect.withSpan('Passkeys.request')
					),
					signIn: Effect.fn('Passkeys.signIn')(function* (response: Assertion) {
						const challenge = yield* challengeFromClientData(response.response.clientDataJSON)
						const now = yield* Clock.currentTimeMillis
						const taken = yield* Ref.modify(signingIn, issued => [
							HashMap.has(live(issued, now), challenge),
							HashMap.remove(live(issued, now), challenge)
						])
						if (!taken) return yield* AuthError.make({message: 'The sign-in took too long; start again'})
						const found = yield* Effect.flatMap(
							Effect.catchNoSuchElement(passkeys.findById(response.id)),
							Option.match({onNone: () => Effect.fail(unknown), onSome: Effect.succeed})
						)
						// A copy, since the library wants bytes over a plain ArrayBuffer.
						const publicKey = new Uint8Array(yield* Effect.fromResult(Base64Url.decode(found.publicKey)))
						const verified = yield* Effect.tryPromise({
							catch: asPasskeyError,
							try: () =>
								verifyAuthenticationResponse({
									credential: {counter: found.counter, id: found.id, publicKey, transports: [...found.transports]},
									expectedChallenge: challenge,
									expectedOrigin: origin,
									expectedRPID: rpID,
									requireUserVerification: true,
									response
								})
						})
						if (!verified.verified) return yield* AuthError.make({message: 'The passkey could not be verified'})
						yield* raiseCounter({counter: verified.authenticationInfo.newCounter, id: found.id})
						return credentialOwnerOf(found)
					}, asAuthError('Cannot sign in with the passkey')),
					watch: owner =>
						Stream.withSpan(
							sql.reactive(['passkeys'], asAuthError('Cannot read the passkeys')(listOwned(owner))),
							'Passkeys.watch',
							{attributes: {'rpc.stream': true, userId: owner.user.id}}
						)
				})
			})
		),
		this.migrations
	)
}
