import {Command, Router, Subscription} from '@effect/ui'
import {Html} from '@effect/ui/html'

import {Array, Boolean, Cause, DateTime, Effect, Function, HashMap, HashSet, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/shared/auth'
import {dayOf} from '@deslop/runtime/shared/format'
import {AppShell} from '@deslop/ui/app-shell'
import {Button} from '@deslop/ui/control'
import {GlassPanel, SidebarControl} from '@deslop/ui/glass'
import {observe} from '@deslop/ui/state'

import {SERIES_NAMES, keyOf, Series} from '#contracts'
import type {ReadingChapter, ChapterList} from '#contracts'

import {chaptersAtom, unsavedAtom} from '#web/chapters/catalogue.ts'
import {Message, Model, Refresh, Save, SetBars, SignIn, SignOut} from '#web/chapters/model.ts'
import type {Reader} from '#web/chapters/model.ts'
import {chapterOpens, registerPush} from '#web/chapters/push.ts'
import {PageControls, Reading, chapterView} from '#web/chapters/reader.ts'
import {savedPage, turnPage, withUnsaved} from '#web/chapters/reading.ts'
import {OpmRoute, libraryOf, targetOf} from '#web/routes.ts'
import {accountAtom, native} from '#web/session.ts'

const LIBRARY_MENU = 'opm-library-menu'
const SPREAD_MEDIA = matchMedia('(horizontal-viewport-segments: 2), (min-width: 700px) and (orientation: landscape)')

type H = Html.H<Message>

type NoticeAction = typeof NoticeAction.Type
const NoticeAction = Schema.Literals(['Retry', 'Sign in'])

const ToggleLibraryMenu = Command.make('Opm/ToggleLibraryMenu', {args: {}}, () =>
	Effect.sync(() => {
		const source = document.querySelector<HTMLButtonElement>('.opm-menu-toggle')
		if (source === null) return
		document.getElementById(LIBRARY_MENU)?.togglePopover({source})
	})
)

function chaptersOf(model: Model) {
	return Option.match(AsyncResult.value(model.catalogue), {
		onNone: () => Array.empty<ReadingChapter>(),
		onSome: all => withUnsaved(all, model.unsaved)
	})
}

function statusAction(h: H, action?: NoticeAction) {
	if (action === 'Retry') {
		return Button(h, {})
			.on('click', () => Message.Retry())
			.children(action)
	}
	if (action !== 'Sign in') return undefined
	if (native) {
		return Button(h, {})
			.on('click', () => Message.SignIn())
			.children(action)
	}
	return h.a.attr('href', signInUrl(location.href)).children(action)
}

function notice(h: H, text: string, action?: NoticeAction) {
	return h.div.class('opm-notice').attr('role', 'status').children(h.p.children(text), statusAction(h, action))
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

function row(h: H, chapter: ReadingChapter, now: DateTime.Utc) {
	const src = chapter.pages[0]
	return Button(h, {})
		.key(keyOf(chapter))
		.class('axis-row opm-row')
		.attr(
			'data-read',
			Option.getOrUndefined(
				pipe(
					chapter.reading,
					Option.filter(reading => reading.done),
					Option.map(Function.constant('true'))
				)
			)
		)
		.on('click', () => Message.Open({chapter: {number: chapter.number, series: chapter.series}}))
		.children(
			h.span
				.class('opm-cover')
				.attr('aria-hidden', 'true')
				.children(src !== undefined && h.img.attrs({alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src})),
			h.span
				.class('opm-row-copy')
				.children(
					h.span.class('axis-title').children(`Chapter ${chapter.number}`),
					h.span.class('axis-muted').children(progressOf(chapter))
				),
			h.span.class('axis-value').children(
				Option.match(chapter.postedAt, {
					onNone: Function.constant(''),
					onSome: at => {
						if (DateTime.toDate(at).toDateString() === DateTime.toDate(now).toDateString()) return 'Today'
						return dayOf(at, now)
					}
				})
			)
		)
}

function signOutControl(h: H, busy: boolean) {
	if (native) {
		return Button(h, {disabled: busy})
			.attrs({popovertarget: LIBRARY_MENU, popovertargetaction: 'hide'})
			.on('click', () => Message.SignOut())
			.children('Sign out')
	}
	return h.form
		.attrs({action: '/auth/sign-out', method: 'post'})
		.children(Button(h, {type: 'submit'}).children('Sign out'))
}

function library(h: H, model: Model, chapters: ChapterList) {
	const series = libraryOf(model.route).search.series ?? 'manga'
	const rows = Array.filter(chapters, chapter => chapter.series === series)
	return h.section
		.class('opm-library')
		.attrs({
			'aria-label': SERIES_NAMES[series],
			hidden: Boolean.match(model.reader === undefined, {
				onFalse: Function.constant(''),
				onTrue: Function.constUndefined
			})
		})
		.children(
			model.reader === undefined &&
				GlassPanel(h, LIBRARY_MENU, 'Library', [
					h.div.class('opm-menu').children(
						Array.map(Series.literals, choice =>
							Button(h, {pressed: choice === series})
								.key(choice)
								.attrs({popovertarget: LIBRARY_MENU, popovertargetaction: 'hide'})
								.on('click', () => Message.Series({series: choice}))
								.children(SERIES_NAMES[choice])
						),
						Option.exists(AsyncResult.value(model.account), account => account.signOut) && signOutControl(h, model.busy)
					)
				]).on('toggle', event => Message.MenuChanged({open: event.newState === 'open'})),
			Array.match(rows, {
				onEmpty: () =>
					notice(
						h,
						Boolean.match(AsyncResult.isInitial(model.catalogue), {
							onFalse: Function.constant('No chapters'),
							onTrue: Function.constant('Loading chapters…')
						})
					),
				onNonEmpty: available =>
					h.div.class('opm-chapters').children(Array.map(available, chapter => row(h, chapter, model.now)))
			})
		)
}

function accessStatus(busy: boolean, signIn: boolean) {
	if (busy) return 'Signing in…'
	if (signIn) return 'Sign in to read chapters'
	return 'Access denied'
}

function view(h: H, model: Model) {
	const problem = blockingFailure(model.catalogue)
	const accountError = Option.getOrUndefined(AsyncResult.error(model.account))
	const denial = Boolean.match(isDenied(accountError), {
		onFalse: () => Option.getOrUndefined(Option.map(problem, Cause.squash)),
		onTrue: () => accountError
	})
	if (isDenied(denial)) {
		const signIn = needsSignIn(denial)
		return h.main
			.class('opm')
			.children(
				notice(
					h,
					model.authProblem ?? accessStatus(model.busy, signIn),
					Boolean.match(signIn && !model.busy, {onFalse: Function.constUndefined, onTrue: Function.constant('Sign in')})
				)
			)
	}
	if (Option.isSome(problem) || (accountError !== undefined && Option.isNone(AsyncResult.value(model.catalogue)))) {
		return h.main.class('opm').children(notice(h, 'Couldn’t load chapters', 'Retry'))
	}
	if (Option.isNone(AsyncResult.value(model.account))) {
		return h.main.class('opm').children(notice(h, 'Loading chapters…'))
	}
	if (OpmRoute.isAnyOf(['NotFound'])(model.route)) {
		return h.main.class('opm').children(h.a.class('opm-notice').attr('href', '/').children('Back to chapters'))
	}
	const chapters = chaptersOf(model)
	const target = targetOf(model.route)
	if (target === undefined) {
		return h.main.class('opm').children(
			AppShell(h, {
				actions: Boolean.match(AsyncResult.isFailure(model.catalogue), {
					onFalse: Function.constUndefined,
					onTrue: () =>
						Button(h, {})
							.attrs({'aria-label': 'Out of date. Retry', title: 'Out of date'})
							.on('click', () => Message.Retry())
							.children(h.span.class('axis-dot'))
				}),
				content: library(h, model, chapters),
				sidebar: SidebarControl(h, model.menu, Message.Menu(), 'opm-menu-toggle')
			})
		)
	}
	const reading = chapterView(model, target, chapters)
	return h.main
		.class('opm')
		.children(
			AppShell(h, {
				actions: PageControls(h, reading),
				content: [library(h, model, chapters), Reading(h, model, target, reading, model.reader?.expired === false)],
				sidebar: SidebarControl(h, false, Message.Close())
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

export const Opm = OpmDef.make({
	init: $ => {
		const target = targetOf($.props.route)
		const state = $.set({
			account: AsyncResult.initial(),
			authProblem: undefined,
			busy: false,
			catalogue: AsyncResult.initial(),
			failed: HashSet.empty(),
			menu: false,
			now: DateTime.nowUnsafe(),
			reader: Boolean.match(target === undefined, {onFalse: openedReader, onTrue: Function.constUndefined}),
			route: $.props.route,
			spread: SPREAD_MEDIA.matches,
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
			Subscription.make(
				'posture',
				Stream.map(Stream.fromEventListener<MediaQueryListEvent>(SPREAD_MEDIA, 'change'), event =>
					Message.Spread({spread: event.matches})
				)
			),
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
		Close: $ => $.run(Command.asNoop(Router.patchSearch(OpmRoute, libraryOf($.model.route), {chapter: undefined}))),
		Expired: ($, next) => {
			const target = targetOf($.model.route)
			if ($.model.reader === undefined || target === undefined || keyOf(next.chapter) !== keyOf(target)) return $.model
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
		Menu: $ => $.run(Command.asNoop(ToggleLibraryMenu.make({}))),
		MenuChanged: ($, next) => $.evolve({menu: next.open}),
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
		Retry: $ => $.run(Command.asNoop(Refresh.make({}))),
		RetryPage: ($, next) => $.evolve({failed: HashSet.remove($.model.failed, next.src)}),
		Route: ($, next) => {
			const previous = targetOf($.model.route)
			const target = targetOf(next.route)
			if (previous !== undefined && target !== undefined && keyOf(previous) === keyOf(target)) {
				return $.evolve({route: next.route})
			}
			const reader = Boolean.match(target === undefined, {onFalse: openedReader, onTrue: Function.constUndefined})
			return $.set(opened({...$.model, menu: false, reader, route: next.route})).run(
				Command.asNoop(SetBars.make({visible: reader === undefined}))
			)
		},
		Series: ($, next) =>
			$.evolve({menu: false}).run(
				Command.asNoop(
					Router.patchSearch(OpmRoute, libraryOf($.model.route), {chapter: undefined, series: next.series})
				)
			),
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
})
