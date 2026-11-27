import {Native} from '@effect/ui-native'

import {Array, Boolean, Function, String, pipe} from 'effect'

import {Layout, Row, nativeControls, styles} from '@deslop/design/native'

import {marks} from '#iphone/marks.ts'
import {gatewayRows} from '#screens/gateway.ts'
import type {GatewayScreen} from '#screens/gateway.ts'
import {ADD_LABEL, ADD_PLACEHOLDER, KEY_LABEL, inputValue} from '#screens/input.ts'
import {TRACE_HEIGHT, TRACE_WIDTH, tracePoints} from '#screens/rows.ts'

const FIGURES = ['tabular-nums'] as const
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

const controls = nativeControls({noticeStyle: {gap: 6}, useRole: true})
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

function KeySheet<M>(h: Native.H<M>, screen: GatewayScreen) {
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
			h.view
				.style(styles.sheetActions)
				.children(
					controls.Button(h, screen.cancel(screen.cancel(h.view, 'press'), 'accessibilityTap'), 'Cancel', screen.busy),
					controls.Button(
						h,
						screen.save(screen.save(h.view, 'press'), 'accessibilityTap'),
						screen.dialog.action,
						screen.busy || !screen.dialog.valid
					)
				)
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

export function Workspace<M>(h: Native.H<M>, screen: GatewayScreen) {
	if (!screen.home) {
		return Layout(h, {
			content: h.view
				.style({padding: 20})
				.children(controls.Button(h, screen.back(screen.back(h.view, 'press'), 'accessibilityTap'), 'Back to Gateway'))
		})
	}

	return Layout(h, {
		content: h.view.style(styles.frame).children(
			h.scroll
				.style(styles.pane)
				// The Duo's system column is drawn over the native screen.
				.contentContainerStyle({...styles.rows, paddingRight: 76, paddingTop: 32})
				.prop('automaticallyAdjustKeyboardInsets', true)
				.prop('contentInsetAdjustmentBehavior', 'automatic')
				.children([
					PasteField(h, screen),
					!screen.signIn && screen.signInProblem !== undefined && controls.Notice(h, screen.signInProblem),
					Boolean.match(screen.signIn, {
						onFalse: () =>
							h.view.children(
								gatewayRows(screen, {
									key: row =>
										Row(h, {
											active: false,
											cover: Image<M>()
												.style({flexShrink: 0, height: 16, width: 16})
												.prop('resizeMode', 'contain')
												.prop('source', [{height: 16, scale: 3, uri: marks[row.provider], width: 16}]),
											item: row.item,
											trailing: h.view
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
										}),
									loading: (count, keys) => Skeleton(h, count, keys),
									notice: (text, retry) => controls.Notice(h, text, retry),
									server: row => {
										function action() {
											if (row.action === undefined) return undefined
											return controls.Button(
												h,
												screen
													.connect(screen.connect(h.view, 'press', row.id), 'accessibilityTap', row.id)
													.prop('accessibilityLabel', `${row.action} ${row.item.title}`),
												row.action,
												screen.busy
											)
										}
										return Row(h, {active: false, item: row.item, trailing: action()})
									}
								})
							),
						onTrue: () =>
							h.view
								.style({alignItems: 'flex-start', gap: 8, padding: 12})
								.children(
									h.text
										.style(styles.line)
										.children(
											Boolean.match(screen.signingIn, {
												onFalse: () => screen.signInProblem ?? 'Sign in to Gateway',
												onTrue: Function.constant('Signing in…')
											})
										),
									controls.Button(
										h,
										screen.signInAction(screen.signInAction(h.view, 'press'), 'accessibilityTap'),
										'Sign in',
										screen.signingIn
									)
								)
					})
				]),
			screen.menuFeedback !== undefined &&
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
					.children(h.text.style(styles.line).children(screen.menuFeedback))
		),
		sheet: KeySheet(h, screen),
		toolbar: screen.toolbar
	})
}
