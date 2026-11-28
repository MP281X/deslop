import type {View} from '@effect/ui'
import {Native} from '@effect/ui-native'

import {Array, Boolean, Function, Option} from 'effect'

import {History, Sparkline} from './chart.ts'
import {Layout, ListDetail, Row, black, fold, ink, nativeControls, status, styles} from './design.ts'

import type {
	Components,
	FieldOptions,
	ImageOptions,
	MetricOptions,
	TextStyle,
	ViewOptions
} from '#src/shared/components.ts'
import type {ButtonOptions, FactsOptions, Figure, PaneLeaf, Press, Status} from '#src/shared/model.ts'

const FIGURES = ['tabular-nums'] as const
const controls = nativeControls()
const NativeImage: <M>() => Native.ViewElement<M, never, Record<string, unknown>, 'designImage'> = Function.constant(
	Native.defineView(() => new Native.ViewElement<never, never, Record<string, unknown>, 'designImage'>('designImage'), {
		viewName: 'RCTImageView'
	})
)

function Button<M>(h: Native.H<M>, options: ButtonOptions) {
	const element = options.press(options.press(h.view, 'press'), 'accessibilityTap')
	const button = controls.Button(
		h,
		Option.match(Option.fromUndefinedOr(options.description), {
			onNone: () => element,
			onSome: description => element.prop('accessibilityLabel', description)
		}),
		options.label,
		options.disabled
	)
	return Option.match(Option.fromUndefinedOr(options.key), {onNone: () => button, onSome: key => button.key(key)})
}

function Message<M>(h: Native.H<M>, text: string, actions: readonly Native.NoTextInput<M>[]) {
	return h.view
		.style({alignItems: 'flex-start', backgroundColor: black, flex: 1, gap: 8, justifyContent: 'center', padding: 20})
		.children(h.text.style(styles.body).children(text), ...actions)
}

function Headline<M>(h: Native.H<M>, label: string, dot?: Status) {
	return h.view.style(styles.titleLine).children(
		dot !== undefined && h.view.style({...styles.dot, backgroundColor: status[dot]}),
		h.text
			.style({...styles.heading, flexShrink: 1})
			.prop('accessibilityRole', 'header')
			.children(label)
	)
}

function Caption<M>(h: Native.H<M>, text: string) {
	return h.text.style(styles.line).children(text)
}

function Figures<M>(h: Native.H<M>, values: readonly Figure[]) {
	return h.view
		.style({columnGap: 16, flexDirection: 'row', flexWrap: 'wrap', rowGap: 8})
		.children(
			Array.map(values, item =>
				h.view
					.key(item.label)
					.children(
						h.text.style({...styles.heading, fontSize: 19, fontVariant: FIGURES}).children(item.value),
						h.text.style(styles.line).children(item.label)
					)
			)
		)
}

