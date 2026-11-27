import {Router} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Array, Effect, Function, Layer, Option, Predicate, Schema, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AtomRegistry} from 'effect/reactivity'

import type {Selection} from '@deslop/design/model'
import {Layout, ListDetail, Row, styles, webStyle} from '@deslop/design/web'
import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {returnTarget} from '#contracts'

import {Directory} from '#screens/directory.ts'
import type {Entry, Screen} from '#screens/directory.ts'
import {marks} from '#screens/marks.ts'
import {Admit, RecoverSignIn, Refresh, SignOut, StartSignIn} from '#screens/model.ts'
import {AuthReads} from '#screens/reads.ts'
import {AuthRoute} from '#screens/routes.ts'
import {AVATAR} from '#screens/rows.ts'
import type {Mark} from '#screens/rows.ts'

const control = {...webStyle(styles.control), border: '0', color: styles.title.color, cursor: 'pointer', gap: '8px'}
const markStyle = {flexShrink: '0', height: '20px', objectFit: 'contain', width: '20px'}

function Cover<M>(h: Html.H<M>, mark: Mark) {
	if (mark.kind === 'device') return h.img.style(markStyle).attrs({alt: '', src: marks[mark.device]})
	return h.span
		.attr('aria-hidden', 'true')
		.style({...webStyle(AVATAR), ...webStyle(styles.title)})
		.children(
			mark.initial,
			mark.url !== undefined &&
				h.img
					.style({height: '100%', inset: '0', objectFit: 'cover', position: 'absolute', width: '100%'})
					.attrs({alt: '', referrerpolicy: 'no-referrer', src: mark.url})
		)
}

function Skeleton<M>(h: Html.H<M>, id: string) {
	function bar(width: string, height: string, borderRadius = '4px') {
		return h.span.style({backgroundColor: styles.control.backgroundColor, borderRadius, height, width})
	}
	return h.div
		.key(id)
		.attr('aria-hidden', 'true')
		.style(webStyle(styles.row))
		.children(
			bar('28px', '28px', '50%'),
			h.span.style({...webStyle(styles.lead), gap: '6px'}).children(bar('58%', '12px'), bar('36%', '10px')),
			bar('30px', '8px')
		)
}

function EntryView<M>(
	h: Html.H<M>,
	entry: Entry,
	retry: Screen['retry'],
	activeId?: string,
	select?: Selection['select']
) {
	if (entry.kind === 'skeleton') return Skeleton(h, entry.id)
	if (entry.kind === 'row') {
		const {mark, ...item} = entry.row
		return Row(h, {active: item.id === activeId, cover: Cover(h, mark), item, ...(select !== undefined && {select})})
	}
	return h.div
		.key(entry.text)
		.attr('role', 'status')
		.style({...webStyle(styles.line), padding: '8px 12px'})
		.children(
			entry.text,
			entry.reader !== undefined &&
				retry(h.button.class('design-control').attr('type', 'button'), 'click', entry.reader)
					.style({...control, marginTop: '8px'})
					.children('Retry')
		)
}

function Workspace<M>(h: Html.H<M>, screen: Screen) {
	if (screen.kind === 'directory') {
		return ListDetail(h, {
			defaultId: screen.defaultId,
			detail: Array.map(screen.detail, entry => EntryView(h, entry, screen.retry)),
			detailToolbar: screen.detailToolbar,
			list: (active, wide) => [
				...Array.map(screen.people, entry => EntryView(h, entry, screen.retry, active, screen.selection.select)),
				...(wide ? [] : Array.map(screen.accountNotes, entry => EntryView(h, entry, screen.retry)))
			],
			selection: screen.selection,
			toolbar: screen.toolbar
		})
	}
	if (screen.kind === 'sessions') {
		return Layout(h, {
			content: h.section
				.attr('aria-label', 'Browser sessions')
				.style({...webStyle(styles.rows), overflowY: 'auto'})
				.children(Array.map(screen.detail, entry => EntryView(h, entry, screen.retry))),
			toolbar: screen.toolbar.actions.length > 0 ? screen.toolbar : undefined
		})
	}
	const center = {
		alignItems: 'center',
		display: 'flex',
		flex: '1',
		flexDirection: 'column',
		gap: '8px',
		justifyContent: 'center',
		padding: '20px'
	} as const
	if (screen.kind === 'not-found') {
		return Layout(h, {
			content: h.section
				.style(center)
				.children(screen.back(h.button.class('design-control'), 'click').style(control).children('Back to Auth'))
		})
	}
	return Layout(h, {
		content: h.section.style(center).children(
			screen.state === 'waiting' &&
				h.p.attr('role', 'status').style(webStyle(styles.line)).children('Waiting for an admin'),
			screen.state === 'sign-in' &&
				screen
					.signIn(h.button.class('design-control'), 'click')
					.attr('disabled', screen.signingIn ? '' : undefined)
					.style(control)
					.children(h.img.style(markStyle).attrs({alt: '', src: marks.github}), 'Continue with GitHub'),
			screen.error !== undefined && h.p.attr('role', 'alert').style(webStyle(styles.line)).children(screen.error),
			...Array.map(screen.entries, entry => EntryView(h, entry, screen.retry))
		),
		toolbar: screen.toolbar.actions.length > 0 ? screen.toolbar : undefined
	})
}

const App = Html.component({
	message: Schema.Never,
	model: Schema.Null,
	name: 'Auth',
	props: Schema.Struct({route: AuthRoute})
}).make({
	init: Function.constNull,
	update: Function.constNull,
	view: h => Directory(h, {native: false, route: h.props.route}, screen => Workspace(h, screen))
})

const layerReads = AuthReads.layer(layerPageProtocol, account => {
	if (account.role === 'Waiting') return
	pipe(
		Option.fromNullishOr(new URL(location.href).searchParams.get('next')),
		Option.flatMap(next => returnTarget(next, location.origin, location.protocol === 'http:')),
		Option.map(target => location.assign(target))
	)
})
const layerActions = Layer.mergeAll(
	StartSignIn.toLayer(args =>
		Effect.sync(() => {
			location.assign(`/sign-in?${new URLSearchParams({next: args.next ?? location.origin})}`)
			return false
		})
	),
	RecoverSignIn.toLayer(() => Effect.sync(() => location.replace(signInUrl(location.href)))),
	SignOut.toLayer(
		Effect.map(
			HttpClient.HttpClient,
			client => () =>
				pipe(
					client.post(new URL('/sign-out', location.origin)),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.mapError(cause =>
						AuthError.make({cause, error: 'temporarily_unavailable', message: 'Couldn’t sign out'})
					),
					Effect.tap(() => Effect.sync(() => location.replace('/'))),
					Effect.asVoid
				)
		)
	)
)
const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')
addPageTelemetry('@deslop/auth')

pipe(
	BrowserHost.mount(App, Router.props(AuthRoute), root),
	Layer.provide(Layer.mergeAll(Admit.layer, Refresh.layer, layerActions, Router.Back.layer)),
	Layer.provide(
		Layer.mergeAll(AtomRegistry.layer, layerReads, FetchHttpClient.layer, BrowserRouter.layer({routes: AuthRoute}))
	),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
