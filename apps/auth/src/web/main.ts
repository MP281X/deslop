import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Layer, Option, Predicate, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AtomRegistry} from 'effect/reactivity'

import type {PaneLeaf} from '@deslop/components/model'
import {Layout, ListDetail, Row, styles, webStyle} from '@deslop/components/web'
import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {returnTarget} from '#contracts'

import {Directory, visibleToolbar} from '#screens/directory.ts'
import type {Entry, Screen} from '#screens/directory.ts'
import {marks} from '#screens/marks.ts'
import {Admit, RecoverSignIn, Refresh, SignOut, StartSignIn} from '#screens/model.ts'
import {AuthReads} from '#screens/reads.ts'
import {AuthRoute} from '#screens/routes.ts'
import {AVATAR, Mark} from '#screens/rows.ts'
import {accessOptions, authApp, directoryOptions, renderEntry, rowOptions} from '#screens/view.ts'
import type {RowSelection} from '#screens/view.ts'

const MARK_STYLE = {flexShrink: '0', height: '20px', objectFit: 'contain', width: '20px'}
const control = {...webStyle(styles.control), border: '0', color: styles.title.color, cursor: 'pointer', gap: '8px'}

function Cover<M>(h: Html.H<M>, mark: Mark) {
	if (Mark.isAnyOf(['Device'])(mark)) return h.img.style(MARK_STYLE).attrs({alt: '', src: marks[mark.device]})
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

function EntryView<M>(h: Html.H<M>, entry: Entry, retry: Screen['retry'], selection?: RowSelection) {
	return renderEntry(entry, {
		notice: notice =>
			h.div
				.key(notice.text)
				.attr('role', 'status')
				.style({...webStyle(styles.line), padding: '8px 12px'})
				.children(
					notice.text,
					notice.retry !== undefined &&
						retry(h.button.class('design-control').attr('type', 'button'), 'click', notice.retry)
							.style({...control, marginTop: '8px'})
							// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
							.children('Retry')
				),
		row: row => Row<M, never>(h, rowOptions(row, Cover(h, row.mark), selection)),
		skeleton: id => Skeleton(h, id)
	})
}

// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
function Workspace<M>(h: Html.H<M>, screen: Screen) {
	if (screen.kind === 'directory') {
		return ListDetail<M, never>(
			h,
			directoryOptions(screen, (entry, retry, selection) => EntryView(h, entry, retry, selection))
		)
	}
	if (screen.kind === 'sessions') {
		return Layout(h, {
			content: h.section
				.attr('aria-label', 'Browser sessions')
				.style({...webStyle(styles.rows), overflowY: 'auto'})
				.children(Array.map(screen.detail, entry => EntryView(h, entry, screen.retry))),
			toolbar: visibleToolbar(screen.toolbar)
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
	return Layout(
		h,
		accessOptions<PaneLeaf<View.Input<M>>, View.Input<M>>(screen, {
			content: children => h.section.style(center).children(children),
			entry: (entry, retry) => EntryView(h, entry, retry),
			error: text => h.p.attr('role', 'alert').style(webStyle(styles.line)).children(text),
			signIn: (part, label, disabled) =>
				part(h.button.class('design-control'), 'click')
					.attr('disabled', Boolean.match(disabled, {onFalse: Function.constUndefined, onTrue: Function.constant('')}))
					.style(control)
					.children(h.img.style(MARK_STYLE).attrs({alt: '', src: marks.github}), label),
			waiting: text => h.p.attr('role', 'status').style(webStyle(styles.line)).children(text)
		})
	)
}

const App = Html.component(authApp.definition).make({
	...authApp.lifecycle,
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
