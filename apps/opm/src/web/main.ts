import './styles.css'

import {Mount, Router} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Layer, Number, Option, Predicate, Queue, Schema, Stream, pipe} from 'effect'

import {FetchHttpClient, HttpClient} from 'effect/http'
import {AtomRegistry} from 'effect/reactivity'

import {Layout, Row, Toolbar, ink, styles, webStyle} from '@deslop/design/web'
import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {catalogue} from '#screens/catalogue.ts'
import {ChooseChapter, ChooseToolbar, library, toolbar} from '#screens/library.ts'
import type {Screen} from '#screens/library.ts'
import {Message} from '#screens/model.ts'
import {CloseChapter, OpmRoute} from '#screens/routes.ts'
import {Reader} from '#web/reader.ts'

const WatchSize = Mount.makeStream('Opm/WindowSize', {args: {}}, (node: HTMLElement) =>
	Stream.callback<Message>(queue =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const observer = new ResizeObserver(() => {
					const {height, width} = node.getBoundingClientRect()
					Queue.offerUnsafe(queue, Message.Layout({height, width}))
				})
				observer.observe(node)
				return observer
			}),
			observer => Effect.sync(() => observer.disconnect())
		)
	)
)

const ListPosition = Mount.makeStream(
	'Opm/ListPosition',
	{args: {active: Schema.Boolean, id: Schema.String}},
	(node: HTMLElement, _initial, changes) =>
		Stream.switchMap(changes, ({active, id}) => {
			if (!active) return Stream.never
			return Stream.callback<never>(() =>
				Effect.acquireRelease(
					Effect.sync(() => {
						const key = `opm:list:${id}`
						const frame = requestAnimationFrame(() => {
							node.scrollTop = pipe(
								Option.fromNullOr(sessionStorage.getItem(key)),
								Option.flatMap(Number.parse),
								Option.getOrElse(Function.constant(0))
							)
							node.addEventListener('scroll', save, {passive: true})
						})
						function save() {
							if (node.clientHeight > 0) sessionStorage.setItem(key, `${node.scrollTop}`)
						}
						return () => {
							cancelAnimationFrame(frame)
							node.removeEventListener('scroll', save)
						}
					}),
					remove => Effect.sync(remove)
				)
			)
		})
)

const present = Boolean.match({onFalse: Function.constUndefined, onTrue: Function.constant('')})

function list(h: Html.H<Message>, screen: Screen, older = false) {
	const rows = Boolean.match(older, {onFalse: () => screen.rows, onTrue: () => screen.older})
	const side = Boolean.match(older, {onFalse: Function.constant('latest'), onTrue: Function.constant('older')})
	const hidden = !older && screen.reader !== undefined && (!screen.wide || screen.listHidden)
	function content() {
		if (screen.waiting)
			return h.div
				.class('opm-skeleton-list')
				.attrs({'aria-label': 'Loading chapters', 'aria-busy': 'true', role: 'status'})
		if (rows.length === 0 && !older) return h.p.class('opm-notice').style(webStyle(styles.line)).children('No chapters')
		return Array.map(rows, row =>
			ChooseChapter(h, {
				key: row.data.id,
				props: {chapter: row.chapter},
				onEmit: message => message,
				view: ({select}) =>
					Row(h, {
						active: row.active,
						cover: h.span
							.class('opm-cover')
							.attr('aria-hidden', 'true')
							.style({
								opacity: Boolean.match(row.muted, {onFalse: Function.constant('1'), onTrue: Function.constant('0.45')})
							})
							.children(
								row.cover !== undefined &&
									h.img.attrs({alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: row.cover})
							),
						item: row.data,
						muted: row.muted,
						select
					})
			})
		)
	}
	return h.section
		.key(side)
		.class('opm-list')
		.attrs({
			'aria-label': Boolean.match(older, {
				onFalse: Function.constant('Chapters'),
				onTrue: Function.constant('Older chapters')
			}),
			'data-beside': present(screen.reader !== undefined || screen.book),
			'data-side': side,
			hidden: present(hidden)
		})
		.style({
			flexBasis: Boolean.match(screen.wide && screen.reader !== undefined, {
				onFalse: Function.constUndefined,
				onTrue: () => `${screen.listWidth}px`
			})
		})
		.onMount(ListPosition({active: !hidden && !screen.waiting, id: `${screen.series}:${older}`}))
		.children(content())
}

const control = {...webStyle(styles.control), border: '0', color: ink, textDecoration: 'none'}

function problem(h: Html.H<Message>, screen: Screen) {
	function action() {
		if (screen.signIn && !screen.busy) {
			return h.a.class('design-control').style(control).attr('href', signInUrl(location.href)).children('Sign in')
		}
		if (screen.retryable) {
			return Button(h, {onPress: Message.Retry()}).class('design-control').style(control).children('Retry')
		}
		if (screen.problem === 'Back to chapters') {
			return h.a.class('design-control').style(control).attr('href', '/').children('Back to chapters')
		}
		return undefined
	}
	return h.div.class('opm-gate').children(h.p.attr('role', 'status').children(screen.problem), action())
}

const signOut = pipe(
	Effect.suspend(() =>
		HttpClient.post(new URL(`/auth/sign-out?${new URLSearchParams({next: location.href})}`, location.origin))
	),
	Effect.map(result => result.status),
	Effect.mapError(cause =>
		AuthError.make({cause, error: 'temporarily_unavailable', message: 'Auth did not confirm sign-out'})
	),
	Effect.provide(FetchHttpClient.layer)
)

const App = library(Html.vocabulary, catalogue(layerPageProtocol, accountAtom), {signOut}, (h, screen) =>
	ChooseToolbar(h, {
		onEmit: message => message,
		view: ({choose}) => {
			function content() {
				if (screen.problem !== undefined) return problem(h, screen)
				return [
					h.div
						.class('opm-toolbar')
						.attr('data-overlay', present(screen.reader !== undefined))
						.children(Toolbar(h, {actions: toolbar(screen, false), choose})),
					h.div
						.class('opm-panes')
						.children(
							list(h, screen),
							screen.book && screen.reader === undefined && list(h, screen, true),
							screen.reader !== undefined && Reader(h, screen.reader, screen.pages)
						)
				]
			}
			return Layout(h, {content: h.div.class('opm').onMount(WatchSize({})).children(content())})
		}
	})
)

const root = document.getElementById('root')
if (Predicate.isNull(root)) throw new TypeError('Missing application mount element with id "root"')

addPageTelemetry('@deslop/opm')
pipe(
	BrowserHost.mount(App, Router.props(OpmRoute), root),
	Layer.provide(CloseChapter.layer),
	Layer.provide(BrowserRouter.layer({routes: OpmRoute})),
	Layer.provide(AtomRegistry.layer),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
