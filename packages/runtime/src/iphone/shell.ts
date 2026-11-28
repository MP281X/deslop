import 'react-native/Libraries/Core/setUpXHR'

import type {Router} from '@effect/ui'

import {Boolean, Effect, Layer, Option, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import type {HttpClient} from 'effect/http'
import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'
import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import Linking from 'react-native/Libraries/Linking/Linking'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneRouter} from '@deslop/components/native/router'
import type {IPhoneLink} from '@deslop/components/native/router'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

import {layerSocketProtocol} from '#client/protocol.ts'
import {Authenticate, OpenUrl, SignOutSession, layerShell} from '#client/shell.ts'
import {iphoneSession, isSignOutConfirmed, secureSession} from '#iphone/session.ts'
import type {IPhoneSessionStore} from '#iphone/session.ts'
import {AuthError, isDenied} from '#shared/auth.ts'
import {Account} from '#shared/schema.ts'

class OpenUrlError extends Schema.TaggedError<OpenUrlError>()('OpenUrlError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// The account an iPhone keeps for a start without a network, with whatever else the app keeps for it: `clear` drops it all when Auth refuses the account, `wipe` when the person signs out, and says whether everything went, and `failure` is what the app says when it did not.
export type IPhoneOffline = {
	readonly clear: Effect.Effect<void>
	readonly failure: string
	readonly read: Effect.Effect<Option.Option<string>>
	readonly wipe: Effect.Effect<boolean>
	readonly write: (text: string) => Effect.Effect<void>
}

type AccountText = typeof AccountText.Type
const AccountText = Schema.fromJsonString(Account)

// Auth's answer while it comes, the kept account while Auth cannot be reached, and nothing while the session ends.
function offlineAccount(read: Effect.Effect<Account, AuthError, HttpClient.HttpClient>, offline: IPhoneOffline) {
	const cachedAtom = Atom.keepAlive(
		Atom.make(Effect.map(offline.read, Option.flatMap(Schema.decodeOption(AccountText))))
	)
	const signingOutAtom = Atom.make(false)
	const checkedAtom = Atom.runtime(FetchHttpClient.layer).atom(get =>
		pipe(
			read,
			Effect.tap(account =>
				pipe(
					Schema.encodeEffect(AccountText)(account),
					Effect.flatMap(offline.write),
					Effect.ignore({log: 'Warn', message: 'The offline account could not be saved'}),
					Effect.andThen(Effect.sync(() => get.registry.refresh(cachedAtom)))
				)
			),
			Effect.tapError(error => {
				if (!isDenied(error)) return Effect.void
				return Effect.andThen(
					offline.clear,
					Effect.sync(() => get.registry.refresh(cachedAtom))
				)
			})
		)
	)
	const accountAtom = Atom.readable(
		get => {
			const result = get(checkedAtom)
			if (get(signingOutAtom)) return AsyncResult.initial<Account, AuthError>()
			if (AsyncResult.isSuccess(result)) return result
			if (Option.exists(AsyncResult.error(result), isDenied)) return result
			return Option.match(AsyncResult.value(get(cachedAtom)), {
				onNone: () => result,
				onSome: snapshot => Option.match(snapshot, {onNone: () => result, onSome: user => AsyncResult.success(user)})
			})
		},
		refresh => refresh(checkedAtom)
	)
	// Wipes what the iPhone kept, and reads the account again with nothing shown meanwhile.
	const wipe = Effect.fnUntraced(function* (registry: AtomRegistry.AtomRegistry) {
		const wiped = yield* offline.wipe
		registry.refresh(cachedAtom)
		registry.set(signingOutAtom, true)
		yield* Effect.ensuring(
			pipe(
				Effect.sync(() => registry.refresh(checkedAtom)),
				Effect.andThen(AtomRegistry.getResult(registry, checkedAtom, {suspendOnWaiting: true})),
				Effect.ignore({log: 'Warn', message: 'The account could not be read again after sign-out'})
			),
			Effect.sync(() => registry.set(signingOutAtom, false))
		)
		return wiped
	})
	return {accountAtom, wipe}
}

// Everything an iPhone app takes from its name: its origins and scheme, the session, the router that follows `<name>://` links, and the shell's sign-in. `replace` names the routes a link replaces instead of pushing, `link` reads the links of its own that a path cannot say, `linkScheme` is the scheme of a build whose links differ from the name's, such as a development build, and `confirmsSignOut` the statuses of Auth's answer that count as ending the session elsewhere, 200 to 399 unless named. The session lives in the app's own Keychain unless `store` names another, as Stash's, shared with its share extension, and `offline` keeps the account for a start without a network.
export function layerIPhoneShell<Routes extends Router.Routes>(options: {
	readonly confirmsSignOut?: (status: number) => boolean
	readonly link?: (url: string) => Option.Option<IPhoneLink>
	readonly linkScheme?: string
	readonly name: string
	readonly offline?: IPhoneOffline
	readonly replace?: (route: Routes['Type']) => boolean
	readonly route: Routes
	readonly store?: IPhoneSessionStore
}) {
	const origins = iphoneOrigins(options.name)
	const session = iphoneSession(
		origins,
		options.store ?? secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY),
		openAuthSessionAsync,
		WebSocket
	)
	const read = session.readIPhoneAccount(fetch)
	const offline = Option.map(Option.fromUndefinedOr(options.offline), kept => ({kept, ...offlineAccount(read, kept)}))
	return Layer.mergeAll(
		layerShell(
			layerSocketProtocol(session.layerIPhoneSocket),
			Option.match(offline, {
				onNone: () => Atom.runtime(FetchHttpClient.layer).atom(read),
				onSome: found => found.accountAtom
			}),
			false
		),
		Authenticate.toLayer(() => session.signIn),
		Layer.provide(
			SignOutSession.toLayer(
				Effect.gen(function* () {
					const registry = yield* AtomRegistry.AtomRegistry
					return request =>
						Effect.gen(function* () {
							const status = yield* Effect.mapError(session.signOut(fetch), cause =>
								AuthError.make({cause, message: request.failure})
							)
							const confirmed = (options.confirmsSignOut ?? isSignOutConfirmed)(status)
							const kept = yield* Option.match(offline, {
								onNone: () => Effect.succeed(true),
								onSome: found => found.wipe(registry)
							})
							return yield* Boolean.match(kept, {
								onFalse: () =>
									Option.match(offline, {
										onNone: () => Effect.succeed(confirmed),
										onSome: found => Effect.fail(AuthError.make({message: found.kept.failure}))
									}),
								onTrue: () => Effect.succeed(confirmed)
							})
						})
				})
			),
			AtomRegistry.layer
		),
		OpenUrl.toLayer(request =>
			Effect.ignore(
				Effect.tryPromise({
					catch: cause => OpenUrlError.make({cause, message: 'Could not open the URL'}),
					try: () => Linking.openURL(request.url)
				}),
				{log: 'Warn', message: 'Could not open the URL'}
			)
		),
		iphoneRouter(options.route, origins.appOrigin, options.linkScheme ?? origins.scheme, {
			...Option.match(Option.fromUndefinedOr(options.link), {onNone: () => ({}), onSome: link => ({link})}),
			...Option.match(Option.fromUndefinedOr(options.replace), {
				onNone: () => ({}),
				onSome: replace => ({
					replace: (location: Router.Location) => Option.exists(options.route.parse(location.url), replace)
				})
			})
		})
	)
}
