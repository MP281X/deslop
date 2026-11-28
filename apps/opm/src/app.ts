import {Command, Component, Router, Subscription, UiSchema} from '@effect/ui'
import type {Mount} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, HashMap, HashSet, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {chooseToolbar} from '@deslop/components/model'
import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {
	Refresh,
	endSignOut,
	goBack,
	openItem,
	selection,
	shellApp,
	signOutNotice,
	signOutState,
	slide,
	startSignOut
} from '@deslop/runtime/client/shell'
import type {AppScreen} from '@deslop/runtime/client/shell'
import {Account} from '@deslop/runtime/shared/schema'
import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {OpmRoute, Save, libraryOf, observeOpm, readOpm, registerChapters, targetOf} from './reads.ts'

import {Series, keyOf} from '#chapters/contract.ts'
import {
	bookOf,
	chapterOf,
	chapterView,
	chaptersFields,
	chaptersMessages,
	chaptersScreen,
	openedReader,
	opened,
	wideOf
} from '#chapters/screen.ts'
import type {Direction} from '#chapters/screen.ts'
import {pageAspect, turnPage} from '#chapters/shared.ts'

const SCROLL = {scroll: false} as const
// A press keeps its pointer, so the swipe ends on the reader wherever it goes.
const CAPTURE: Html.PointerDownOptions = {capturePointer: true}

const AccountRead = AsyncResult.Schema({error: Schema.Unknown, success: Account})

// The screen's model and messages: the chapters' part, and the page's own. The shell owns the clock and the sign-in.
type Model = typeof Model.Type
const Model = Schema.Struct({
	...chaptersFields,
	account: AccountRead,
	hasListBehind: Schema.Boolean,
	height: Schema.Finite,
	listHidden: Schema.Boolean,
	route: OpmRoute,
	width: Schema.Finite,
	...signOutState.fields
})

const Message = UiSchema.TaggedEnum({
	...chaptersMessages,
	Account: {result: AccountRead},
	Back: {},
	Chosen: {id: Schema.String},
	Layout: {height: Schema.Finite, width: Schema.Finite},
	Route: {route: OpmRoute},
	Select: {id: Schema.String},
	SignedOut: signOutState.signedOut
})

type Message = typeof Message.Type
type Step = Component.Step<Model, Message, never, Save>

const HOME = OpmRoute.Library({params: {}, search: {}})

function isChapter(route: OpmRoute) {
	return targetOf(route) !== undefined
}

// The pointer a press reports: its button, its place and which pointer made it.
type Press = typeof Press.Type
const Press = Schema.Struct({
	button: Schema.optional(Schema.Finite),
	pointerId: Schema.Int,
	x: Schema.Finite,
	y: Schema.Finite
})

type Swipe = typeof Swipe.Type
const Swipe = Schema.Struct({dx: Schema.Finite, dy: Schema.Finite})

type Dimensions = typeof Dimensions.Type
// What a native picture reports once it loads: the size of its source.
const Dimensions = Schema.Struct({source: Schema.Struct({height: Schema.Finite, width: Schema.Finite})})

type Layout = typeof Layout.Type
const Layout = Schema.Struct({layout: Schema.Struct({height: Schema.Finite, width: Schema.Finite})})

// A press the reader follows: where a pointer went down, came up or was lost, but only a main-button press starts one.
function pointerMessage(event: string, press: Press) {
	const place = {pointerId: press.pointerId, x: press.x, y: press.y}
	if (event === 'pointercancel') return Message.PointerCancel({pointerId: press.pointerId})
	if (event === 'pointerup') return Message.PointerUp(place)
	if (press.button === 0) return Message.PointerDown(place)
	return undefined
}

