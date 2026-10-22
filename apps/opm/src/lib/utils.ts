import {
	Array,
	Clock,
	Effect,
	FiberHandle,
	Layer,
	Option,
	Order,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {AtomRpc, Atom} from 'effect/reactivity'
import {AuthRequest, makeRedirectUri} from 'expo-auth-session'
import Constants from 'expo-constants'
import {File, Paths} from 'expo-file-system'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'

import {alert, writeAtomically} from '@deslop/components-mobile/utils'
import {AuthError, ClientRegistration, Credentials, TokenResponse} from '@deslop/runtime/auth/schema'
import {AUTH_URL, RpcAuth} from '@deslop/runtime/auth/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'

import {RpcContracts} from '#rpcs/contracts.ts'
import {byNumber} from '#services/chapters/lib/utils.ts'
import type {ChapterItem, ChaptersEvent, ReadingUpdate} from '#services/chapters/schema.ts'
import {ChapterList} from '#services/chapters/schema.ts'

const SERVER = 'https://opm.mp281x.xyz'
const TELEMETRY = 'https://otel.mp281x.xyz'
const SESSION = 'session'
const DISCOVERY = {
	authorizationEndpoint: `${AUTH_URL}/api/auth/oauth2/authorize`,
	tokenEndpoint: `${AUTH_URL}/api/auth/oauth2/token`
}
const authRuntime = Atom.runtime(FetchHttpClient.layer)
// Two sockets refreshing an expired token at once would spend the same refresh token twice.
const refreshing = Semaphore.makeUnsafe(1)

// Auth

const readSession = Effect.gen(function* () {
	const text = yield* Effect.try(() => SecureStore.getItem(SESSION) ?? '')
	if (String.isEmpty(text)) return Option.none<Credentials>()
	return Option.some(yield* Schema.decodeEffect(Schema.fromJsonString(Credentials))(text))
})
export const sessionAtom = Atom.keepAlive(authRuntime.atom(readSession))

const tokenRequest = Effect.fnUntraced(function* (clientId: string, params: Record<string, string>) {
	const response = yield* (yield* HttpClient.HttpClient).execute(
		pipe(
			HttpClientRequest.post(DISCOVERY.tokenEndpoint),
			HttpClientRequest.bodyUrlParams({...params, client_id: clientId, resource: [SERVER, TELEMETRY]})
		)
	)
	if (response.status === 400 || response.status === 401) {
		yield* Effect.promise(() => SecureStore.deleteItemAsync(SESSION))
		return yield* AuthError.make({message: 'Sign in again'})
	}
	const token = yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
	const text = yield* Schema.encodeEffect(Schema.fromJsonString(Credentials))({
		accessToken: token.access_token,
		clientId,
		expiresAt: (yield* Clock.currentTimeMillis) + token.expires_in * 1000,
		refreshToken: token.refresh_token
	})
	yield* Effect.try(() => SecureStore.setItem(SESSION, text))
	return token.access_token
}, Effect.timeout('10 seconds'))

const accessToken = pipe(
	Effect.gen(function* () {
		const credentials = yield* Effect.fromOption(yield* readSession)
		if (credentials.expiresAt > (yield* Clock.currentTimeMillis) + 60_000) return credentials.accessToken
		return yield* tokenRequest(credentials.clientId, {
			grant_type: 'refresh_token',
			refresh_token: credentials.refreshToken
		})
	}),
	Semaphore.withPermit(refreshing),
	Effect.mapError(cause => AuthError.make({cause, message: 'Sign in to opm'}))
)

export const signInAtom = authRuntime.fn(() =>
	pipe(
		Effect.gen(function* () {
			const redirectUri = makeRedirectUri({path: 'auth/callback', scheme: MobileRuntime.extra.scheme})
			const client = yield* HttpClient.HttpClient
			const registration = yield* pipe(
				HttpClientRequest.post(`${AUTH_URL}/api/auth/oauth2/register`),
				HttpClientRequest.bodyJson({
					application_type: 'native',
					client_name: 'opm',
					grant_types: ['authorization_code', 'refresh_token'],
					redirect_uris: [redirectUri],
					response_types: ['code'],
					token_endpoint_auth_method: 'none'
				}),
				Effect.flatMap(request => client.execute(request)),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientRegistration))
			)
			const request = new AuthRequest({
				clientId: registration.client_id,
				extraParams: {resource: SERVER},
				redirectUri,
				scopes: ['deslop', 'offline_access']
			})
			const url = new URL(yield* Effect.tryPromise(() => request.makeAuthUrlAsync(DISCOVERY)))
			url.searchParams.append('resource', TELEMETRY)
			const result = yield* Effect.tryPromise(() => request.promptAsync(DISCOVERY, {url: url.href}))
			if (result.type !== 'success') return yield* AuthError.make({message: 'Sign-in was not completed'})
			if (result.params['iss'] !== `${AUTH_URL}/api/auth`) {
				return yield* AuthError.make({message: 'The sign-in issuer did not match'})
			}
			yield* refreshing.withPermit(
				tokenRequest(registration.client_id, {
					code: result.params['code'] ?? '',
					code_verifier: request.codeVerifier ?? '',
					grant_type: 'authorization_code',
					redirect_uri: redirectUri
				})
			)
			yield* Atom.refresh(sessionAtom)
		}),
		Effect.mapError(cause => AuthError.make({cause, message: 'Cannot sign in to opm'})),
		alert('Not Signed In')
	)
)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/opm/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: pipe(
		MobileRuntime.layer('@deslop/opm', accessToken)(SERVER),
		Layer.provideMerge(RpcAuth.layerClient(accessToken)),
		Layer.provide(FetchHttpClient.layer)
	)
}) {}

