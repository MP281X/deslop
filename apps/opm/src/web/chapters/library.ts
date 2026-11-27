import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html, HtmlSubscription} from '@effect/ui/html'

import {Array, Boolean, DateTime, Effect, Function, HashMap, HashSet, Layer, Option, Schema, Stream, pipe} from 'effect'
import type {Cause} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {signInUrl} from '@deslop/runtime/shared/auth'
import {dayOf} from '@deslop/runtime/shared/format'
import {ActionShell, CheckedChoice} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Loading, Notice, Row} from '@deslop/ui/axis'
import {PressFeedback} from '@deslop/ui/control'
import {Glass, GlassPanel} from '@deslop/ui/glass'
import {isNative, sessionAccount} from '@deslop/ui/native'
import {WebSignOut} from '@deslop/ui/session'
import {Split, singlePane, watchPanes} from '@deslop/ui/split'
import {ReadCombined, observe} from '@deslop/ui/state'
import {hasHistoryBehind, historyBack, usedHistoryMotion} from '@deslop/ui/viewport'

import {SERIES_NAMES, Series, keyOf} from '#contracts'
import type {ReadingChapter} from '#contracts'

import {chaptersAtom, unsavedAtom} from '#web/chapters/catalogue.ts'
import {Message, Model, OpmCommands, Refresh, Save, SetBars, SignIn, SignOut} from '#web/chapters/model.ts'
import type {Reader, Step} from '#web/chapters/model.ts'
import {chapterOpens, registerPush} from '#web/chapters/push.ts'
import {Reading, chapterView, pageActions} from '#web/chapters/reader.ts'
import {savedPage, turnPage, withUnsaved} from '#web/chapters/reading.ts'
import {OpmRoute, libraryOf, targetOf} from '#web/routes.ts'

const SPREAD_QUERY = '(horizontal-viewport-segments: 2), (min-width: 700px) and (orientation: landscape)'

type H = Html.H<Message>

function chaptersOf(model: Model) {
	return Option.match(AsyncResult.value(model.catalogue), {
		onNone: () => Array.empty<ReadingChapter>(),
		onSome: all => withUnsaved(all, model.unsaved)
	})
}

function progressOf(chapter: ReadingChapter) {
	return pipe(
		chapter.reading,
		Option.filter(reading => reading.page > 0 && !reading.done),
		Option.match({
			onNone: () => `Page 1 of ${chapter.pages.length}`,
			onSome: reading => `Saved place · p. ${reading.page + 1}`
		})
	)
}

function row(h: H, chapter: ReadingChapter, model: Model) {
	const src = chapter.pages[0]
	const id = keyOf(chapter)
	const current = Option.getOrUndefined(model.reader?.inView ?? Option.none()) ?? targetOf(model.route)?.number
	return Row(h, {
		className: pipe(
			chapter.reading,
			Option.exists(reading => reading.done),
			Boolean.match({onFalse: Function.constant('opm-row'), onTrue: Function.constant('opm-row opm-row-read')})
		),
		current: !model.narrow && !model.listHidden && chapter.number === current,
		id,
		leading: h.span
			.class('opm-cover')
			.attr('aria-hidden', 'true')
			.children(src !== undefined && h.img.attrs({alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src})),
		line: progressOf(chapter),
		open: Message.Open({chapter: {number: chapter.number, series: chapter.series}}),
		title: `Chapter ${chapter.number}`,
		value: Option.match(chapter.postedAt, {
			onNone: Function.constant(''),
			onSome: at => {
				if (DateTime.toDate(at).toDateString() === DateTime.toDate(model.now).toDateString()) return 'Today'
				return dayOf(at, model.now)
			}
		})
	})
}

function seriesChoices(series: Series) {
	return Array.map(Series.literals, choice => ({
		checked: choice === series,
		id: choice,
		message: Message.Series({series: choice}),
		title: SERIES_NAMES[choice]
	}))
}

function seriesMenu(h: H, model: Model, series: Series) {
	return GlassPanel(h, 'opm-series', 'Series', [
		...Array.map(seriesChoices(series), item => CheckedChoice(h, item)),
		Option.exists(AsyncResult.value(model.account), account => account.signOut) && WebSignOut(h)
	])
		.attr('role', 'menu')
		.popover('auto', model.menu)
		.on('toggle', event => {
			if (!event.open) return Message.CloseMenu()
			return undefined
		})
}

