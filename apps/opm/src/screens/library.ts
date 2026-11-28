import {Command, Component, Router, Subscription} from '@effect/ui'
import type {View} from '@effect/ui'

import {
	Array,
	Boolean,
	Context,
	DateTime,
	Effect,
	Function,
	HashMap,
	HashSet,
	Layer,
	Match,
	Number,
	Option,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import type {RowOptions, ToolbarAction, ToolbarOptions} from '@deslop/components/model'
import {observe} from '@deslop/runtime/client/atom'
import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import type {AuthError} from '@deslop/runtime/shared/auth'
import {dayOf} from '@deslop/runtime/shared/format'

import {ChapterNumber, ReadingPosition, SERIES_NAMES, Series, byChapterNumber, keyOf} from '#contracts'
import type {ChapterIdentity, ReadingChapter} from '#contracts'

import type {catalogue} from '#screens/catalogue.ts'
import {Message, Model} from '#screens/model.ts'
import type {Step} from '#screens/model.ts'
import {savedPage, stripOf, turnPage, turnsOf, withUnsaved} from '#screens/reading.ts'
import {CloseChapter, OpmRoute, libraryOf, targetOf} from '#screens/routes.ts'

const SCROLL = {scroll: false} as const

function wideOf(size: {height: number; width: number}) {
	return size.width >= 640 && (size.width >= 800 || size.height >= 600)
}

function bookOf(size: {height: number; width: number}) {
	return size.width >= 700 && size.height > 0 && size.width > size.height
}

function chaptersOf(model: Model) {
	return Option.match(AsyncResult.value(model.catalogue), {
		onNone: () => Array.empty<ReadingChapter>(),
		onSome: all => withUnsaved(all, model.unsaved)
	})
}

function chapterView(model: Model, target: ChapterIdentity) {
	if (model.reader === undefined) return undefined
	const following = pipe(
		chaptersOf(model),
		Array.filter(chapter => chapter.series === target.series && chapter.number >= target.number),
		Array.sort(byChapterNumber)
	)
	if (Array.isReadonlyArrayEmpty(model.reader.strip) && following[0]?.number !== target.number) return undefined
	const shown = stripOf(model.reader, following)
	const pages = Array.flatMap(shown, chapter => chapter.pages)
	const widePages = HashMap.reduce(model.shapes, HashSet.empty<string>(), (wide, aspect, src) => {
		if (aspect > 1) return HashSet.add(wide, src)
		return wide
	})
	const turns = turnsOf(shown, bookOf(model) && model.listHidden, widePages)
	const page = model.reader.page ?? savedPage(shown[0])
	const turn = pipe(
		turns,
		Array.findFirstIndex(pair => Array.contains(pair, page)),
		Option.getOrElse(Function.constant(-1))
	)
	return {following, pages, shown, turn, turns}
}

function openedReader() {
	return {
		bars: false,
		expired: false,
		finished: HashSet.empty<ChapterIdentity['number']>(),
		inView: Option.none<ChapterIdentity['number']>(),
		page: undefined,
		press: undefined,
		strip: []
	}
}

// Freeze the chapter and its exact page before a fold changes the turn around it.
function opened(model: Model) {
	const target = targetOf(model.route)
	if (target === undefined || model.reader === undefined || model.reader.page !== undefined) return model
	const reading = chapterView(model, target)
	if (reading === undefined) return model
	return {...model, reader: {...model.reader, page: savedPage(reading.shown[0]), strip: reading.shown}}
}

type Props = typeof Props.Type
const Props = Schema.Struct({route: OpmRoute})

export type LibraryPlatform<R> = {
	readonly signIn?: Effect.Effect<boolean, AuthError, R>
	readonly signOut?: Effect.Effect<number, AuthError, R>
	readonly registerPush?: Stream.Stream<never, never, AtomRegistry.AtomRegistry>
}

function displayOf(model: Model) {
	const target = targetOf(model.route)
	const series = libraryOf(model.route).search.series ?? 'manga'
	const accountFailure = blockingFailure(model.account)
	const failure = pipe(
		accountFailure,
		Option.filter(isDeniedCause),
		Option.orElse(() => Option.orElse(blockingFailure(model.catalogue), () => accountFailure))
	)
	const viewer = AsyncResult.value(model.account)
	const waiting = Option.isNone(viewer) || Option.isNone(AsyncResult.value(model.catalogue))
	const reading = pipe(
		Option.fromUndefinedOr(target),
		Option.filter(() => Option.isSome(viewer)),
		Option.flatMap(chapter => Option.fromUndefinedOr(chapterView(model, chapter))),
		Option.getOrUndefined
	)
	const chapters = Array.filter(chaptersOf(model), chapter => chapter.series === series)
	const current = Option.getOrUndefined(model.reader?.inView ?? Option.none()) ?? target?.number
	const rows = Array.map(chapters, chapter => {
		const done = Option.exists(chapter.reading, position => position.done)
		const date = Option.match(chapter.postedAt, {
			onNone: Function.constant(''),
			onSome: at => {
				if (DateTime.toDate(at).toDateString() === DateTime.toDate(model.now).toDateString()) return 'Today'
				return dayOf(at, model.now)
			}
		})
		const place = Option.filter(chapter.reading, position => !position.done && position.page > 0)
		return {
			active: wideOf(model) && !model.listHidden && chapter.number === current,
			chapter: {number: chapter.number, series: chapter.series},
			cover: chapter.pages[0],
			coverOpacity: Boolean.match(done, {onFalse: Function.constant(1), onTrue: Function.constant(0.45)}),
			data: {
				id: keyOf(chapter),
				line: pipe([chapter.title, date], Array.filter(String.isNonEmpty), Array.join(' · ')),
				title: `Chapter ${chapter.number}`,
				trailing: Option.match(place, {
					onNone: () => `${chapter.pages.length} p`,
					onSome: position => `${position.page + 1}/${chapter.pages.length}`
				})
			},
			muted: done
		}
	})
	const turn = reading?.turn ?? -1
	const active = reading?.turns[turn] ?? []
	const visible = HashSet.fromIterable(active)
	const start = Number.max(0, turn - 1)
	const stripes = pipe(reading?.turns ?? [], Array.drop(start), Array.take(turn + 3 - start), Array.flatten)
	function sideOf(index: number) {
		if (active.length < 2) return 'single' as const
		if (index === active[1]) return 'left' as const
		return 'right' as const
	}
	const pages = Array.flatMap(stripes, index =>
		pipe(
			Option.fromUndefinedOr(reading?.pages[index]),
			Option.map(src => ({
				aspect: pipe(model.shapes, HashMap.get(src), Option.getOrElse(Function.constant(0.71))),
				failed: HashSet.has(model.failed, src),
				index,
				side: sideOf(index),
				src,
				visible: HashSet.has(visible, index)
			})),
			Option.toArray
		)
	)
	const problem = Option.match(failure, {
		onNone: () =>
			Boolean.match(OpmRoute.isAnyOf(['NotFound'])(model.route), {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('Back to chapters')
			}),
		onSome: cause => {
			if (needsSignInCause(cause)) {
				if (model.busy) return 'Signing in…'
				return model.authProblem ?? 'Sign in to read chapters'
			}
			if (isDeniedCause(cause)) return 'Access denied'
			return 'Couldn’t load chapters'
		}
	})
	const book = bookOf(model)
	const wide = wideOf(model)
	const halves = Boolean.match(book && target === undefined, {
		onFalse: () => rows.length,
		onTrue: () => Math.ceil(rows.length / 2)
	})
	function listWidth() {
		if (book) return model.width / 2
		if (model.width >= 1000) return 380
		return 270
	}
	return {
		bars: model.reader?.bars === true,
		book,
		busy: model.busy,
		covers: model.covers,
		height: model.height,
		listHidden: model.listHidden,
		listWidth: listWidth(),
		next: turn >= 0 && turn < (reading?.turns.length ?? 0) - 1,
		older: Array.drop(rows, halves),
		pages,
		previous: turn > 0,
		problem,
		reader: pipe(
			Option.fromUndefinedOr(target),
			Option.map(chapter => ({
				id: keyOf(chapter),
				ready: turn >= 0,
				title: `Chapter ${current ?? chapter.number}`,
				waiting: turn < 0 && (waiting || model.reader?.expired === false)
			})),
			Option.getOrUndefined
		),
		retryable: Option.exists(failure, cause => !needsSignInCause(cause) && !isDeniedCause(cause)),
		rows: Array.take(rows, halves),
		series,
		seriesChoices: Array.map(Series.literals, choice => ({
			checked: choice === series,
			series: choice,
			title: SERIES_NAMES[choice]
		})),
		signIn: Option.exists(failure, needsSignInCause),
		signOut: Option.exists(viewer, account => account.signOut),
		stale: AsyncResult.isFailure(model.catalogue),
		waiting,
		wide,
		width: model.width
	}
}

export type Screen = ReturnType<typeof displayOf>

export function chapterListOf(screen: Screen, older: boolean) {
	const rows = Boolean.match(older, {onFalse: () => screen.rows, onTrue: () => screen.older})
	return {
		empty: Array.isReadonlyArrayEmpty(rows) && !older,
		label: Boolean.match(older, {onFalse: Function.constant('Chapters'), onTrue: Function.constant('Older chapters')}),
		rows
	}
}

class Save extends Command.Service<Save>()('Opm/Save', {args: {updates: Schema.Array(ReadingPosition.json)}}) {}

class Refresh extends Command.Service<Refresh>()('Opm/Refresh', {args: {}}) {}

class Authenticate extends Command.Service<Authenticate>()('Opm/Authenticate', {
	args: {signOut: Schema.Boolean},
	success: Message
}) {}

export function library<V extends View.Elements, R, Auth>(
	elements: View.Vocabulary<V>,
	queries: ReturnType<typeof catalogue>,
	platform: LibraryPlatform<Auth>,
	render: (h: View.WithTags<Message, unknown, V>, screen: Screen) => View.Content<Message, R>
) {
	const save = Save.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => request => Effect.sync(() => registry.set(queries.readingWritesAtom, request.updates))
		)
	)
	const refresh = Refresh.toLayer(
		Effect.map(
			AtomRegistry.AtomRegistry,
			registry => () =>
				Effect.sync(() => {
					registry.refresh(queries.sessionAccount)
					registry.refresh(queries.chaptersAtom)
				})
		)
	)
	function authChanged(registry: AtomRegistry.AtomRegistry) {
		return Effect.sync(() => {
			registry.refresh(queries.rpc)
			registry.refresh(queries.sessionAccount)
			registry.refresh(queries.chaptersAtom)
		})
	}
	const authenticate = Authenticate.toLayer(
		Effect.map(Effect.context<Auth | AtomRegistry.AtomRegistry>(), context => {
			const registry = Context.get(context, AtomRegistry.AtomRegistry)
			return request =>
				Effect.provideContext(
					Effect.gen(function* () {
						if (request.signOut && platform.signOut !== undefined) {
							return yield* pipe(
								platform.signOut,
								Effect.tap(() => authChanged(registry)),
								Effect.match({
									onFailure: error => Message.AuthDone({problem: error.message}),
									onSuccess: status =>
										Message.AuthDone({
											problem: Boolean.match(status >= 200 && status < 400, {
												onFalse: Function.constant('Auth did not confirm ending the shared session.'),
												onTrue: Function.constUndefined
											})
										})
								})
							)
						}
						if (!request.signOut && platform.signIn !== undefined) {
							return yield* pipe(
								platform.signIn,
								Effect.tap(Boolean.match({onFalse: () => Effect.void, onTrue: () => authChanged(registry)})),
								Effect.match({
									onFailure: error => Message.AuthDone({problem: error.message}),
									onSuccess: () => Message.AuthDone({problem: undefined})
								})
							)
						}
						return Message.AuthDone({problem: undefined})
					}),
					context
				)
		})
	)

	function movePage($: Component.Step<Model, Message, never, Save>, step: Step) {
		const target = targetOf($.model.route)
		if (target === undefined || $.model.reader === undefined) return $
		const reading = chapterView($.model, target)
		if (reading === undefined) return $
		const position = reading.turn + step
		const turn = reading.turns[position]
		if (turn === undefined) return $
		// The left page of a final spread counts as read.
		const page = Boolean.match(position === reading.turns.length - 1, {
			onFalse: () => Array.headNonEmpty(turn),
			onTrue: () => Array.lastNonEmpty(turn)
		})
		const turned = Option.getOrUndefined(
			turnPage($.model.reader, {following: reading.following, index: page, opened: target.number})
		)
		if (turned === undefined) return $
		return $.evolve({reader: {...$.model.reader, ...turned.next, bars: false, page}}).run(
			Command.asNoop(Save.make({updates: turned.saves}))
		)
	}

	function gesture($: Component.Step<Model, Message, never, Save>, dx: number, dy: number) {
		if ($.model.reader === undefined) return $
		if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy)) {
			return movePage($, Boolean.match(dx > 0, {onFalse: Function.constant(-1), onTrue: Function.constant(1)}))
		}
		if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return $.evolve({reader: {...$.model.reader, bars: !$.model.reader.bars}})
		return $
	}

	return Component.provide(
		Component.withElements(elements)({
			message: Message,
			model: Model,
			name: 'OpmLibrary',
			props: Props,
			restore: false
		}).make({
			init: $ => ({
				account: AsyncResult.initial(),
				authProblem: undefined,
				busy: false,
				canBack: false,
				catalogue: AsyncResult.initial(),
				covers: HashSet.empty(),
				failed: HashSet.empty(),
				height: 0,
				listHidden: false,
				now: DateTime.nowUnsafe(),
				reader: Boolean.match(targetOf($.props.route) === undefined, {
					onFalse: openedReader,
					onTrue: Function.constUndefined
				}),
				route: $.props.route,
				shapes: HashMap.empty(),
				unsaved: HashMap.empty(),
				width: 0
			}),
			subscriptions: state => {
				const target = targetOf(state.model.route)
				const signedIn = Option.getOrUndefined(AsyncResult.value(state.model.account))
				const register = platform.registerPush
				return [
					Router.subscription(OpmRoute, state.model.route, route => Message.Route({route})),
					Subscription.make(
						'account',
						observe(queries.sessionAccount, account => Message.Account({account}))
					),
					Subscription.make(
						'catalogue',
						observe(queries.chaptersAtom, catalogue => Message.Catalogue({catalogue}))
					),
					Subscription.make(
						'unsaved',
						observe(queries.unsavedAtom, unsaved => Message.Unsaved({unsaved}))
					),
					Subscription.make(
						'clock',
						observe(clockAtom('1 minute'), now => Message.Clock({now}))
					),
					register !== undefined &&
						signedIn !== undefined &&
						Subscription.make('push-registration', signedIn.id, () => register),
					target !== undefined &&
						state.model.reader !== undefined &&
						state.model.reader.page === undefined &&
						!state.model.reader.expired &&
						Subscription.make('unknown-chapter', keyOf(target), () =>
							Stream.fromEffect(Effect.as(Effect.sleep('10 seconds'), Message.Expired({chapter: target})))
						)
				]
			},
			update: {
				Account: ($, next) => $.evolve({account: next.account}),
				AuthDone: ($, next) => $.evolve({authProblem: next.problem, busy: false}),
				Catalogue: ($, next) => $.set(opened({...$.model, catalogue: next.catalogue})),
				Clock: ($, next) => $.evolve({now: next.now}),
				Close: $ => $.run(Command.asNoop(CloseChapter.make({back: $.model.canBack, route: $.model.route}))),
				CoverSettled: ($, next) => $.evolve({covers: HashSet.add($.model.covers, next.src)}),
				Expired: ($, next) => {
					const target = targetOf($.model.route)
					if ($.model.reader === undefined || target === undefined || keyOf(next.chapter) !== keyOf(target)) {
						return $.model
					}
					return $.evolve({reader: {...$.model.reader, expired: true}})
				},
				Gesture: ($, next) => gesture($, next.dx, next.dy),
				Image: ($, message) => {
					if (message.aspect <= 0) return $.evolve({failed: HashSet.add($.model.failed, message.src)})
					return $.evolve({
						failed: HashSet.remove($.model.failed, message.src),
						shapes: HashMap.set($.model.shapes, message.src, message.aspect)
					})
				},
				Layout: ($, message) => {
					if (message.width === $.model.width && message.height === $.model.height) return $.model
					const next = $.evolve({height: message.height, width: message.width})
					if (wideOf($.model) !== wideOf(next.model) || bookOf($.model) !== bookOf(next.model)) {
						return next.viewTransition(['design-layout'])
					}
					return next
				},
				Move: ($, next) => movePage($, next.step),
				Open: ($, next) =>
					$.run(
						Command.asNoop(
							Router.patchSearch(
								OpmRoute,
								libraryOf($.model.route),
								{chapter: next.chapter.number, series: next.chapter.series},
								{
									...SCROLL,
									history: Boolean.match(targetOf($.model.route) === undefined, {
										onFalse: Function.constant('replace'),
										onTrue: Function.constant('push')
									})
								}
							)
						)
					),
				PointerCancel: ($, cancel) => {
					if ($.model.reader?.press?.pointerId !== cancel.pointerId) return $.model
					return $.evolve({reader: {...$.model.reader, press: undefined}})
				},
				PointerDown: ($, press) => {
					if ($.model.reader === undefined || $.model.reader.press !== undefined) return $.model
					return $.evolve({reader: {...$.model.reader, press: {pointerId: press.pointerId, x: press.x, y: press.y}}})
				},
				PointerUp: ($, release) => {
					if ($.model.reader?.press?.pointerId !== release.pointerId) return $.model
					const dx = release.x - $.model.reader.press.x
					const dy = release.y - $.model.reader.press.y
					return gesture($.evolve({reader: {...$.model.reader, press: undefined}}), dx, dy)
				},
				Retry: $ => $.run(Command.asNoop(Refresh.make({}))),
				RetryPage: ($, next) => $.evolve({failed: HashSet.remove($.model.failed, next.src)}),
				Route: ($, next) => {
					const previous = targetOf($.model.route)
					const target = targetOf(next.route)
					if (previous?.number === target?.number && previous?.series === target?.series) {
						return $.evolve({route: next.route})
					}
					const result = $.set(
						opened({
							...$.model,
							canBack: target !== undefined && (previous === undefined || $.model.canBack),
							listHidden: target !== undefined && $.model.listHidden,
							reader: Boolean.match(target === undefined, {onFalse: openedReader, onTrue: Function.constUndefined}),
							route: next.route
						})
					)
					if (wideOf($.model) || (previous !== undefined && target !== undefined)) {
						return result.viewTransition(['design-layout'])
					}
					if (target === undefined) return result.viewTransition(['design-detail-out'])
					return result.viewTransition(['design-detail-in'])
				},
				Series: ($, next) => {
					const route = libraryOf($.model.route)
					if (next.series === (route.search.series ?? 'manga')) return $.model
					return $.run(
						Command.asNoop(Router.patchSearch(OpmRoute, route, {chapter: undefined, series: next.series}, SCROLL))
					)
				},
				Sidebar: $ => $.evolve({listHidden: !$.model.listHidden}).viewTransition(['design-layout']),
				SignIn: $ => $.evolve({authProblem: undefined, busy: true}).run(Authenticate.make({signOut: false})),
				SignOut: $ => $.evolve({authProblem: undefined, busy: true}).run(Authenticate.make({signOut: true})),
				Unsaved: ($, next) => $.set(opened({...$.model, unsaved: next.unsaved}))
			},
			view: (h, model) => render(h, displayOf(model))
		}),
		Layer.mergeAll(save, refresh, authenticate)
	)
}

