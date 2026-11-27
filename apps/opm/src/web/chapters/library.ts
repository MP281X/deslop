import {Command, Component, Router, Subscription} from '@effect/ui'
import {Html, HtmlSubscription} from '@effect/ui/html'

import {Array, Boolean, DateTime, Effect, Function, HashMap, HashSet, Layer, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult, AtomRegistry} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {signInUrl} from '@deslop/runtime/shared/auth'
import {dayOf} from '@deslop/runtime/shared/format'
import {ActionShell} from '@deslop/ui/app-shell'
import type {ShellAction} from '@deslop/ui/app-shell'
import {Loading, Notice, Placeholder, Row} from '@deslop/ui/axis'
import {Button, PressFeedback} from '@deslop/ui/control'
import {Glass, GlassPanel} from '@deslop/ui/glass'
import {Split, singlePane, watchPanes} from '@deslop/ui/split'
import {observe} from '@deslop/ui/state'
import {SymbolIcon} from '@deslop/ui/symbol'

import {SERIES_NAMES, keyOf, Series} from '#contracts'
import type {ReadingChapter, ChapterList} from '#contracts'

import {RowPlaceholder, readProblem, signOutForm} from '#web/axis.ts'
import {chaptersAtom, unsavedAtom} from '#web/chapters/catalogue.ts'
import {Message, Model, OpmCommands, Refresh, Save, SetBars, SignIn, SignOut} from '#web/chapters/model.ts'
import type {Reader} from '#web/chapters/model.ts'
import {chapterOpens, registerPush} from '#web/chapters/push.ts'
import {Reading, chapterView, pageActions} from '#web/chapters/reader.ts'
import {savedPage, turnPage, withUnsaved} from '#web/chapters/reading.ts'
import {accountAtom, native} from '#web/platform.ts'
import {OpmRoute, hasListBehind, libraryOf, targetOf, usedHistoryMotion} from '#web/routes.ts'

const SERIES_MENU = 'opm-series'
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
		className: pipe(chapter.reading, Option.exists(reading => reading.done), Boolean.match({onFalse: Function.constant('opm-row'), onTrue: Function.constant('opm-row opm-row-read')})),
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
	return GlassPanel(h, SERIES_MENU, 'Series', [
		...Array.map(seriesChoices(series), item =>
			Button(h)
				.key(item.id)
				.attrs({'aria-checked': `${item.checked}`, role: 'menuitemradio'})
				.on('click', item.message)
				.children(item.title, item.checked && SymbolIcon(h, 'checkmark'))
		),
		Option.exists(AsyncResult.value(model.account), account => account.signOut) && signOutForm(h, location.href)
	])
		.attr('role', 'menu')
		.popover('auto', model.menu)
		.on('toggle', event => {
			if (!event.open) return Message.CloseMenu()
			return undefined
		})
}

function actions(model: Model, series: Series, reading: ReturnType<typeof chapterView>) {
	const controls: readonly (ShellAction<Message> | false)[] = [
		{
			id: 'series',
			menu: [{items: seriesChoices(series), title: ''}],
			message: Message.Menu(),
			symbol: 'books.vertical',
			title: 'Series'
		},
		...pageActions(reading),
		model.reader !== undefined &&
			!model.narrow && {
				id: 'sidebar',
				message: Message.Sidebar(),
				pressed: !model.listHidden,
				symbol: 'sidebar.left',
				title: 'Sidebar'
			},
		AsyncResult.isFailure(model.catalogue) && {
			id: 'retry',
			message: Message.Retry(),
			symbol: 'exclamationmark.circle',
			title: 'Out of date. Retry'
		},
		native &&
			Option.exists(AsyncResult.value(model.account), account => account.signOut) && {
				disabled: model.busy,
				id: 'sign-out',
				message: Message.SignOut(),
				symbol: 'rectangle.portrait.and.arrow.right',
				title: 'Sign out'
			}
	]
	return Array.filter(controls, action => action !== false)
}

function listSkeleton(h: H) {
	return Loading(
		h,
		'Loading chapters',
		Array.makeBy(18, index =>
			RowPlaceholder(h, {
				className: 'opm-row',
				id: `chapter-placeholder-${index}`,
				leading: Placeholder(h, 'opm-cover'),
				line: Placeholder(h, 'opm-line-placeholder'),
				title: Placeholder(h, 'opm-title-placeholder'),
				value: Placeholder(h, 'opm-date-placeholder')
			})
		)
	)
}

function library(h: H, model: Model, chapters: ChapterList, series: Series, waiting: boolean) {
	const rows = Array.filter(chapters, chapter => chapter.series === series)
	return h.div
		.class('opm-chapters')
		.children(
			waiting
				? listSkeleton(h)
				: Array.match(rows, {
						onEmpty: () => Notice(h, 'No chapters'),
						onNonEmpty: available => Array.map(available, chapter => row(h, chapter, model))
					})
		)
}

