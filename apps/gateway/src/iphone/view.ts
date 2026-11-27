import {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Function} from 'effect'

import {Layout, Row, styles} from '@deslop/design/native'

import {marks} from '#iphone/marks.ts'
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

function Button<M>(
	h: Native.H<M>,
	el: Native.ViewElement<M, never, Native.ViewEvents, 'view'>,
	label: string,
	disabled = false
) {
	return Pressable(h, {element: el, props: {disabled, pressedStyle: {backgroundColor: '#2b2b2b'}}})
		.style({...styles.control, opacity: disabled ? 0.45 : 1})
		.prop('role', 'button')
		.prop('accessibilityState', {disabled})
		.prop('accessible', true)
		.children(h.text.style(styles.body).children(label))
}

function Notice<M>(h: Native.H<M>, text: string, retry?: GatewayScreen['retry']) {
	return h.view
		.style({alignItems: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 8})
		.children(
			h.text.style(styles.line).children(text),
			retry !== undefined && Button(h, retry(retry(h.view, 'press'), 'accessibilityTap'), 'Retry')
		)
}

function Sparkline<M>(h: Native.H<M>, values: readonly number[]) {
	const points = tracePoints(values)
	return h.view
		.style({width: TRACE_WIDTH, height: TRACE_HEIGHT})
		.prop('accessibilityElementsHidden', true)
		.children(
			Array.map(Array.zip(points, Array.drop(points, 1)), ([a, b], index) => {
				const width = Math.hypot(b.x - a.x, b.y - a.y)
				const angle = Math.atan2(b.y - a.y, b.x - a.x)
				return h.view
					.key(String(index))
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
}

function PasteField<M>(h: Native.H<M>, screen: GatewayScreen) {
	return h.view.style({paddingHorizontal: 12, paddingBottom: 8, paddingTop: 6}).children(
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
	const dialog = screen.dialog
	if (dialog === undefined) return undefined
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
				.value(dialog.secret),
			dialog.error !== undefined && h.text.style(styles.line).prop('role', 'alert').children(dialog.error),
			h.view
				.style(styles.sheetActions)
				.children(
					Button(h, screen.cancel(screen.cancel(h.view, 'press'), 'accessibilityTap'), 'Cancel', screen.busy),
					Button(
						h,
						screen.save(screen.save(h.view, 'press'), 'accessibilityTap'),
						dialog.action,
						screen.busy || !dialog.valid
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
		return h.view.style({backgroundColor: styles.control.backgroundColor, borderRadius: 4, width, height})
	}
	return h.view.prop('accessibilityLabel', keys ? 'Loading AI keys' : 'Loading MCP servers').children(
		Array.makeBy(count, index =>
			h.view
				.key(String(index))
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
				.children(Button(h, screen.back(screen.back(h.view, 'press'), 'accessibilityTap'), 'Back to Gateway'))
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
					!screen.signIn && screen.signInProblem !== undefined && Notice(h, screen.signInProblem),
					screen.signIn
						? h.view
								.style({alignItems: 'flex-start', gap: 8, padding: 12})
								.children(
									h.text
										.style(styles.line)
										.children(screen.signingIn ? 'Signing in…' : (screen.signInProblem ?? 'Sign in to Gateway')),
									Button(
										h,
										screen.signInAction(screen.signInAction(h.view, 'press'), 'accessibilityTap'),
										'Sign in',
										screen.signingIn
									)
								)
						: h.view.children([
								...Array.map(screen.keys.rows ?? [], row =>
									Row(h, {
										active: false,
										cover: Image<M>()
											.style({flexShrink: 0, height: 16, width: 16})
											.prop('resizeMode', 'contain')
											.prop('source', [{uri: marks[row.provider], width: 16, height: 16, scale: 3}]),
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
									})
								),
								screen.keys.loading !== undefined && Skeleton(h, screen.keys.loading, true),
								screen.keys.problem !== undefined &&
									Notice(h, screen.keys.problem, screen.keys.retry ? screen.retry : undefined),
								...Array.map(screen.servers.rows ?? [], row =>
									Row(h, {
										active: false,
										item: row.item,
										trailing:
											row.action === undefined
												? undefined
												: Button(
														h,
														screen
															.connect(screen.connect(h.view, 'press', row.id), 'accessibilityTap', row.id)
															.prop('accessibilityLabel', `${row.action} ${row.item.title}`),
														row.action,
														screen.busy
													)
									})
								),
								screen.servers.loading !== undefined && Skeleton(h, screen.servers.loading, false),
								screen.servers.problem !== undefined &&
									Notice(h, screen.servers.problem, screen.servers.retry ? screen.retry : undefined),
								screen.empty && Notice(h, 'No keys or MCP servers yet')
							])
				]),
			screen.menuFeedback !== undefined &&
				h.view
					.style({
						position: 'absolute',
						bottom: 18,
						right: 18,
						padding: 8,
						borderRadius: 8,
						backgroundColor: styles.control.backgroundColor,
						pointerEvents: 'none'
					})
					.children(h.text.style(styles.line).children(screen.menuFeedback))
		),
		sheet: KeySheet(h, screen),
		toolbar: screen.toolbar
	})
}