function actions(model: Model, series: Series, reading: ReturnType<typeof chapterView>) {
	return Array.filter(
		[
			{
				id: 'series',
				menu: [{items: seriesChoices(series), title: ''}],
				message: Message.Menu(),
				symbol: 'books.vertical',
				title: 'Series'
			} satisfies ShellAction<Message>,
			...pageActions(reading),
			model.reader !== undefined &&
				!model.narrow &&
				({
					id: 'sidebar',
					message: Message.Sidebar(),
					pressed: !model.listHidden,
					symbol: 'sidebar.left',
					title: 'Sidebar'
				} satisfies ShellAction<Message>),
			AsyncResult.isFailure(model.catalogue) &&
				({
					id: 'retry',
					message: Message.Retry(),
					symbol: 'exclamationmark.circle',
					title: 'Out of date. Retry'
				} satisfies ShellAction<Message>),
			isNative &&
				Option.exists(AsyncResult.value(model.account), account => account.signOut) &&
				({
					disabled: model.busy,
					id: 'sign-out',
					message: Message.SignOut(),
					symbol: 'rectangle.portrait.and.arrow.right',
					title: 'Sign out'
				} satisfies ShellAction<Message>)
		],
		action => action !== false
	)
}

function access(h: H, model: Model, cause: Cause.Cause<unknown>) {
	if (needsSignInCause(cause)) {
		if (model.busy) return Notice(h, 'Signing in…')
		const text = model.authProblem ?? 'Sign in to read chapters'
		if (isNative) return Notice(h, text, Message.SignIn(), 'Sign in')
		return h.div
			.class('axis-notice')
			.attr('role', 'status')
			.children(
				h.p.children(text),
				Glass(h).children(h.a.attrs({'data-pressable': '', href: signInUrl(location.href)}).children('Sign in'))
			)
	}
	if (isDeniedCause(cause)) return Notice(h, 'Access denied')
	return Notice(h, 'Couldn’t load chapters', Message.Retry())
}

function shell(h: H, model: Model, waiting: boolean) {
	const series = libraryOf(model.route).search.series ?? 'manga'
	const target = targetOf(model.route)
	const chapters = chaptersOf(model)
	const reading = pipe(
		Option.fromUndefinedOr(target),
		Option.filter(() => Option.isSome(AsyncResult.value(model.account))),
		Option.flatMap(chapter => Option.fromUndefinedOr(chapterView(model, chapter, chapters))),
		Option.getOrUndefined
	)
	const back = {
		id: 'back',
		message: Message.Close(),
		symbol: 'chevron.left',
		title: 'Back'
	} satisfies ShellAction<Message>
	return ActionShell(h, {
		actions: actions(model, series, reading),
		content: Split(h, {
			detail: {
				content: target !== undefined && Reading(h, model, target, reading, waiting || model.reader?.expired === false),
				key: pipe(Option.fromUndefinedOr(target), Option.map(keyOf), Option.getOrElse(Function.constant('reader'))),
				label: 'Reader'
			},
			list: {
				content: h.div.class('opm-chapters').children(
					Boolean.match(waiting, {
						onFalse: () =>
							pipe(
								chapters,
								Array.filter(chapter => chapter.series === series),
								Array.match({
									onEmpty: () => Notice(h, 'No chapters'),
									onNonEmpty: available => Array.map(available, chapter => row(h, chapter, model))
								})
							),
						onTrue: () => Loading(h, 'Loading chapters', h.div.class('opm-skeleton-list').attr('aria-hidden', 'true'))
					})
				),
				label: SERIES_NAMES[series],
				position: {key: series, ready: !waiting}
			},
			listHidden: model.listHidden,
			narrow: model.narrow,
			show: Boolean.match(target === undefined, {
				onFalse: Function.constant('detail'),
				onTrue: Function.constant('list')
			})
		}),
		overlays: !isNative && seriesMenu(h, model, series),
		...(target !== undefined && {sidebar: back})
	})
}

function workspace(h: H, model: Model) {
	const account = blockingFailure(model.account)
	const failure = pipe(
		account,
		Option.filter(isDeniedCause),
		Option.orElse(() => Option.orElse(blockingFailure(model.catalogue), () => account))
	)
	return ReadCombined({
		failed: cause => h.div.class('opm-gate').children(access(h, model, cause)),
		failure,
		loading: () => shell(h, model, true),
		ready: () => shell(h, model, false),
		value: Option.all([AsyncResult.value(model.account), AsyncResult.value(model.catalogue)])
	})
}