function Fact<M>(h: Native.H<M>, label: string, value: string) {
	return h.view
		.key(label)
		.style({alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between'})
		.children(
			h.text.style(styles.line).children(label),
			h.text
				.style({...styles.line, color: ink, flexShrink: 1, fontVariant: FIGURES, textAlign: 'right'})
				.children(value)
		)
}

function Facts<M>(h: Native.H<M>, options: FactsOptions) {
	return [
		...Array.map(options.values, fact => Fact(h, fact.label, fact.value)),
		...Option.match(Option.fromUndefinedOr(options.choices), {
			onNone: Array.empty,
			onSome: found => [
				h.view
					.style({alignItems: 'center', flexDirection: 'row', gap: 8})
					.children(
						h.text.style(styles.line).children(found.label),
						h.view
							.style({
								alignItems: 'center',
								flex: 1,
								flexDirection: 'row',
								flexWrap: 'wrap',
								gap: 4,
								justifyContent: 'flex-end'
							})
							.children(
								Array.map(found.items, item =>
									Option.match(Option.fromUndefinedOr(item.press), {
										onNone: () => h.text.key(item.id).style(styles.body).children(item.label),
										onSome: press =>
											Button(h, {
												description: item.description,
												disabled: item.disabled,
												key: item.id,
												label: item.label,
												press
											})
									})
								)
							)
					)
			]
		})
	]
}

function Block<M>(h: Native.H<M>, width: Native.ViewStyle['width'], height: number) {
	return h.view.style({backgroundColor: '#202020', borderRadius: 4, height, width})
}

function Skeleton<M>(h: Native.H<M>) {
	return h.view.style({gap: 12}).children(Block(h, '38%', 20), Block(h, '65%', 14), Block(h, '92%', 96))
}

function Box<M>(h: Native.H<M>, options: ViewOptions, children: readonly Native.NoTextInput<M>[]) {
	const keyed = Option.match(Option.fromUndefinedOr(options.key), {
		onNone: () => h.view,
		onSome: key => h.view.key(key)
	})
	return Option.match(Option.fromUndefinedOr(options.style), {
		onNone: () => keyed.children(...children),
		onSome: style => keyed.style(style).children(...children)
	})
}

function Text<M>(h: Native.H<M>, style: TextStyle, text: string) {
	return h.text.style(style).children(text)
}

function Image<M>(_h: Native.H<M>, options: ImageOptions) {
	return NativeImage<M>()
		.style({height: options.size, width: options.size})
		.prop('resizeMode', 'contain')
		.prop('source', [{height: options.size, scale: 1, uri: options.source, width: options.size}])
}

function RowWithAction<M>(h: Native.H<M>, id: string, row: Native.NoTextInput<M>, action?: Native.NoTextInput<M>) {
	return h.view
		.key(id)
		.style({alignItems: 'center', flexDirection: 'row', gap: 4})
		.children(h.view.style({flex: 1}).children(row), action)
}

function Bar<M>(h: Native.H<M>, proportion: number) {
	return h.view
		.style({backgroundColor: fold, borderRadius: 2, height: 4, width: 40})
		.children(h.view.style({backgroundColor: styles.line.color, borderRadius: 2, height: 4, width: `${proportion}%`}))
}

function Metric<M>(h: Native.H<M>, options: MetricOptions<Native.NoTextInput<M>>) {
	return h.view
		.style({alignItems: 'center', flexDirection: 'row', gap: 8})
		.children(
			options.leading,
			h.text
				.style(
					Boolean.match(options.wide === true, {
						onFalse: () => ({...styles.line, fontVariant: FIGURES}),
						onTrue: () => ({...styles.line, fontVariant: FIGURES, minWidth: 92, textAlign: 'right' as const})
					})
				)
				.children(options.value)
		)
}

function Section<M>(h: Native.H<M>, title: string, content: Native.NoTextInput<M>) {
	return h.view.style({gap: 8}).children(h.text.style(styles.heading).children(title), content)
}

function Form<M>(h: Native.H<M>, _id: string, _submit: Press, children: readonly Native.NoTextInput<M>[]) {
	return h.view.style({gap: 8}).children(...children)
}

function Paragraph<M>(h: Native.H<M>, text: string) {
	return h.text.style(styles.body).children(text)
}

function Logs<M>(h: Native.H<M>, text: string) {
	return h.text.style({...styles.body, fontFamily: 'ui-monospace', fontSize: 12, lineHeight: 17}).children(text)
}

function TextField<M>(h: Native.H<M>, options: FieldOptions) {
	return h.view.children(
		h.text.style(styles.body).children(options.label),
		options
			.input(h.input, 'input')
			.style({...styles.body, borderColor: fold, borderRadius: 8, borderWidth: 1, minHeight: 40, padding: 8})
			.prop('accessibilityLabel', options.label)
			.prop('autoCapitalize', 'none')
			.prop('autoCorrect', false)
			.prop('editable', !options.disabled)
			.placeholder(options.placeholder)
			.value(options.value)
	)
}

export function nativeComponents<M>(): Components<Native.H<M>, PaneLeaf<Native.NoTextInput<M>>, View.Content<M>> {
	return {
		bar: Bar,
		button: Button,
		caption: Caption,
		facts: Facts,
		figures: Figures,
		form: Form,
		headline: Headline,
		history: History,
		image: Image,
		layout: Layout,
		listDetail: ListDetail,
		logs: Logs,
		message: Message,
		metric: Metric,
		notice: controls.Notice,
		paragraph: Paragraph,
		regularSheetHeight: 0.58,
		row: Row,
		rowWithAction: RowWithAction,
		section: Section,
		skeleton: Skeleton,
		sparkline: Sparkline,
		text: Text,
		textField: TextField,
		view: Box
	}
}