function access(h: H, model: Model) {
	const problem = readProblem(model.account, model.catalogue)
	if (Option.isNone(problem)) return undefined
	if (needsSignInCause(problem.value)) {
		if (model.busy) return Notice(h, 'Signing in…')
		const text = model.authProblem ?? 'Sign in to read chapters'
		if (native) return Notice(h, text, Message.SignIn(), 'Sign in')
		return h.div
			.class('axis-notice')
			.attr('role', 'status')
			.children(
				h.p.children(text),
				Glass(h).children(h.a.attrs({'data-pressable': '', href: signInUrl(location.href)}).children('Sign in'))
			)
	}
	if (isDeniedCause(problem.value)) return Notice(h, 'Access denied')
	return Notice(h, 'Couldn’t load chapters', Message.Retry())
}

function workspace(h: H, model: Model) {
	const gate = access(h, model)
	if (gate !== undefined) return h.div.class('opm-gate').children(gate)
	const series = libraryOf(model.route).search.series ?? 'manga'
	const target = targetOf(model.route)
	const admitted = Option.isSome(AsyncResult.value(model.account))
	const waiting = !admitted || AsyncResult.isInitial(model.catalogue)
	const chapters = chaptersOf(model)
	const reading = target === undefined || !admitted ? undefined : chapterView(model, target, chapters)
	return ActionShell(h, {
		actions: actions(model, series, reading),
		content: Split(h, {
			detail: {
				content: target !== undefined && Reading(h, model, target, reading, waiting || model.reader?.expired === false),
				key: target === undefined ? 'reader' : keyOf(target),
				label: 'Reader'
			},
			list: {content: library(h, model, chapters, series, waiting), label: SERIES_NAMES[series]},
			listHidden: model.listHidden,
			narrow: model.narrow,
			show: target === undefined ? 'list' : 'detail'
		}),
		overlays: !native && seriesMenu(h, model, series),
		sidebar:
			target === undefined ? undefined : {id: 'back', message: Message.Close(), symbol: 'chevron.left', title: 'Back'}
	})
}

function view(h: H, model: Model) {
	return h.main
		.class('opm axis-controls')
		.onMount(PressFeedback({}))
		.children(
			OpmRoute.isAnyOf(['NotFound'])(model.route)
				? h.div
						.class('opm-gate')
						.children(Glass(h).children(h.a.attrs({'data-pressable': '', href: '/'}).children('Back to chapters')))
				: workspace(h, model)
		)
}

function openedReader() {
	return {
		bars: false,
		expired: false,
		finished: HashSet.empty(),
		inView: Option.none(),
		page: undefined,
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
					observe(accountAtom, account => Message.Account({account}))
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
				native &&
					Subscription.make(
						'activity-links',
						Stream.map(chapterOpens, chapter => Message.Open({chapter}))
					),
				native && signedIn !== undefined && Subscription.make('push-registration', signedIn.id, () => registerPush),
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
				if (hasListBehind()) return $.run(Command.asNoop(Router.Back.make({})))
				return $.run(Command.asNoop(Router.patchSearch(OpmRoute, libraryOf($.model.route), {chapter: undefined})))
			},
			CloseMenu: $ => $.evolve({menu: false}),
			Expired: ($, next) => {
				const target = targetOf($.model.route)
				if ($.model.reader === undefined || target === undefined || keyOf(next.chapter) !== keyOf(target))
					{return $.model}
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
			Move: ($, next) => {
				const target = targetOf($.model.route)
				if (target === undefined || $.model.reader === undefined) return $.model
				const reading = chapterView($.model, target, chaptersOf($.model))
				if (reading === undefined) return $.model
				const position = reading.turn + next.step
				const turn = reading.turns[position]
				if (turn === undefined) return $.model
				// The left page of a final spread counts as read.
				const page = Option.getOrUndefined(
					Boolean.match(position === reading.turns.length - 1, {
						onFalse: () => Array.head(turn),
						onTrue: () => Array.last(turn)
					})
				)
				if (page === undefined) return $.model
				const turned = Option.getOrUndefined(
					turnPage($.model.reader, {following: reading.following, index: page, opened: target.number})
				)
				if (turned === undefined) return $.model
				return $.evolve({reader: {...$.model.reader, ...turned.next, bars: false, page}}).run(
					Command.asNoop(Save.make({updates: turned.saves})),
					Command.asNoop(SetBars.make({visible: false}))
				)
			},
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
			ToggleBars: $ => {
				if ($.model.reader === undefined) return $.model
				const visible = !$.model.reader.bars
				return $.evolve({reader: {...$.model.reader, bars: visible}}).run(Command.asNoop(SetBars.make({visible})))
			},
			Unsaved: ($, next) => $.set(opened({...$.model, unsaved: next.unsaved}))
		},
		view
	}),
	Component.provide(Layer.provideMerge(OpmCommands, AtomRegistry.layer))
)
