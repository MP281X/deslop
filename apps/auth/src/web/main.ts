import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Boolean, Effect, Function, Layer, Option, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'

import type {ButtonOptions, PaneLeaf, Press} from '@deslop/components/model'
import {Layout, styles, webStyle} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {AuthApp} from '#app'
import {RecoverSignIn, ReturnTo, SignOut, StartSignIn, AuthRoute, layerAuth} from '#reads'
import {Workspace} from '#view'
import type {AuthUi, LineRole} from '#view'

import {marks, visibleToolbar} from '#identity/view.ts'
import {Mark} from '#people/screen.ts'
import {AVATAR} from '#people/view.ts'
import {returnTarget} from '#sign-ins/shared.ts'

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

function Line<M>(h: Html.H<M>, text: string, role: LineRole) {
	return h.p.attr('role', role).style(webStyle(styles.line)).children(text)
}

// Auth's buttons keep the control's own font, and the GitHub one carries its mark.
function Control<M>(h: Html.H<M>, options: ButtonOptions, github = false, style: Html.Style = control) {
	return options
		.press(h.button.class('design-control'), 'click')
		.attr(
			'disabled',
			Boolean.match(options.disabled === true, {onFalse: Function.constUndefined, onTrue: Function.constant('')})
		)
		.style(style)
		.children(github && h.img.style(MARK_STYLE).attrs({alt: '', src: marks.github}), options.label)
}

function Notice<M>(h: Html.H<M>, text: string, retry?: Press) {
	return h.div
		.key(text)
		.attr('role', 'status')
		.style({...webStyle(styles.line), padding: '8px 12px'})
		.children(
			text,
			retry !== undefined &&
				Control(h, {label: 'Retry', press: retry}, false, {...control, marginTop: '8px'}).attr('type', 'button')
		)
}

const drawing: AuthUi<Html.H<never>, PaneLeaf<View.Input<never>>, View.Content<never>> = {
	...webComponents<never>(),
	button: (h, options) => Control(h, options),
	cover: Cover,
	line: Line,
	memberList: (h, options) =>
		Layout(h, {
			content: h.section
				.attr('aria-label', 'Browser sessions')
				.style({...webStyle(styles.rows), overflowY: 'auto'})
				.children(options.rows),
			toolbar: visibleToolbar(options.toolbar)
		}),
	notice: Notice,
	signIn: (h, options) => Control(h, options, true)
}

const App = AuthApp(Html.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// Auth is its own sign-in: the page goes to GitHub for the app that sent it here, and signing out reloads the page.
const layerActions = Layer.provide(
	Layer.mergeAll(
		StartSignIn.toLayer(args =>
			Effect.sync(() => {
				location.assign(`/sign-in?${new URLSearchParams({next: args.next ?? location.origin})}`)
				return false
			})
		),
		RecoverSignIn.toLayer(() => Effect.sync(() => location.replace(signInUrl(location.href)))),
		ReturnTo.toLayer(request =>
			Effect.sync(() => {
				Option.map(returnTarget(request.next, location.origin, location.protocol === 'http:'), target =>
					location.assign(target)
				)
			})
		),
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
						Effect.as(false)
					)
			)
		)
	),
	FetchHttpClient.layer
)

const layerPage = pipe(layerAuth, Layer.merge(layerActions), Layer.provideMerge(layerWebShell('auth')))

mountPage(AuthRoute, root => Layer.provide(BrowserHost.mount(App, Router.props(AuthRoute), root), layerPage))
