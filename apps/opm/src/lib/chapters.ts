import {Array, Boolean, Effect, HashSet, Option, Order, Redacted, Schema, Stream, pipe} from 'effect'

import {AtomRpc, Atom} from 'effect/reactivity'
import Constants from 'expo-constants'
import {File, Paths} from 'expo-file-system'
import {
	addNotificationResponseReceivedListener,
	getExpoPushTokenAsync,
	getLastNotificationResponse,
	requestPermissionsAsync,
	setBadgeCountAsync,
	setNotificationHandler
} from 'expo-notifications'

import {cachedList, writeAtomically} from '@deslop/components-mobile/files'
import {foregroundNotifications} from '@deslop/components-mobile/notifications'
import {hues} from '@deslop/components-mobile/theme'
import {liveStream} from '@deslop/runtime/client/live-stream'
import {keychain} from '@deslop/runtime/mobile/keychain'
import {makeSession, provideRuntimeOnce} from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {OpmNative} from '#modules/native/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {byNumber, keyOf, notificationOf} from '#services/chapters/lib/utils.ts'
import type {
	ChapterItem,
	ChapterKey,
	ChapterNumber,
	ChaptersEvent,
	ChapterList,
	ReadingUpdate
} from '#services/chapters/schema.ts'
import {Chapter, ChaptersError, PushToken} from '#services/chapters/schema.ts'

export const primary = hues.ivory

const EasProjectId = pipe(Schema.String, Schema.brand('EasProjectId'))

export const session = makeSession('https://opm.mp281x.xyz', keychain)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/opm/lib/chapters/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}

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
		if (!session.signedIn(get)) return Stream.never
		// A page turn changes one chapter, and the copy is written once the reader pauses.
		return cachedList(
			get,
			chaptersFile,
			Chapter.json,
			pipe(liveStream(RpcClient, 'chapters.events'), Stream.scan(Array.empty<ChapterItem>, apply), Stream.drop(1)),
			session.reconnectOrSignOut
		)
	})
)

// A chapter the list still lacks ten seconds after the reader opened it is out of reach, such as offline.
export const unreachableAtom = Atom.family((_key: ChapterKey) => Atom.make(Effect.as(Effect.sleep('10 seconds'), true)))

// Concurrent, so finishing one chapter while opening the next never cancels either write; the client is read once so a reconnect replays none.
export const readAtom = Atom.keepAlive(
	Atom.fn(
		(update: ReadingUpdate, get) =>
			Effect.ignore(
				provideRuntimeOnce(
					get,
					RpcClient.runtime,
					Effect.flatMap(RpcClient, client => client('chapters.read', update))
				),
				{log: 'Warn', message: 'The reading position was not saved'}
			),
		{concurrent: true}
	)
)

// One page turn in a reader opened on a chapter: the chapters from it on, in order, and the strip's page index.
type PageTurn = {following: ChapterList; index: number; opened: ChapterNumber}

// What one opened reader has passed: how many chapters its strip shows, the chapter in view and those it finished, so a page turn before the server's copy of the list arrives cannot unfinish one.
type ReaderState = {finished: HashSet.HashSet<ChapterNumber>; inView: Option.Option<ChapterNumber>; shown: number}

const readerStateAtom = Atom.family((_reader: ChapterKey) =>
	Atom.make<ReaderState>({finished: HashSet.empty(), inView: Option.none(), shown: 2})
)

// The reading positions one page turn saves, in order, and the reader's next state; none for a page past the shown chapters. Passing into the next chapter finishes every page of the one before it, and reaching the last shown chapter adds the next.
function turnPage(state: ReaderState, turn: PageTurn) {
	const shown = Array.take(turn.following, state.shown)
	return pipe(
		Array.zip(
			shown,
			Array.scan(shown, 0, (total, chapter) => total + chapter.pages.length)
		),
		Array.findFirst(pair => turn.index < pair[1] + pair[0].pages.length),
		Option.map(pair => {
			const chapter = pair[0]
			const page = turn.index - pair[1]
			const previous = Option.getOrElse(state.inView, () => turn.opened)
			const before = Array.findFirst(shown, item => item.number === previous && item.number < chapter.number)
			const passed = Option.match(before, {
				onNone: () => state.finished,
				onSome: item => HashSet.add(state.finished, item.number)
			})
			// A finished chapter stays finished while it is read again; only "Unread" in the list starts it over.
			const finished = Boolean.match(
				page === chapter.pages.length - 1 || Option.exists(chapter.reading, reading => reading.done),
				{onFalse: () => passed, onTrue: () => HashSet.add(passed, chapter.number)}
			)
			const last = Option.exists(Array.last(shown), item => item.number === chapter.number)
			const saves: ReadingUpdate[] = [
				...Option.toArray(
					Option.map(before, item => ({
						done: true,
						number: item.number,
						page: item.pages.length - 1,
						series: item.series
					}))
				),
				{done: HashSet.has(finished, chapter.number), number: chapter.number, page, series: chapter.series}
			]
			const next: ReaderState = {
				finished,
				inView: Option.some(chapter.number),
				shown: Boolean.match(last && state.shown < turn.following.length, {
					onFalse: () => state.shown,
					onTrue: () => state.shown + 1
				})
			}
			return {next, saves}
		})
	)
}

// Each page turn saves the reading position and moves the reader on.
export const readerAtom = Atom.family((reader: ChapterKey) =>
	Atom.writable(
		get => get(readerStateAtom(reader)),
		(context, turn: PageTurn) =>
			Option.match(turnPage(context.get(readerStateAtom(reader)), turn), {
				onNone: () => undefined,
				onSome: turned => {
					for (const save of turned.saves) context.set(readAtom, save)
					context.set(readerStateAtom(reader), turned.next)
				}
			})
	)
)

setNotificationHandler(foregroundNotifications)

// Asked on the first launch, so a new chapter reaches the iPhone without a setting; a refused prompt stays refused.
export const pushAtom = RpcClient.runtime.atom(get =>
	Effect.ignore(
		Effect.gen(function* () {
			if (!session.signedIn(get)) return
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
			const extra = yield* Schema.decodeUnknownEffect(Schema.Struct({eas: Schema.Struct({projectId: EasProjectId})}))(
				Constants.expoConfig?.extra
			)
			const token = yield* Effect.tryPromise({
				catch: cause => ChaptersError.make({cause, message: 'The push token could not be read.'}),
				try: () => getExpoPushTokenAsync({projectId: extra.eas.projectId})
			})
			yield* Effect.flatMap(RpcClient, client =>
				client('chapters.register', {token: Redacted.make(PushToken.make(token.data))})
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
			if (!session.signedIn(get)) return
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