function view(h: H, model: Model) {
	return h.main
		.class('opm axis-controls')
		.onMount(PressFeedback({}))
		.children(
			Boolean.match(OpmRoute.isAnyOf(['NotFound'])(model.route), {
				onFalse: () => workspace(h, model),
				onTrue: () =>
					h.div
						.class('opm-gate')
						.children(Glass(h).children(h.a.attrs({'data-pressable': '', href: '/'}).children('Back to chapters')))
			})
		)
}

function openedReader() {
	return {
		bars: false,
		expired: false,
		finished: HashSet.empty(),
		inView: Option.none(),
		page: undefined,
		press: undefined,
		strip: []
	} satisfies Reader
}

// Freeze the strip and its exact page when the chapter becomes visible, before a fold changes the turn around it.
function opened(model: Model) {
	const target = targetOf(model.route)
	if (target === undefined || model.reader === undefined) return model
	if (model.reader.page !== undefined) return model
	const reading = chapterView(model, target, chaptersOf(model))
	if (reading === undefined) return model
	return {...model, reader: {...model.reader, page: savedPage(reading.shown[0]), strip: reading.shown}}
}

function movePage($: Component.Step<Model, Message, never>, step: Step) {
	const target = targetOf($.model.route)
	if (target === undefined || $.model.reader === undefined) return $
	const reading = chapterView($.model, target, chaptersOf($.model))
	if (reading === undefined) return $
	const position = reading.turn + step
	const turn = reading.turns[position]
	if (turn === undefined) return $
	// The left page of a final spread counts as read.
	const page = Option.getOrUndefined(
		Boolean.match(position === reading.turns.length - 1, {
			onFalse: () => Array.head(turn),
			onTrue: () => Array.last(turn)
		})
	)
	if (page === undefined) return $
	const turned = Option.getOrUndefined(
		turnPage($.model.reader, {following: reading.following, index: page, opened: target.number})
	)
	if (turned === undefined) return $
	return $.evolve({reader: {...$.model.reader, ...turned.next, bars: false, page}}).run(
		Command.asNoop(Save.make({updates: turned.saves})),
		Command.asNoop(SetBars.make({visible: false}))
	)
}

const OpmDef = Html.component({
	message: Message,
	model: Model,
	name: 'Opm',
	props: Schema.Struct({route: OpmRoute}),
	restore: false
})

