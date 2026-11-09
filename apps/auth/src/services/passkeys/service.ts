import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	HashMap,
	Layer,
	Number,
	Option,
	Ref,
	Schema,
	Stream,
	SubscriptionRef,
	pipe
} from 'effect'

import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse
} from '@simplewebauthn/server'
import {Base64Url} from 'effect/encoding'
import {KeyValueStore} from 'effect/persistence'

import {AuthError} from '@deslop/runtime/auth/schema'
import {localAuth, rejected} from '@deslop/runtime/auth/utils'

import type {Assertion, Passkey, Registration} from '#services/passkeys/schema.ts'
import {ClientData, CreationOptions, RequestOptions, StoredPasskeys, Transport} from '#services/passkeys/schema.ts'
import {browserLabel, deviceLabel, sameOwner} from '#services/tokens/lib/utils.ts'
import type {CredentialOwner, Origin, SessionVia} from '#services/tokens/schema.ts'

// How long a challenge stays answerable.
const LIFETIME = 5 * 60_000

// The WebAuthn library rejects a response it cannot verify, such as one for another site or with a bad signature.
function invalid(cause: unknown) {
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
		readonly list: (owner: CredentialOwner) => Stream.Stream<Passkey[]>
		readonly registration: (owner: CredentialOwner, via: SessionVia) => Effect.Effect<CreationOptions, AuthError>
		readonly remove: (id: string, owner: CredentialOwner) => Effect.Effect<void, AuthError>
		readonly request: Effect.Effect<RequestOptions, AuthError>
		// The account the passkey belongs to; the caller checks it may still sign in.
		readonly signIn: (response: Assertion) => Effect.Effect<CredentialOwner, AuthError>
	}
>()('@deslop/auth/services/passkeys/service/Passkeys') {
	static readonly layer = Layer.effect(
		Passkeys,
		Effect.gen(function* () {
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, StoredPasskeys)
			const state = yield* SubscriptionRef.make<StoredPasskeys>(
				Option.getOrElse(yield* store.get('passkeys'), () => [])
			)
			const origin = new URL(yield* Config.String('APP_URL')).origin
			// Every mp281x.xyz app can use a passkey later; without an issuer it belongs to this host alone.
			const rpID = Boolean.match(yield* localAuth, {
				onFalse: () => 'mp281x.xyz',
				onTrue: () => new URL(origin).hostname
			})
			// A challenge answers once, within five minutes, taken in one step: registrations by account, sign-ins by the challenge itself.
			const registering = yield* Ref.make(HashMap.empty<string, {challenge: string; expiresAt: number}>())
			const signingIn = yield* Ref.make(HashMap.empty<string, {expiresAt: number}>())
			// Every change saves the next passkeys before memory and the live views see them.
			const change = Effect.fnUntraced(function* <E>(
				next: (current: StoredPasskeys) => Effect.Effect<StoredPasskeys, E>
			) {
				yield* SubscriptionRef.updateEffect(state, current =>
					Effect.tap(next(current), updated => store.set('passkeys', updated))
				)
			}, Effect.uninterruptible)

			return Passkeys.of({
				add: Effect.fn('Passkeys.add')(function* (
					response: Registration,
					session: {from: Origin; owner: CredentialOwner; via: SessionVia}
				) {
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
						catch: invalid,
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
					yield* change(current =>
						Effect.gen(function* () {
							// WebAuthn §7.1 step 22: uniqueness is checked under the same lock as the saved registration.
							if (Array.some(current, found => found.id === credential.id)) {
								return yield* AuthError.make({message: 'This passkey is already added'})
							}
							return [
								...current,
								{
									addedFrom: `${browserLabel(from)} · ${deviceLabel(from)}`,
									counter: credential.counter,
									id: credential.id,
									publicKey: Base64Url.encode(credential.publicKey),
									synced: verified.registrationInfo.credentialDeviceType === 'multiDevice',
									transports,
									...session.owner
								}
							]
						})
					)
				}, rejected('Cannot add the passkey')),
				forget: Effect.fn('Passkeys.forget')(function* (owner: CredentialOwner) {
					yield* change(current => Effect.succeed(Array.filter(current, found => !sameOwner(found, owner))))
					yield* Ref.update(registering, HashMap.remove(registrationKey(owner)))
				}, rejected('Cannot remove the account’s passkeys')),
				list: owner =>
					Stream.map(SubscriptionRef.changes(state), current =>
						Array.map(
							Array.filter(current, found => sameOwner(found, owner)),
							found => ({addedFrom: found.addedFrom, id: found.id, synced: found.synced})
						)
					),
				registration: Effect.fn('Passkeys.registration')(function* (owner: CredentialOwner, via: SessionVia) {
					yield* owned(via)
					const user = owner.user
					const existing = Array.filter(yield* SubscriptionRef.get(state), found => sameOwner(found, owner))
					const options = yield* Effect.tryPromise({
						catch: invalid,
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
				}, rejected('Cannot start adding a passkey')),
				remove: Effect.fn('Passkeys.remove')(function* (id: string, owner: CredentialOwner) {
					yield* change(current =>
						Effect.succeed(Array.filter(current, found => found.id !== id || !sameOwner(found, owner)))
					)
				}, rejected('Cannot remove the passkey')),
				request: pipe(
					Effect.tryPromise({
						catch: invalid,
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
					rejected('Cannot start a passkey sign-in'),
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
					const found = yield* Effect.mapError(
						Effect.fromOption(Array.findFirst(yield* SubscriptionRef.get(state), stored => stored.id === response.id)),
						() => unknown
					)
					// A copy, since the library wants bytes over a plain ArrayBuffer.
					const publicKey = new Uint8Array(yield* Effect.fromResult(Base64Url.decode(found.publicKey)))
					const verified = yield* Effect.tryPromise({
						catch: invalid,
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
					// Two sign-ins at once never move the counter back.
					yield* change(current =>
						Effect.succeed(
							Array.map(current, stored => {
								if (stored.id !== found.id) return stored
								return {...stored, counter: Number.max(stored.counter, verified.authenticationInfo.newCounter)}
							})
						)
					)
					return {incarnation: found.incarnation, user: found.user}
				}, rejected('Cannot sign in with the passkey'))
			})
		})
	)
}
