import {
	Array,
	Effect,
	Function,
	HashMap,
	HashSet,
	Option,
	Order,
	Redacted,
	Schema,
	Semaphore,
	Stream,
	pipe
} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'
import {applicationId} from 'expo-application'
import {File, Paths} from 'expo-file-system'
import {
	addNotificationResponseReceivedListener,
	addPushTokenListener,
	getDevicePushTokenAsync,
	getLastNotificationResponse,
	requestPermissionsAsync,
	setBadgeCountAsync,
	setNotificationHandler
} from 'expo-notifications'

import {cachedList, writeAtomically} from '@deslop/components-mobile/lib/files'
import {liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {registerPushTokens} from '@deslop/runtime/mobile/push-token'
import {provideRuntimeOnce} from '@deslop/runtime/mobile/session'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import type {UserId} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'

import type {PageTurn, ReaderState} from '#lib/reader.ts'
import {turnPage} from '#lib/reader.ts'
import {RpcClient, session} from '#lib/session.ts'
import {OpmNative} from '#modules/native/index.ts'
import {byNumber, keyOf, notificationOf} from '#services/chapters/lib/utils.ts'
import type {ChapterKey, ChapterItem, Position, ReadingPosition} from '#services/chapters/schema.ts'
import {ChaptersError, ReadingChapter} from '#services/chapters/schema.ts'
import {ChapterBundle} from '#services/push/schema.ts'

const chaptersFile = new File(Paths.document, 'chapters.json')

const reduceChapters = listReducer<ChapterItem, ChapterKey>(Order.flip(byNumber), keyOf)

// The copy on the iPhone opens the app at once; without one the app waits for the server rather than open on nothing.
export const chaptersAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		// A page turn changes one chapter, and the copy is written once the reader pauses.
		cachedList(
			get,
			session,
			chaptersFile,
			ReadingChapter.json,
			pipe(
				liveStream(RpcClient, 'chapters.events'),
				Stream.scan(Array.empty<ChapterItem>, (chapters, event) => reduceChapters(chapters, {...event, removed: []})),
				Stream.drop(1)
			),
			reconnectOnDrop
		)
	)
)

// A chapter the list still lacks ten seconds after the reader opened it is out of reach, such as offline.
export const unreachableAtom = Atom.family((_key: ChapterKey) => Atom.make(Effect.as(Effect.sleep('10 seconds'), true)))

// Each account's places that did not reach the server, such as pages turned offline, kept while the app runs.
const unsavedByAccountAtom = Atom.family((_account: UserId) =>
	Atom.keepAlive(Atom.make(HashMap.empty<ChapterKey, Position>()))
)

// The admitted account's unsaved places; the list and the reader show them over the server's, and opening the chapter saves them again.
export const unsavedAtom = Atom.make(get =>
	Option.match(session.admitted(get), {
		onNone: () => HashMap.empty<ChapterKey, Position>(),
		onSome: account => get(unsavedByAccountAtom(account))
	})
)

const readingWrites = Semaphore.makeUnsafe(1)

// Queue writes without cancelling page turns; a function atom reads the client and the account once, so a reconnect replays none.
export const readAtom = Atom.keepAlive(
	Atom.fn(
		(update: typeof ReadingPosition.json.Type, get) => {
			const unsaved = Option.map(AsyncResult.value(get(session.account)), account => unsavedByAccountAtom(account.id))
			function keep(places: (current: HashMap.HashMap<ChapterKey, Position>) => HashMap.HashMap<ChapterKey, Position>) {
				return Effect.sync(() => Option.map(unsaved, atom => get.set(atom, places(get(atom)))))
			}
			return pipe(
				provideRuntimeOnce(
					get,
					RpcClient.runtime,
					readingWrites.withPermit(Effect.flatMap(RpcClient, client => client('chapters.write', update)))
				),
				Effect.tap(() => keep(HashMap.remove(keyOf(update)))),
				// Only a write the server never answered leaves its place on the iPhone; a refused one is not kept.
				Effect.tapErrorTag('WriteError', () =>
					keep(HashMap.set(keyOf(update), {done: update.done, page: update.page}))
				),
				Effect.ignore({log: 'Warn', message: 'The reading position was not saved'})
			)
		},
		{concurrent: true}
	)
)

