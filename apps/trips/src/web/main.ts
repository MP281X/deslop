import './styles.css'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import {BrowserHost, Html, HtmlFiles} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Layer, Number, Option, Predicate, Queue, Stream, pipe} from 'effect'

import type {PaneLeaf} from '@deslop/components/model'
import {ListDetail, status, styles, webStyle} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {Authenticate, SignOut} from '@deslop/runtime/client/shell'
import {signInUrl} from '@deslop/runtime/shared/auth'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {TripsApp} from '#app'
import {Handset, TripsRoute, layerTrips} from '#reads'
import {Workspace, boardSections, bookingAction, bookingSheet, flightRow} from '#view'
import type {TripsUi} from '#view'

import {FlightsError, IMAGE_BYTES, TicketSource} from '#flights/contract.ts'
import {heroStatus, itineraryContent} from '#itinerary/screen.ts'
import type {Hero} from '#itinerary/shared.ts'

type H = Html.H<never>
type Content = PaneLeaf<View.Input<never>>

const components = webComponents<never>()

const present = Boolean.match({onFalse: Function.constUndefined, onTrue: Function.constant('')})

function control(h: H) {
	return Button(h).class('design-control trips-control').style(webStyle(styles.control))
}

function date(h: H, title: string) {
	return h.p.class('trips-date').style(webStyle(styles.line)).children(title)
}

function figure(h: H, hero: Hero, note?: string) {
	const problem = heroStatus(hero)
	const was = Option.getOrUndefined(hero.was)
	return h.div
		.class('trips-hero')
		.children(
			h.div
				.style(webStyle(styles.titleLine))
				.children(
					problem !== undefined && h.span.style({...webStyle(styles.dot), backgroundColor: status[problem]}),
					h.span.style(webStyle(styles.line)).children(hero.label)
				),
			h.div
				.class('trips-hero-figures')
				.children(
					h.span.class('trips-hero-value').attr('data-pending', present(hero.pending)).children(hero.value),
					was !== undefined && h.s.style(webStyle(styles.line)).children(was),
					h.span.class('trips-hero-time').style(webStyle(styles.line)).children(hero.right)
				),
			note !== undefined && h.div.style(webStyle(styles.line)).children(note)
		)
}

const bookingJpeg = Effect.fnUntraced(function* (file: File) {
	const image = yield* Effect.acquireRelease(
		Effect.tryPromise({
			catch: cause => FlightsError.make({cause, message: 'The booking image could not be read.'}),
			try: () => createImageBitmap(file)
		}),
		bitmap => Effect.sync(() => bitmap.close())
	)
	const size = Number.min(1, 1800 / Number.max(image.width, image.height))
	const canvas = document.createElement('canvas')
	canvas.width = Number.max(1, Number.round(size * image.width, 0))
	canvas.height = Number.max(1, Number.round(size * image.height, 0))
	const context = canvas.getContext('2d')
	if (Predicate.isNull(context)) return yield* FlightsError.make({message: 'The image canvas is not available.'})
	context.fillStyle = '#fff'
	context.fillRect(0, 0, canvas.width, canvas.height)
	context.drawImage(image, 0, 0, canvas.width, canvas.height)
	return yield* Effect.callback<Blob, FlightsError>(resume => {
		canvas.toBlob(
			blob => {
				if (blob === null) resume(Effect.fail(FlightsError.make({message: 'The booking image could not be read.'})))
				else resume(Effect.succeed(blob))
			},
			'image/jpeg',
			0.88
		)
	})
})

const ticketFromFile = Effect.fnUntraced(function* (file: File) {
	if (file.size === 0 || file.size > IMAGE_BYTES) {
		return yield* FlightsError.make({message: 'Choose an image or PDF up to 4 MB.'})
	}
	if (file.type === 'application/pdf') {
		const pdf = yield* Effect.mapError(HtmlFiles.readAsBytes(file), cause =>
			FlightsError.make({cause, message: 'The booking PDF could not be read.'})
		)
		return TicketSource.cases.pdf.make({pdf})
	}
	const image = yield* pipe(
		Effect.scoped(bookingJpeg(file)),
		Effect.flatMap(HtmlFiles.readAsBytes),
		Effect.mapError(cause => FlightsError.make({cause, message: 'The booking image could not be read.'}))
	)
	return yield* Effect.mapError(TicketSource.cases.image.makeEffect({image}), cause =>
		FlightsError.make({cause, message: 'The booking image is too large.'})
	)
})

function readTicket(file: unknown) {
	if (!(file instanceof File)) return Effect.fail(FlightsError.make({message: 'Choose an image or PDF.'}))
	return Effect.asSome(ticketFromFile(file))
}

const clipboard = Stream.callback<unknown>(queue => {
	function paste(event: ClipboardEvent) {
		const file = event.clipboardData?.files.item(0)
		if (Predicate.isNullish(file)) return
		event.preventDefault()
		Queue.offerUnsafe(queue, file)
	}
	return Effect.acquireRelease(
		Effect.sync(() => document.addEventListener('paste', paste)),
		() => Effect.sync(() => document.removeEventListener('paste', paste))
	)
})