// Chapters

type ChaptersJson = typeof ChaptersJson.Type
const ChaptersJson = Schema.fromJsonString(ChapterList)
const chaptersFile = new File(Paths.document, 'chapters.json')

function apply(chapters: ChapterList, event: ChaptersEvent) {
	if (event.reset) return Array.copy(event.upserted)
	return Array.sort(
		[
			...Array.filter(chapters, chapter => !Array.some(event.upserted, item => item.number === chapter.number)),
			...event.upserted
		],
		Order.flip(byNumber)
	)
}

// The copy on the iPhone opens the app at once; without one the app waits for the server rather than open on nothing.
export const chaptersAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		const session = get(sessionAtom)
		if (session._tag !== 'Success' || Option.isNone(session.value)) return Stream.succeed(Array.empty<ChapterItem>())
		get(MobileRuntime.activationsAtom)
		return Stream.concat(
			pipe(
				Effect.try(() => chaptersFile.textSync()),
				Effect.flatMap(Schema.decodeEffect(ChaptersJson)),
				Effect.option,
				Stream.fromEffect,
				Stream.flatMap(cached =>
					Stream.fromIterable(Option.toArray(Option.filter(cached, Array.isReadonlyArrayNonEmpty)))
				)
			),
			pipe(
				Effect.gen(function* () {
					// A page turn changes one chapter, so the copy is written once the reader pauses, off the scroll.
					const writes = yield* FiberHandle.make()
					return pipe(
						(yield* RpcClient)('chapters.watch', undefined),
						Stream.scan(Array.empty<ChapterItem>, apply),
						Stream.drop(1),
						Stream.tap(chapters =>
							FiberHandle.run(
								writes,
								pipe(
									Schema.encodeEffect(ChaptersJson)(chapters),
									Effect.flatMap(json => Effect.try(() => writeAtomically(chaptersFile, json))),
									Effect.delay('2 seconds'),
									Effect.ignore({log: 'Warn', message: 'The chapter list could not be kept on this iPhone'})
								)
							)
						)
					)
				}),
				Stream.unwrap,
				Stream.tapError(() => Atom.refresh(sessionAtom)),
				Stream.retry(Schedule.spaced('2 seconds'))
			)
		)
	})
)

// Reading

// Concurrent, so finishing one chapter while opening the next never cancels either write; the client is read once so a reconnect replays none.
export const readAtom = Atom.keepAlive(
	RpcClient.runtime.fn(
		(update: ReadingUpdate, get) =>
			pipe(
				get.result(RpcClient.runtime),
				Effect.flatMap(context =>
					Effect.provideContext(
						Effect.flatMap(RpcClient, client => client('chapters.read', update)),
						context
					)
				),
				Effect.ignore({log: 'Warn', message: 'The reading position was not saved'})
			),
		{concurrent: true}
	)
)

// Notifications

Notifications.setNotificationHandler({
	handleNotification: () =>
		// oxlint-disable-next-line eslint/no-restricted-globals -- expo-notifications' handler contract takes a Promise.
		Promise.resolve({shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true})
})

// Asked on the first launch, so a new chapter reaches the iPhone without a setting; a refused prompt stays refused.
export const pushAtom = RpcClient.runtime.atom(get =>
	pipe(
		Effect.gen(function* () {
			const session = get(sessionAtom)
			if (session._tag !== 'Success' || Option.isNone(session.value)) return
			get(MobileRuntime.activationsAtom)
			yield* Effect.promise(() => Notifications.setBadgeCountAsync(0))
			if (!(yield* Effect.promise(() => Notifications.requestPermissionsAsync())).granted) return
			const extra = yield* Schema.decodeUnknownEffect(Schema.Struct({eas: Schema.Struct({projectId: Schema.String})}))(
				Constants.expoConfig?.extra
			)
			const token = yield* Effect.tryPromise(() =>
				Notifications.getExpoPushTokenAsync({projectId: extra.eas.projectId})
			)
			yield* Effect.flatMap(RpcClient, client => client('devices.register', {token: token.data}))
		}),
		Effect.ignore({log: 'Warn', message: 'Notifications are not set up on this iPhone'})
	)
)

type ChapterData = typeof ChapterData.Type
const ChapterData = Schema.Struct({chapter: Schema.Finite})

function chapterOf(response: Notifications.NotificationResponse | null) {
	return pipe(
		Option.fromNullishOr(response?.notification.request.content.data),
		Option.flatMap(Schema.decodeUnknownOption(ChapterData)),
		Option.map(data => data.chapter)
	)
}

// The chapter of the notification the user tapped, also when it launched the app.
export const openedAtom = Atom.keepAlive(
	Atom.make(get => {
		const subscription = Notifications.addNotificationResponseReceivedListener(response =>
			get.setSelf(chapterOf(response))
		)
		get.addFinalizer(() => subscription.remove())
		return chapterOf(Notifications.getLastNotificationResponse())
	})
)