const readerStateAtom = Atom.family((_reader: ChapterKey) =>
	Atom.make<ReaderState>({finished: HashSet.empty(), inView: Option.none(), strip: []})
)

// Each page turn saves the reading position and moves the reader on.
export const readerAtom = Atom.family((reader: ChapterKey) =>
	Atom.writable(
		get => get(readerStateAtom(reader)),
		(context, turn: PageTurn) =>
			Option.match(turnPage(context.get(readerStateAtom(reader)), turn), {
				onNone: Function.constUndefined,
				onSome: turned => {
					for (const save of turned.saves) context.set(readAtom, save)
					context.set(readerStateAtom(reader), turned.next)
				}
			})
	)
)

// fallow-ignore-next-line code-duplication -- Each notification app owns its handler so shared components do not autolink notifications into Stash.
setNotificationHandler({
	handleNotification: () =>
		// oxlint-disable-next-line eslint/no-restricted-globals -- expo-notifications' handler contract takes a Promise.
		Promise.resolve({shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true})
})

// Asked on the first launch, so a new chapter reaches the iPhone without a setting; a refused prompt stays refused.
export const pushAtom = RpcClient.runtime.atom(get =>
	Effect.ignore(
		Effect.gen(function* () {
			if (Option.isNone(session.admitted(get))) return
			yield* Effect.tryPromise({
				catch: cause => ChaptersError.make({cause, message: 'The badge could not be cleared.'}),
				try: () => setBadgeCountAsync(0)
			})
			if (
				!(yield* Effect.tryPromise({
					catch: cause => ChaptersError.make({cause, message: 'The notification permission could not be asked.'}),
					try: () => requestPermissionsAsync()
				})).granted
			) {
				return
			}
			const bundle = yield* Schema.decodeUnknownEffect(ChapterBundle)(applicationId)
			const client = yield* RpcClient
			yield* registerPushTokens(
				addPushTokenListener,
				Effect.tryPromise({
					catch: cause => ChaptersError.make({cause, message: 'The push token could not be read.'}),
					try: () => getDevicePushTokenAsync()
				}),
				token => client('push.register', {bundle, kind: 'alert', token: Redacted.make(ApnsToken.make(token))})
			)
		}),
		{log: 'Warn', message: 'Notifications are not set up on this iPhone'}
	)
)

const crashFile = new File(Paths.document, 'crash.txt')

// iOS's crash report shows only React Native rethrowing a fatal JavaScript error, so its stack waits on disk for the next launch.
const fatalHandler = ErrorUtils.getGlobalHandler()
ErrorUtils.setGlobalHandler((error, fatal) => {
	if (fatal === true) {
		Option.map(
			Schema.decodeUnknownOption(
				Schema.Struct({message: Schema.String, stack: Schema.OptionFromOptionalKey(Schema.String)})
			)(error),
			// A disk that cannot take the stack must not hide the error itself.
			thrown =>
				Option.liftThrowable(writeAtomically)(
					crashFile,
					Option.getOrElse(thrown.stack, () => thrown.message)
				)
		)
	}
	fatalHandler(error, fatal)
})

// A crash leaves no trace of its own, so the reports iOS and the handler above leave for a later launch go to the telemetry as errors.
export const diagnosticsAtom = RpcClient.runtime.atom(get =>
	Effect.ignore(
		Effect.gen(function* () {
			if (Option.isNone(session.admitted(get))) return
			if (crashFile.exists) {
				yield* Effect.logError('A JavaScript error closed the app on an earlier run', crashFile.textSync())
				crashFile.delete()
			}
			yield* Effect.forEach(
				yield* Effect.try({
					catch: cause => ChaptersError.make({cause, message: 'The crash reports could not be read.'}),
					try: () => OpmNative.takeDiagnostics()
				}),
				report => Effect.logError('iOS reported a crash or hang on an earlier run', report),
				{concurrency: 1, discard: true}
			)
		}),
		{log: 'Warn', message: 'The crash reports were not read'}
	)
)

export const openedAtom = Atom.keepAlive(
	Atom.make(get => {
		const subscription = addNotificationResponseReceivedListener(response =>
			get.setSelf(notificationOf(response.notification.request.content.data))
		)
		get.addFinalizer(() => subscription.remove())
		return notificationOf(getLastNotificationResponse()?.notification.request.content.data)
	})
)