export const Opm = pipe(
	OpmDef.make({
		init: $ => {
			const target = targetOf($.props.route)
			const state = $.set({
				account: AsyncResult.initial(),
				authProblem: undefined,
				busy: false,
				catalogue: AsyncResult.initial(),
				failed: HashSet.empty(),
				listHidden: false,
				menu: false,
				narrow: singlePane(),
				now: DateTime.nowUnsafe(),
				reader: Boolean.match(target === undefined, {onFalse: openedReader, onTrue: Function.constUndefined}),
				route: $.props.route,
				spread: matchMedia(SPREAD_QUERY).matches,
				unsaved: HashMap.empty(),
				wide: HashSet.empty()
			})
			if (target === undefined) return state
			return state.run(Command.asNoop(SetBars.make({visible: false})))
		},
		subscriptions: state => {
			const target = targetOf(state.model.route)
			const signedIn = Option.getOrUndefined(AsyncResult.value(state.model.account))
			return [
				Router.subscription(OpmRoute, state.model.route, route => Message.Route({route})),
				Subscription.make(
					'account',
					observe(sessionAccount, account => Message.Account({account}))
				),
				Subscription.make(
					'catalogue',
					observe(chaptersAtom, catalogue => Message.Catalogue({catalogue}))
				),
				Subscription.make(
					'unsaved',
					observe(unsavedAtom, unsaved => Message.Unsaved({unsaved}))
				),
				Subscription.make(
					'clock',
					observe(clockAtom('1 minute'), now => Message.Clock({now}))
				),
				...watchPanes(() => Message.Posture({narrow: singlePane()})),
				HtmlSubscription.onMediaQuery(SPREAD_QUERY, spread => Message.Spread({spread})),
				isNative &&
					Subscription.make(
						'activity-links',
						Stream.map(chapterOpens, chapter => Message.Open({chapter}))
					),
				isNative && signedIn !== undefined && Subscription.make('push-registration', signedIn.id, () => registerPush),
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
			Close: $ => {
				if (hasHistoryBehind(previous => previous.pathname === '/' && !previous.searchParams.has('chapter'))) {
					return $.run(historyBack)
				}
				return $.run(Command.asNoop(Router.patchSearch(OpmRoute, libraryOf($.model.route), {chapter: undefined})))
			},
			CloseMenu: $ => $.evolve({menu: false}),
			Expired: ($, next) => {
				const target = targetOf($.model.route)
				if ($.model.reader === undefined || target === undefined || keyOf(next.chapter) !== keyOf(target)) {
					return $.model
				}
				return $.evolve({reader: {...$.model.reader, expired: true}})
			},
			Image: ($, next) =>
				$.evolve({
					failed: Boolean.match(next.failed, {
						onFalse: () => HashSet.remove($.model.failed, next.src),
						onTrue: () => HashSet.add($.model.failed, next.src)
					}),
					wide: Boolean.match(next.wide, {
						onFalse: () => HashSet.remove($.model.wide, next.src),
						onTrue: () => HashSet.add($.model.wide, next.src)
					})
				}),
			Menu: $ => $.evolve({menu: !$.model.menu}),
			Move: ($, next) => movePage($, next.step),
			Open: ($, next) =>
				$.run(
					Command.asNoop(
						Router.patchSearch(
							OpmRoute,
							libraryOf($.model.route),
							{chapter: next.chapter.number, series: next.chapter.series},
							{
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
				const released = {...$.model.reader, press: undefined}
				if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy)) {
					return movePage(
						$.evolve({reader: released}),
						Boolean.match(dx > 0, {onFalse: Function.constant(-1), onTrue: Function.constant(1)})
					)
				}
				if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
					const visible = !released.bars
					return $.evolve({reader: {...released, bars: visible}}).run(Command.asNoop(SetBars.make({visible})))
				}
				return $.evolve({reader: released})
			},
			Posture: ($, next) => {
				if ($.model.narrow === next.narrow) return $.model
				return $.evolve({menu: false, narrow: next.narrow}).viewTransition(['axis-layout'])
			},
			Retry: $ => $.run(Command.asNoop(Refresh.make({}))),
			RetryPage: ($, next) => $.evolve({failed: HashSet.remove($.model.failed, next.src)}),
			Route: ($, next) => {
				const previous = targetOf($.model.route)
				const target = targetOf(next.route)
				if (previous?.number === target?.number && previous?.series === target?.series) {
					return $.evolve({menu: false, route: next.route})
				}
				const reader = Boolean.match(target === undefined, {onFalse: openedReader, onTrue: Function.constUndefined})
				const result = $.set(
					opened({
						...$.model,
						listHidden: target !== undefined && $.model.listHidden,
						menu: false,
						reader,
						route: next.route
					})
				).run(Command.asNoop(SetBars.make({visible: reader === undefined})))
				if (usedHistoryMotion()) return result
				if (!$.model.narrow) return result.viewTransition(['axis-layout'])
				if (target === undefined) return result.viewTransition(['axis-back'])
				return result.viewTransition(['axis-open'])
			},
			Series: ($, next) => {
				const route = libraryOf($.model.route)
				const state = $.evolve({menu: false})
				if (next.series === (route.search.series ?? 'manga')) return state
				return state.run(Command.asNoop(Router.patchSearch(OpmRoute, route, {chapter: undefined, series: next.series})))
			},
			Sidebar: $ => $.evolve({listHidden: !$.model.listHidden, menu: false}).viewTransition(['axis-layout']),
			SignIn: $ => $.evolve({authProblem: undefined, busy: true}).run(SignIn.make({})),
			SignOut: $ => $.evolve({authProblem: undefined, busy: true, menu: false}).run(SignOut.make({})),
			Spread: ($, next) => $.evolve({spread: next.spread}),
			Unsaved: ($, next) => $.set(opened({...$.model, unsaved: next.unsaved}))
		},
		view
	}),
	Component.provide(Layer.provideMerge(OpmCommands, AtomRegistry.layer))
)