const ChooseChapter = Component.define({
	events: Message,
	message: Message,
	model: Schema.Void,
	name: 'ChooseChapter',
	props: Schema.Struct({chapter: Schema.Struct({number: ChapterNumber, series: Series})})
}).make({
	init: Function.constVoid,
	parts: p => ({
		select: p.part((el, event: string, _id: string) => el.on(event, Message.Open({chapter: p.props.chapter})))
	}),
	update: ($, message) => $.set(undefined).emit(message)
})

export function chapterRows<Cover>(
	h: View.HelperBase<Message, unknown>,
	rows: Screen['rows'],
	cover: (row: Screen['rows'][number]) => Cover,
	render: (options: RowOptions<Cover>) => View.Content<Message>
) {
	return Array.map(rows, row =>
		ChooseChapter(h, {
			key: row.data.id,
			onEmit: Function.identity,
			props: {chapter: row.chapter},
			view: parts =>
				render({active: row.active, cover: cover(row), item: row.data, muted: row.muted, select: parts.select})
		})
	)
}

export const ChooseToolbar = Component.define({
	events: Message,
	message: Message,
	model: Schema.Void,
	name: 'ChooseToolbar'
}).make({
	init: Function.constVoid,
	parts: p => ({
		choose: p.part((el, event: string, identify: Parameters<ToolbarOptions['choose']>[2]) =>
			el.on(event, value => {
				const id = identify(value)
				if (Schema.is(Series)(id)) return Message.Series({series: id})
				return pipe(
					Match.value(id),
					Match.when('back', () => Message.Close()),
					Match.when('sidebar', () => Message.Sidebar()),
					Match.when('next-page', () => Message.Move({step: 1})),
					Match.when('previous-page', () => Message.Move({step: -1})),
					Match.when('retry', () => Message.Retry()),
					Match.when('sign-out', () => Message.SignOut()),
					Match.orElse(Function.constUndefined)
				)
			})
		)
	}),
	update: ($, message) => $.set(undefined).emit(message)
})

