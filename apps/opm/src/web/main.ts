import './styles.css'

import {Mount, Router} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import {BrowserHost, BrowserRouter, Html} from '@effect/ui/html'

import {Boolean, Effect, Function, Layer, Number, Option, Predicate, Schema, Stream, pipe} from 'effect'

import {FetchHttpClient, HttpClient} from 'effect/http'
import {AtomRegistry} from 'effect/reactivity'

import {Layout, Row, Toolbar, ink, styles, WatchLayout, webStyle} from '@deslop/components/web'
import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {catalogue} from '#screens/catalogue.ts'
import {ChooseToolbar, chapterListOf, chapterRows, library, toolbar} from '#screens/library.ts'
import type {Screen} from '#screens/library.ts'
import {Message} from '#screens/model.ts'
import {CloseChapter, OpmRoute} from '#screens/routes.ts'
import {WebReader} from '#web/reader.ts'

const ListPosition = Mount.makeStream(
	'Opm/ListPosition',
	{args: {active: Schema.Boolean, id: Schema.String}},
	(node: HTMLElement, _initial, changes) =>
		Stream.switchMap(changes, state => {
			if (!state.active) return Stream.never
			return Stream.callback<never>(() =>
				Effect.acquireRelease(
					Effect.sync(() => {
						const key = `opm:list:${state.id}`
						function save() {
							if (node.clientHeight > 0) sessionStorage.setItem(key, `${node.scrollTop}`)
						}
						const frame = requestAnimationFrame(() => {
							node.scrollTo({
								top: pipe(
									Option.fromNullOr(sessionStorage.getItem(key)),
									Option.flatMap(Number.parse),
									Option.getOrElse(Function.constant(0))
								)
							})
							node.addEventListener('scroll', save, {passive: true})
						})
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
	const chapters = chapterListOf(screen, older)
	const side = Boolean.match(older, {onFalse: Function.constant('latest'), onTrue: Function.constant('older')})
	const hidden = !older && screen.reader !== undefined && (!screen.wide || screen.listHidden)
	function content() {
		if (screen.waiting) {
			return h.div
				.class('opm-skeleton-list')
				.attrs({'aria-busy': 'true', 'aria-label': 'Loading chapters', role: 'status'})
		}
		if (chapters.empty) {
			return h.p.class('opm-notice').style(webStyle(styles.line)).children('No chapters')
		}
		return chapterRows(
			h,
			chapters.rows,
			row =>
				h.span
					.class('opm-cover')
					.attr('aria-hidden', 'true')
					.style({opacity: `${row.coverOpacity}`})
					.children(
						row.cover !== undefined &&
							h.img.attrs({alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: row.cover})
					),
			options => Row(h, options)
		)
	}
	return h.section
		.key(side)
		.class('opm-list')
		.attrs({
			'aria-label': chapters.label,
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

const signOut = Effect.mapBoth(
	Effect.suspend(() =>
		HttpClient.post(new URL(`/auth/sign-out?${new URLSearchParams({next: location.href})}`, location.origin))
	),
	{
		onFailure: cause =>
			AuthError.make({cause, error: 'temporarily_unavailable', message: 'Auth did not confirm sign-out'}),
		onSuccess: result => result.status
	}
)

const App = library(Html.vocabulary, catalogue(layerPageProtocol, accountAtom), {signOut}, (h, screen) =>
	ChooseToolbar(h, {
		onEmit: message => message,
		view: parts => {
			function content() {
				if (screen.problem !== undefined) return problem(h, screen)
				return [
					h.div
						.class('opm-toolbar')
						.attr('data-overlay', present(screen.reader !== undefined))
						.children(Toolbar(h, {actions: toolbar(screen, false), choose: parts.choose})),
					h.div
						.class('opm-panes')
						.children(
							list(h, screen),
							screen.book && screen.reader === undefined && list(h, screen, true),
							screen.reader !== undefined && WebReader(h, screen.reader, screen.pages)
						)
				]
			}
			return Layout(h, {
				content: h.div
					.class('opm')
					.onMount(Mount.map(WatchLayout({}), size => Message.Layout({height: size.height, width: size.width})))
					.children(content())
			})
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
	Layer.provide(FetchHttpClient.layer),
	Layer.launch,
	// oxlint-disable-next-line eslint/no-restricted-properties -- Mount one scoped root for the life of the document.
	Effect.runFork
)