function movePage($: Step, direction: Direction) {
	const target = targetOf($.model.route)
	if (target === undefined || $.model.reader === undefined) return $
	const reading = chapterView($.model, target)
	if (reading === undefined) return $
	const position = reading.turn + direction
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

function gesture($: Step, dx: number, dy: number) {
	if ($.model.reader === undefined) return $
	if (Math.abs(dx) >= 36 && Math.abs(dx) > Math.abs(dy)) {
		return movePage($, Boolean.match(dx > 0, {onFalse: Function.constant(-1), onTrue: Function.constant(1)}))
	}
	if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return $.evolve({reader: {...$.model.reader, bars: !$.model.reader.bars}})
	return $
}

// The choices in the series menu and the toolbar.
function choose($: Step, id: string) {
	if (Schema.is(Series)(id)) {
		const route = libraryOf($.model.route)
		if (id === (route.search.series ?? 'manga')) return $.model
		return $.run(Command.asNoop(Router.patchSearch(OpmRoute, route, {chapter: undefined, series: id}, SCROLL)))
	}
	if (id === 'back') return $.run(goBack($.model, HOME, {chapter: undefined}))
	if (id === 'sidebar') return $.evolve({listHidden: !$.model.listHidden}).viewTransition(['design-layout'])
	if (id === 'next-page') return movePage($, 1)
	if (id === 'previous-page') return movePage($, -1)
	if (id === 'retry') return $.run(Command.asNoop(Refresh.make({authenticated: false})))
	if (id === 'sign-out') return startSignOut($, outcome => Message.SignedOut(outcome))
	return $.model
}

const Screen = Component.define({
	message: Message,
	model: Model,
	name: 'Opm',
	props: Schema.Struct({now: DateTimeUtcFromFiniteMillis, route: OpmRoute, signIns: Schema.optionalKey(Schema.Int)}),
	restore: false
}).make({
	init: $ => ({
		account: AsyncResult.initial(),
		catalogue: AsyncResult.initial(),
		covers: HashSet.empty(),
		failed: HashSet.empty(),
		hasListBehind: false,
		height: 0,
		listHidden: false,
		reader: Boolean.match(targetOf($.props.route) === undefined, {
			onFalse: openedReader,
			onTrue: Function.constUndefined
		}),
		route: $.props.route,
		shapes: HashMap.empty(),
		unsaved: HashMap.empty(),
		width: 0,
		...signOutState.init
	}),
	parts: (p, model) => {
		const viewer = AsyncResult.value(model.account)
		const target = targetOf(model.route)
		const failed = Option.isSome(blockingFailure(model.account)) || Option.isSome(blockingFailure(model.catalogue))
		return {
			...chaptersScreen(model, p.props.now, Option.isSome(viewer)),
			busy: model.signingOut,
			choose: p.part(chooseToolbar<Message>(Message.Chosen)),
			failed,
			gesture: p.part((el, event: string) =>
				el.on(event, payload => {
					if (event === 'press') return Message.Gesture({dx: 0, dy: 0})
					return pipe(
						Schema.decodeUnknownOption(Swipe)(payload),
						Option.map(swipe => Message.Gesture(swipe)),
						Option.getOrUndefined
					)
				})
			),
			pointer: p.part((el, event: string) =>
				el.on(
					event,
					payload =>
						pipe(
							Schema.decodeUnknownOption(Press)(payload),
							Option.flatMap(press => Option.fromUndefinedOr(pointerMessage(event, press))),
							Option.getOrUndefined
						),
					Boolean.match(event === 'pointerdown', {onFalse: Function.constUndefined, onTrue: Function.constant(CAPTURE)})
				)
			),
			reads: [model.account, model.catalogue],
			resize: p.part((el, event: string) =>
				el.on(event, payload =>
					pipe(
						Schema.decodeUnknownOption(Layout)(payload),
						Option.map(found => Message.Layout(found.layout)),
						Option.getOrUndefined
					)
				)
			),
			retryPage: p.part((el, event: string, src: string) => el.on(event, Message.RetryPage({src}))),
			// A chapters read that failed is what the page shows, before a route it does not answer.
			routeMissing: OpmRoute.isAnyOf(['NotFound'])(model.route) && !failed,
			selection: selection(p, {
				back: Message.Back(),
				id: Option.getOrUndefined(Option.map(Option.fromUndefinedOr(target), keyOf)),
				open: target !== undefined,
				select: id => Message.Select({id})
			}),
			settle: p.part((el, event: string, src: string) => el.on(event, Message.CoverSettled({src}))),
			shape: p.part((el, event: string, src: string) =>
				el.on(event, payload => {
					if (event === 'error') return Message.Image({aspect: 0, src})
					return pipe(
						Schema.decodeUnknownOption(Dimensions)(payload),
						Option.map(size => Message.Image({aspect: pageAspect(size.source.width, size.source.height), src})),
						Option.getOrUndefined
					)
				})
			),
			signOut: Option.exists(viewer, account => account.signOut),
			signOutProblem: signOutNotice(model, p.props.signIns),
			watch: p.part((el, mount: Mount.Issued<Message, never, unknown, never>) => el.onMount(mount))
		}
	},
	subscriptions: state => {
		const target = targetOf(state.model.route)
		const signedIn = Option.getOrUndefined(AsyncResult.value(state.model.account))
		return [
			Router.subscription(OpmRoute, state.model.route, route => Message.Route({route})),
			Subscription.make(
				'account',
				readOpm(
					reads => reads.account,
					result => Message.Account({result})
				)
			),
			Subscription.make(
				'catalogue',
				readOpm(
					reads => reads.chaptersAtom,
					catalogue => Message.Catalogue({catalogue})
				)
			),
			Subscription.make(
				'unsaved',
				observeOpm(
					reads => reads.unsavedAtom,
					unsaved => Message.Unsaved({unsaved})
				)
			),
			signedIn !== undefined && Subscription.make('push-registration', signedIn.id, () => registerChapters),
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
		Account: ($, next) => $.evolve({account: next.result}),
		Back: $ => $.run(goBack($.model, HOME, {chapter: undefined})),
		Catalogue: ($, next) => $.set(opened({...$.model, catalogue: next.catalogue})),
		Chosen: ($, next) => choose($, next.id),
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
					hasListBehind: target !== undefined && (previous === undefined || $.model.hasListBehind),
					listHidden: target !== undefined && $.model.listHidden,
					reader: Boolean.match(target === undefined, {onFalse: openedReader, onTrue: Function.constUndefined}),
					route: next.route
				})
			)
			if (previous !== undefined && target !== undefined) return result.viewTransition(['design-layout'])
			return slide(result, isChapter, $.model.route, next.route)
		},
		Select: ($, next) => {
			if (!OpmRoute.isAnyOf(['Library'])($.model.route)) return $.model
			return Option.match(chapterOf($.model, next.id), {
				onNone: () => $.model,
				onSome: chapter => $.run(openItem($.model.route, isChapter, {chapter: chapter.number, series: chapter.series}))
			})
		},
		SignedOut: ($, message) => endSignOut($, message, $.props.signIns),
		Unsaved: ($, next) => $.set(opened({...$.model, unsaved: next.unsaved}))
	}
})

export type OpmScreen = AppScreen<Component.Headless.Parts<typeof Screen>>

export const OpmApp = shellApp({
	every: '1 minute',
	missing: 'Back to chapters',
	name: 'OPM',
	props: Schema.Struct({route: OpmRoute}),
	screen: Screen
})

// The page measures its own size, which decides how many panes it draws.
export function resized(size: {readonly height: number; readonly width: number}) {
	return Message.Layout(size)
}

// A page's picture reports its shape once it loads, or none when it failed.
export function imaged(src: string, aspect: number) {
	return Message.Image({aspect, src})
}