export function toolbar(screen: Screen, native: boolean): readonly ToolbarAction[] {
	const menu = Array.map(screen.seriesChoices, choice => ({
		checked: choice.checked,
		id: choice.series,
		label: choice.title
	}))
	return Array.filter(
		[
			screen.reader !== undefined && {id: 'back', label: 'Back', symbol: 'chevron.left'},
			screen.reader !== undefined &&
				screen.wide && {
					id: 'sidebar',
					label: Boolean.match(screen.listHidden, {
						onFalse: Function.constant('Hide list'),
						onTrue: Function.constant('Show list')
					}),
					symbol: 'sidebar.left'
				},
			screen.next && {id: 'next-page', label: 'Next page', symbol: 'chevron.left'},
			screen.previous && {id: 'previous-page', label: 'Previous page', symbol: 'chevron.right'},
			{
				id: 'series',
				label: 'Series',
				menu: Boolean.match(!native && screen.signOut, {
					onFalse: () => menu,
					onTrue: () => [...menu, {disabled: screen.busy, id: 'sign-out', label: 'Sign out'}]
				}),
				symbol: 'books.vertical'
			},
			screen.stale && {id: 'retry', label: 'Out of date. Retry', symbol: 'exclamationmark.circle'},
			native &&
				screen.signOut && {
					disabled: screen.busy,
					id: 'sign-out',
					label: 'Sign out',
					symbol: 'rectangle.portrait.and.arrow.right'
				}
		] satisfies readonly (ToolbarAction | boolean)[],
		action => action !== false
	)
}
