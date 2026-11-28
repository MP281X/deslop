import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {Array, Boolean, Effect, Function, Layer, String, pipe} from 'effect'

import Clipboard from 'react-native/Libraries/Components/Clipboard/Clipboard'
import Linking from 'react-native/Libraries/Linking/Linking'

import {nativeControls, styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {SignOutSession} from '@deslop/runtime/client/shell'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'
import {AuthError} from '@deslop/runtime/shared/auth'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'

import {GatewayApp} from '#app'
import type {GatewayScreen} from '#app'
import {Copy, GatewayRoute, Open, SignOut, layerGateway} from '#reads'
import {ADD_LABEL, ADD_PLACEHOLDER, Workspace, inputValue} from '#view'
import type {GatewayUi} from '#view'

import {KEY_LABEL, marks} from '#ai-proxy/view.ts'
import {TRACE_HEIGHT, TRACE_WIDTH, tracePoints} from '#usage/screen.ts'

const FIGURES = ['tabular-nums'] as const

const origins = iphoneOrigins('gateway')
const FIELD = {
	...styles.body,
	backgroundColor: styles.control.backgroundColor,
	borderRadius: 8,
	minHeight: 44,
	paddingHorizontal: 12
}

const Image: <M>() => Native.ViewElement<M, never, Record<string, unknown>, 'gatewayImage'> = Function.constant(
	Native.defineView(
		() => new Native.ViewElement<never, never, Record<string, unknown>, 'gatewayImage'>('gatewayImage'),
		{viewName: 'RCTImageView'}
	)
)

// Gateway's buttons read as buttons by role, and its notices sit a little tighter than the shared ones.
const controls = nativeControls({noticeStyle: {gap: 6}, useRole: true})
const components = nativeComponents<never>()

function Sparkline<M>(h: Native.H<M>, values: readonly number[]) {
	const points = tracePoints(values)
	return h.view
		.style({height: TRACE_HEIGHT, width: TRACE_WIDTH})
		.prop('accessibilityElementsHidden', true)
		.children(
			pipe(
				points,
				Array.zip(Array.drop(points, 1)),
				Array.map((segment, index) => {
					const a = segment[0]
					const b = segment[1]
					const width = Math.hypot(b.x - a.x, b.y - a.y)
					const angle = Math.atan2(b.y - a.y, b.x - a.x)
					return h.view
						.key(String.String(index))
						.style({
							backgroundColor: styles.line.color,
							height: 1,
							left: (a.x + b.x - width) / 2,
							position: 'absolute',
							top: (a.y + b.y - 1) / 2,
							transform: [{rotate: `${angle}rad`}],
							width
						})
				})
			)
		)
}

function PasteField<M>(h: Native.H<M>, screen: GatewayScreen) {
	return h.view.style({paddingBottom: 8, paddingHorizontal: 12, paddingTop: 6}).children(
		screen
			.submit(screen.clear(h.input, 'input'), 'submit', inputValue)
			.key(screen.fieldVersion)
			.style({...FIELD, maxWidth: 285})
			.prop('accessibilityLabel', ADD_LABEL)
			.prop('autoCapitalize', 'none')
			.prop('autoCorrect', false)
			.prop('editable', !screen.busy)
			.prop('placeholderTextColor', styles.line.color)
			.prop('returnKeyType', 'go')
			.placeholder(ADD_PLACEHOLDER),
		screen.fieldError !== undefined && h.text.style(styles.line).prop('role', 'alert').children(screen.fieldError)
	)
}

function KeySheet<M>(
	h: Native.H<M>,
	screen: GatewayScreen,
	actions: {cancel: ReturnType<typeof components.view>; save: ReturnType<typeof components.view>}
) {
	if (screen.dialog === undefined) return undefined
	return {
		body: h.view.style({gap: 8}).children(
			h.text.style(styles.body).children(KEY_LABEL),
			screen
				.save(screen.edit(h.input, 'input', inputValue), 'submit')
				.style(FIELD)
				.prop('accessibilityLabel', KEY_LABEL)
				.prop('autoCapitalize', 'none')
				.prop('autoCorrect', false)
				.prop('autoFocus', true)
				.prop('editable', !screen.busy)
				.prop('returnKeyType', 'go')
				.prop('secureTextEntry', true)
				.value(screen.dialog.secret),
			screen.dialog.error !== undefined &&
				h.text.style(styles.line).prop('role', 'alert').children(screen.dialog.error),
			h.view.style(styles.sheetActions).children(actions.cancel, actions.save)
		),
		dismiss: screen.cancel,
		height: 0.55,
		label: KEY_LABEL,
		open: true,
		pending: screen.busy
	}
}

function Skeleton<M>(h: Native.H<M>, count: number, keys: boolean) {
	function block(width: number, height: number) {
		return h.view.style({backgroundColor: styles.control.backgroundColor, borderRadius: 4, height, width})
	}
	return h.view
		.prop(
			'accessibilityLabel',
			Boolean.match(keys, {
				onFalse: Function.constant('Loading MCP servers'),
				onTrue: Function.constant('Loading AI keys')
			})
		)
		.children(
			Array.makeBy(count, index =>
				h.view
					.key(String.String(index))
					.style(styles.row)
					.children(
						keys && block(16, 16),
						h.view.style({...styles.lead, gap: 6}).children(block(95, 12), block(68, 9)),
						keys && block(TRACE_WIDTH, 4),
						h.view.style({alignItems: 'flex-end', gap: 6}).children(block(42, 12), keys && block(67, 9))
					)
			)
		)
}

const drawing: GatewayUi<Native.H<never>, ReturnType<typeof components.view>, View.Content<never>> = {
	...components,
	button: (h, options) =>
		controls.Button(
			h,
			options.press(options.press(h.view, 'press'), 'accessibilityTap').prop('accessibilityLabel', options.description),
			options.label,
			options.disabled
		),
	cover: (_h, provider) =>
		Image<never>()
			.style({flexShrink: 0, height: 16, width: 16})
			.prop('resizeMode', 'contain')
			.prop('source', [{height: 16, scale: 3, uri: marks[provider], width: 16}]),
	entry: (_h, _id, row) => row,
	feedback: (h, text) =>
		h.view
			.style({
				backgroundColor: styles.control.backgroundColor,
				borderRadius: 8,
				bottom: 18,
				padding: 8,
				pointerEvents: 'none',
				position: 'absolute',
				right: 18
			})
			.children(h.text.style(styles.line).children(text)),
	keySheet: KeySheet,
	loading: Skeleton,
	missing: (h, back) =>
		h.view
			.style({padding: 20})
			.children(controls.Button(h, back(back(h.view, 'press'), 'accessibilityTap'), 'Back to Gateway')),
	notice: controls.Notice,
	page: (h, options) =>
		h.view.style(styles.frame).children(
			h.scroll
				.style(styles.pane)
				// The Duo's system column is drawn over the native screen.
				.contentContainerStyle({...styles.rows, paddingRight: 76, paddingTop: 32})
				.prop('automaticallyAdjustKeyboardInsets', true)
				.prop('contentInsetAdjustmentBehavior', 'automatic')
				.children([options.field, options.notice, options.signIn ?? h.view.children(options.rows)]),
			options.feedback
		),
	pasteField: PasteField,
	signIn: (h, options) =>
		h.view
			.style({alignItems: 'flex-start', gap: 8, padding: 12})
			.children(
				h.text.style(styles.line).children(options.text),
				controls.Button(
					h,
					options.press(options.press(h.view, 'press'), 'accessibilityTap'),
					'Sign in',
					options.running
				)
			),
	spend: (h, row) =>
		h.view
			.style({alignItems: 'center', flexDirection: 'row', gap: 8})
			.children(
				Sparkline(h, row.values),
				h.view
					.style({alignItems: 'flex-end', width: 94})
					.children(
						h.text.style({...styles.body, fontVariant: FIGURES}).children(row.value),
						h.text.style(styles.line).children(row.label)
					)
			)
}

const App = GatewayApp(Native.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// The app hands the gateway's own addresses to the system and keeps the MCP URL on the clipboard; signing out asks Auth through the shell's session.
const layerActions = Layer.mergeAll(
	Open.toLayer(request =>
		Effect.asVoid(
			Effect.tryPromise({
				catch: cause => AuthError.make({cause, message: 'Could not open the server’s authorization page'}),
				try: () => Linking.openURL(`${origins.appOrigin}${request.path}`)
			})
		)
	),
	Copy.toLayer(() =>
		Effect.try({
			catch: cause => AuthError.make({cause, message: 'Couldn’t copy MCP URL'}),
			try: () => Clipboard.setString(`${origins.appOrigin}/mcp`)
		})
	),
	SignOut.toLayer(Effect.map(SignOutSession, signOut => () => signOut({failure: 'Could not clear the session'})))
)

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(GatewayRoute)),
		pipe(
			layerGateway,
			Layer.provideMerge(layerActions),
			Layer.provideMerge(layerIPhoneShell({name: 'gateway', route: GatewayRoute}))
		)
	)
)
