import {Array, Effect, HashSet, Layer, Option, Order, Schema, Stream, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AtomRpc, Atom} from 'effect/reactivity'
import Constants from 'expo-constants'
import {File, Paths} from 'expo-file-system'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'

import {alert, cachedList, writeAtomically} from '@deslop/components-mobile/utils'
import {RpcAuth} from '@deslop/runtime/auth/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'
import * as MobileSession from '@deslop/runtime/mobile/session'

import {OpmNative} from '#modules/native/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {byNumber, keyOf, notificationOf} from '#services/chapters/lib/utils.ts'
import type {ChaptersEvent, ChapterList, ReadingUpdate} from '#services/chapters/schema.ts'
import {ChapterItem} from '#services/chapters/schema.ts'

const SERVER = 'https://opm.mp281x.xyz'
const SESSION = 'session'

// Auth

export const session = MobileSession.make('opm', SERVER, {
	clear: Effect.tryPromise(() => SecureStore.deleteItemAsync(SESSION)),
	read: Effect.try(() => SecureStore.getItem(SESSION) ?? ''),
	// Readable from the first unlock after a restart, so a socket that reconnects while the iPhone is locked finds it.
	write: text =>
		Effect.try(() => SecureStore.setItem(SESSION, text, {keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK}))
})

export const signInAtom = session.runtime.fn(() => pipe(session.signIn, alert('Not Signed In')))

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/opm/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: pipe(
		MobileRuntime.layer('@deslop/opm', session.accessToken)(SERVER),
		Layer.provideMerge(RpcAuth.layerClient(session.accessToken)),
		Layer.provide(FetchHttpClient.layer)
	)
}) {}

// Chapters

const chaptersFile = new File(Paths.document, 'chapters.json')

function apply(chapters: ChapterList, event: ChaptersEvent) {
	if (event.reset) return Array.copy(event.upserted)
	const replaced = HashSet.fromIterable(Array.map(event.upserted, keyOf))
	return Array.sort(
		[...Array.filter(chapters, chapter => !HashSet.has(replaced, keyOf(chapter))), ...event.upserted],
		Order.flip(byNumber)
	)
}

// The copy on the iPhone opens the app at once; without one the app waits for the server rather than open on nothing.
export const chaptersAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		if (!session.signedIn(get)) return Stream.succeed(Array.empty<ChapterItem>())
		// A page turn changes one chapter, and the copy is written once the reader pauses.
		return cachedList(
			get,
			chaptersFile,
			ChapterItem,
			pipe(
				Stream.unwrap(Effect.map(RpcClient, client => client('library.watch', undefined))),
				Stream.scan(Array.empty<ChapterItem>, apply),
				Stream.drop(1),
				session.renewing
			)
		)
	})
)

// Reading

// A chapter the list still lacks ten seconds after the reader opened it is out of reach, such as offline.
export const unreachableAtom = Atom.family((_key: string) => Atom.make(Effect.as(Effect.sleep('10 seconds'), true)))

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
			if (!session.signedIn(get)) return
			yield* Effect.tryPromise(() => Notifications.setBadgeCountAsync(0))
			if (!(yield* Effect.tryPromise(() => Notifications.requestPermissionsAsync())).granted) return
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

// Diagnostics

const crashFile = new File(Paths.document, 'crash.txt')

// iOS's crash report shows only React Native rethrowing a fatal JavaScript error, so its stack waits on disk for the next launch.
const fatalHandler = ErrorUtils.getGlobalHandler()
ErrorUtils.setGlobalHandler((error, fatal) => {
	if (fatal === true) {
		Option.map(
			Schema.decodeUnknownOption(Schema.Struct({message: Schema.String, stack: Schema.optionalKey(Schema.String)}))(
				error
			),
			// A disk that cannot take the stack must not hide the error itself.
			thrown => Option.liftThrowable(writeAtomically)(crashFile, thrown.stack ?? thrown.message)
		)
	}
	fatalHandler(error, fatal)
})

// A crash leaves no trace of its own, so the reports iOS and the handler above leave for a later launch go to the telemetry as errors.
export const diagnosticsAtom = RpcClient.runtime.atom(get =>
	pipe(
		Effect.gen(function* () {
			if (!session.signedIn(get)) return
			if (crashFile.exists) {
				yield* Effect.logError('A JavaScript error closed the app on an earlier run', crashFile.textSync())
				crashFile.delete()
			}
			yield* Effect.forEach(
				yield* Effect.try(() => OpmNative.takeDiagnostics()),
				report => Effect.logError('iOS reported a crash or hang on an earlier run', report),
				{concurrency: 1, discard: true}
			)
		}),
		Effect.ignore({log: 'Warn', message: 'The crash reports were not read'})
	)
)

// The chapter of the notification the user tapped, also when it launched the app.
export const openedAtom = Atom.keepAlive(
	Atom.make(get => {
		const subscription = Notifications.addNotificationResponseReceivedListener(response =>
			get.setSelf(notificationOf(response.notification.request.content.data))
		)
		get.addFinalizer(() => subscription.remove())
		return notificationOf(Notifications.getLastNotificationResponse()?.notification.request.content.data)
	})
)