const drawing: TripsUi<H, Content, View.Content<never>> = {
	...components,
	banner: (h, banner) =>
		h.div
			.class('trips-notice')
			.children(
				h.p.attr('role', 'status').children(banner.message),
				Boolean.match(banner.back, {
					onFalse: () =>
						banner.action(control(h), 'click').attr('disabled', present(banner.pending)).children(banner.label),
					onTrue: () => h.a.attr('href', '/').children(banner.label)
				})
			),
	board: (h, screen, details) =>
		h.div.children(
			screen.halfStep !== undefined &&
				h.div
					.class('trips-half')
					.children(figure(h, screen.halfStep.hero, Option.getOrUndefined(screen.halfStep.line))),
			h.div
				.class('trips-pass')
				.attr('data-half-step', present(screen.halfStep !== undefined))
				.children(
					h.p.class('trips-context').style(webStyle(styles.line)).children(details.context),
					figure(h, details.hero, details.note),
					...boardSections(h, drawing, screen, details)
				)
		),
	boardSkeleton: h =>
		h.div
			.class('trips-skeleton-board')
			.attrs({'aria-busy': 'true', 'aria-label': 'Loading boarding pass', role: 'status'}),
	booking: (h, screen) => {
		const choose = screen.file(h.input, 'change', value => {
			if (!Predicate.hasProperty(value, 'files') || !Array.isArray(value.files)) return undefined
			return Option.getOrUndefined(Array.head(value.files))
		})
		return bookingSheet<Content>(
			screen,
			[
				h.p.style(webStyle(styles.heading)).children('Paste booking'),
				screen
					.text(h.textarea, 'input')
					.attrs({'aria-label': 'Paste booking text or link', placeholder: 'Paste booking text or link'})
					.value(screen.pastedText),
				screen.error !== undefined && h.p.attr('role', 'alert').children(screen.error),
				h.label
					.class('trips-file-control')
					.style(webStyle(styles.control))
					.children(
						'Choose an image or PDF',
						choose
							.attrs({
								accept: 'image/*,application/pdf',
								'aria-label': 'Choose an image or PDF',
								disabled: present(screen.pending),
								type: 'file'
							})
							.value('')
					)
			],
			[
				screen
					.cancel(control(h), 'click')
					.attrs({disabled: present(screen.pending), type: 'button'})
					.children('Cancel'),
				screen
					.submit(control(h), 'click')
					.attrs({disabled: present(screen.submitDisabled), type: 'button'})
					.children(bookingAction(screen.pending))
			]
		)
	},
	detailGroup: (h, title, rows) => h.div.children(date(h, title), h.div.class('trips-detail-rows').children(rows)),
	detailRows: (h, rows) => h.div.class('trips-detail-rows').children(rows),
	flightTime: (h, was, current) =>
		h.span.class('trips-time').style(webStyle(styles.line)).children(h.s.children(was), current),
	itineraryRows: (h, screen, list, wide, activeId) =>
		h.div.children(
			...itineraryContent<Content>(list, wide, activeId, {
				empty: () =>
					h.div
						.class('trips-notice')
						.children(h.p.children('No upcoming flights'), screen.paste(control(h), 'click').children('Paste booking')),
				group: (title, hero, rows) =>
					h.div.key(title).children(date(h, title), hero !== undefined && figure(h, hero), rows),
				past: row => components.row(h, {active: false, item: row.item, select: screen.past}),
				row: (row, id) => flightRow(h, drawing, screen, row, id)
			})
		),
	missing: (h, message) => h.p.attr('role', 'status').children(message),
	stage: (h, options, report) =>
		h.div
			.style({height: '100%'})
			.children(
				ListDetail<never, never>(h, options),
				report !== undefined && h.p.class('trips-report').attr('role', 'alert').children(report)
			)
}

const App = TripsApp(Html.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// The page opens a link by leaving for it, reads the pasted file itself and ends the session through Auth's own page, so a sign-in leaves the page in the history.
const layerActions = Layer.mergeAll(
	Layer.succeed(Handset, {
		activation: Stream.empty,
		cache: Option.none(),
		notifications: Stream.empty,
		openUrl: url => Effect.sync(() => location.assign(url)),
		paste: clipboard,
		push: Option.none(),
		ticket: readTicket
	}),
	Authenticate.toLayer(() =>
		Effect.sync(() => {
			location.assign(signInUrl(location.href))
			return false
		})
	),
	SignOut.toLayer(() =>
		Effect.sync(() => {
			const form = document.createElement('form')
			form.action = `/auth/sign-out?${new URLSearchParams({next: location.href})}`
			form.method = 'post'
			form.hidden = true
			document.body.append(form)
			form.requestSubmit()
			return true
		})
	)
)

mountPage(TripsRoute, root =>
	Layer.provide(
		BrowserHost.mount(App, Router.props(TripsRoute), root),
		Layer.provideMerge(layerTrips, Layer.merge(layerWebShell('trips', {autoSignIn: false}), layerActions))
	)
)
