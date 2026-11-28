import './styles.css'

import {Mount, Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Layer, Number, Option, Queue, Schema, Stream, pipe} from 'effect'

import {FetchHttpClient, HttpClient} from 'effect/http'

import type {PaneLeaf} from '@deslop/components/model'
import {Layout, Toolbar, WatchLayout, ink, styles, webStyle} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {SignOut} from '@deslop/runtime/client/shell'
import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {OpmApp, imaged, resized} from '#app'
import type {OpmScreen} from '#app'
import {ChapterTokens, OpmRoute, layerOpm} from '#reads'
import {Workspace} from '#view'
import type {OpmUi} from '#view'

import {pageAspect} from '#chapters/shared.ts'

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

function imageOf(node: unknown) {
	if (!(node instanceof HTMLImageElement)) throw new TypeError('The page shape mount needs an image element')
	return node
}

const PageShape = Mount.makeStream('Opm/PageShape', {args: {}}, (node: unknown) =>
	Stream.callback<number>(queue =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const image = imageOf(node)
				function loaded() {
					Queue.offerUnsafe(queue, pageAspect(image.naturalWidth, image.naturalHeight))
				}
				image.addEventListener('load', loaded)
				image.addEventListener('error', loaded)
				if (image.complete) loaded()
				return () => {
					image.removeEventListener('load', loaded)
					image.removeEventListener('error', loaded)
				}
			}),
			remove => Effect.sync(remove)
		)
	)
)

const present = Boolean.match({onFalse: Function.constUndefined, onTrue: Function.constant('')})

const control = {...webStyle(styles.control), border: '0', color: ink, textDecoration: 'none'}

function Page<M>(h: Html.H<M>, screen: OpmScreen, page: OpmScreen['pages'][number]) {
	if (page.failed) {
		return screen
			.retryPage(h.button, 'click', page.src)
			.class('design-control opm-retry-page')
			.attr('type', 'button')
			.style({...webStyle(styles.control), border: '0', color: ink})
			.on('pointerdown', Function.constUndefined)
			.children('Reload page')
	}
	return screen
		.watch(
			h.img,
			Mount.map(PageShape({}), aspect => imaged(page.src, aspect))
		)
		.attrs({alt: `Page ${page.index + 1}`, draggable: 'false', referrerpolicy: 'no-referrer', src: page.src})
}

function Reader<M>(h: Html.H<M>, screen: OpmScreen, reader: NonNullable<OpmScreen['reader']>) {
	function pending() {
		if (reader.ready) return undefined
		if (!reader.waiting) return h.p.style(webStyle(styles.line)).attr('role', 'status').children('Chapter unavailable')
		return h.div
			.class('opm-page-placeholder')
			.attrs({'aria-busy': 'true', 'aria-label': 'Loading chapter', role: 'status'})
	}
	return screen
		.pointer(screen.pointer(screen.pointer(h.section, 'pointerdown'), 'pointerup'), 'pointercancel')
		.key(reader.id)
		.class('opm-reader design-detail')
		.attr('aria-label', reader.title)
		.children(
			pending(),
			h.div.class('opm-paper').children(
				Array.map(screen.pages, page =>
					h.div
						.key(`${page.index}`)
						.class('opm-leaf')
						.attrs({
							'data-side': page.side,
							hidden: Boolean.match(page.visible, {onFalse: Function.constant(''), onTrue: Function.constUndefined})
						})
						.children(Page(h, screen, page))
				)
			)
		)
}

const drawing: OpmUi<Html.H<never>, PaneLeaf<View.Input<never>>, View.Content<never>> = {
	...webComponents<never>(),
	chapters: (h, screen, options, content) => {
		const side = Boolean.match(options.older, {
			onFalse: Function.constant('latest'),
			onTrue: Function.constant('older')
		})
		const hidden = !options.older && screen.reader !== undefined && (!screen.wide || screen.listHidden)
		return h.section
			.key(side)
			.class('opm-list')
			.attrs({
				'aria-label': options.label,
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
			.onMount(ListPosition({active: !hidden && !screen.waiting, id: `${screen.series}:${options.older}`}))
			.children(content)
	},
	cover: (h, _screen, row) =>
		h.span
			.class('opm-cover')
			.attr('aria-hidden', 'true')
			.style({opacity: `${row.coverOpacity}`})
			.children(
				row.cover !== undefined &&
					h.img.attrs({alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', src: row.cover})
			),
	leave: (h, label) => h.a.class('design-control').style(control).attr('href', '/').children(label),
	loading: h => [
		h.div.class('opm-skeleton-list').attrs({'aria-busy': 'true', 'aria-label': 'Loading chapters', role: 'status'})
	],
	native: false,
	note: (h, text) => h.p.class('opm-notice').style(webStyle(styles.line)).children(text),
	problem: (h, text, actions) => h.div.class('opm-gate').children(h.p.attr('role', 'status').children(text), actions),
	reader: Reader,
	retry: (h, label, press) =>
		press(h.button, 'click').class('design-control').attr('type', 'button').style(control).children(label),
	signIn: (h, label) =>
		h.a.class('design-control').style(control).attr('href', signInUrl(location.href)).children(label),
	stage: (h, screen, parts) =>
		Layout(h, {
			content: screen
				.watch(
					h.div,
					Mount.map(WatchLayout({}), size => resized(size))
				)
				.class('opm')
				.children(
					parts.problem ?? [
						h.div
							.class('opm-toolbar')
							.attr('data-overlay', present(screen.reader !== undefined))
							.children(Toolbar(h, parts.toolbar)),
						h.div.class('opm-panes').children(parts.panes?.latest, parts.panes?.older, parts.panes?.reader)
					]
				)
		})
}

const App = OpmApp(Html.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// The web gets no push-to-start tokens, and asks Auth to end the shared session, which says whether it confirmed.
const layerActions = Layer.mergeAll(
	Layer.succeed(ChapterTokens, Stream.empty),
	Layer.provide(
		SignOut.toLayer(
			Effect.map(
				HttpClient.HttpClient,
				client => () =>
					Effect.mapBoth(
						Effect.suspend(() =>
							client.post(new URL(`/auth/sign-out?${new URLSearchParams({next: location.href})}`, location.origin))
						),
						{
							onFailure: cause =>
								AuthError.make({cause, error: 'temporarily_unavailable', message: 'Auth did not confirm sign-out'}),
							onSuccess: result => result.status >= 200 && result.status < 400
						}
					)
			)
		),
		FetchHttpClient.layer
	)
)

mountPage(OpmRoute, root =>
	Layer.provide(
		BrowserHost.mount(App, Router.props(OpmRoute), root),
		Layer.provideMerge(layerOpm, Layer.merge(layerActions, layerWebShell('opm', {autoSignIn: false})))
	)
)
