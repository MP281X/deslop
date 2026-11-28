import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option} from 'effect'

import {History, Sparkline} from './chart.ts'
import {Layout, ListDetail, Row, status, styles, webStyle} from './design.ts'

import type {
	Components,
	FieldOptions,
	ImageOptions,
	MetricOptions,
	TextStyle,
	ViewOptions
} from '#src/shared/components.ts'
import type {Absent, ButtonOptions, FactsOptions, Figure, PaneLeaf, Press, Status} from '#src/shared/model.ts'

function ControlButton<M>(h: Html.H<M>, disabled: boolean | Absent) {
	return h.button
		.class('design-control design-button')
		.attr('type', 'button')
		.disabled(disabled === true)
		.style(webStyle(styles.control))
}

function Button<M>(h: Html.H<M>, options: ButtonOptions) {
	const control = ControlButton(h, options.disabled)
	const button = Option.match(Option.fromUndefinedOr(options.form), {
		onNone: () => options.press(control, 'click'),
		onSome: form => control.attrs({form, type: 'submit'})
	})
		.attr('aria-label', options.description)
		.children(options.label)
	return Option.match(Option.fromUndefinedOr(options.key), {onNone: () => button, onSome: key => button.key(key)})
}

function Notice<M>(h: Html.H<M>, text: string, retry?: Press) {
	return h.div.style({padding: '8px 12px'}).children(
		h.p
			.attr('role', 'status')
			.style({...webStyle(styles.line), margin: '0'})
			.children(text),
		retry !== undefined && Button(h, {label: 'Retry', press: retry})
	)
}

function Message<M>(h: Html.H<M>, text: string, actions: readonly View.Input<M>[]) {
	return h.div.style({padding: '20px'}).children(h.p.attr('role', 'status').children(text), ...actions)
}

function Headline<M>(h: Html.H<M>, label: string, dot?: Status) {
	return h.h1
		.style({...webStyle(styles.heading), ...webStyle(styles.titleLine), margin: '0'})
		.children(dot !== undefined && h.span.style({...webStyle(styles.dot), backgroundColor: status[dot]}), label)
}

function Caption<M>(h: Html.H<M>, text: string) {
	return h.p.class('design-caption').children(text)
}

function Figures<M>(h: Html.H<M>, values: readonly Figure[]) {
	return h.div
		.class('design-plot-data')
		.children(
			Array.map(values, item =>
				h.div
					.key(item.label)
					.children(h.strong.children(item.value), h.span.class('design-caption').children(item.label))
			)
		)
}

function Fact<M>(h: Html.H<M>, label: string, value: View.Input<M>) {
	return h.div.key(label).children(h.dt.class('design-caption').children(label), h.dd.children(value))
}

function Facts<M>(h: Html.H<M>, options: FactsOptions) {
	return [
		h.dl.class('design-facts').children(
			Array.map(options.values, fact => Fact(h, fact.label, fact.value)),
			options.choices !== undefined &&
				Fact(
					h,
					options.choices.label,
					h.span.children(
						Array.map(options.choices.items, item =>
							Option.match(Option.fromUndefinedOr(item.press), {
								onNone: () => h.span.key(item.id).children(item.label, ' '),
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
		)
	]
}

function Skeleton<M>(h: Html.H<M>) {
	return h.div.attr('aria-hidden', 'true').class('design-detail-skeleton')
}

function Box<M>(h: Html.H<M>, options: ViewOptions, children: readonly View.Input<M>[]) {
	const element = Option.match(Option.fromUndefinedOr(options.key), {
		onNone: () => h.div,
		onSome: key => h.div.key(key)
	}).attr(
		'aria-hidden',
		Boolean.match(options.decorative === true, {onFalse: Function.constUndefined, onTrue: Function.constant('true')})
	)
	return Option.match(Option.fromUndefinedOr(options.style), {
		onNone: () => element.children(...children),
		onSome: style => element.style(webStyle(style)).children(...children)
	})
}

function Text<M>(h: Html.H<M>, style: TextStyle, text: string) {
	return h.span.style(webStyle(style)).children(text)
}

function Image<M>(h: Html.H<M>, options: ImageOptions) {
	return h.img
		.attrs({alt: '', src: options.source})
		.style({
			display: 'block',
			height: `${options.size}px`,
			imageRendering: Boolean.match(options.pixel, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('pixelated')
			}),
			objectFit: 'contain',
			width: `${options.size}px`
		})
}

function RowWithAction<M>(h: Html.H<M>, id: string, row: View.Input<M>, action?: View.Input<M>) {
	return h.div.key(id).class('design-row-action').children(row, action)
}

function Bar<M>(h: Html.H<M>, proportion: number) {
	return h.span
		.class('design-bar')
		.attr('aria-hidden', 'true')
		.children(h.span.style({width: `${proportion}%`}))
}

function Metric<M>(h: Html.H<M>, options: MetricOptions<View.Input<M>>) {
	return h.span
		.class('design-metric')
		.style(webStyle(styles.line))
		.children(options.leading, h.span.children(options.value))
}

function Section<M>(h: Html.H<M>, title: string, content: View.Input<M>) {
	return h.div.children(h.h2.style({...webStyle(styles.heading), margin: '0'}).children(title), content)
}

function Form<M>(h: Html.H<M>, id: string, submit: Press, children: readonly View.Input<M>[]) {
	return submit(h.form, 'submit')
		.attr('id', id)
		.children(...children)
}

function Paragraph<M>(h: Html.H<M>, text: string, alert?: boolean) {
	return h.p
		.attr('role', Boolean.match(alert === true, {onFalse: Function.constUndefined, onTrue: Function.constant('alert')}))
		.children(text)
}

function Logs<M>(h: Html.H<M>, text: string) {
	return h.pre.class('design-logs').attr('tabindex', '0').children(text)
}

function TextField<M>(h: Html.H<M>, options: FieldOptions) {
	return h.label
		.style(webStyle(styles.body))
		.children(
			options.label,
			options
				.input(h.input, 'input')
				.class('design-field')
				.attrs({
					autocapitalize: 'none',
					autocomplete: 'off',
					placeholder: options.placeholder,
					spellcheck: 'false',
					type: 'text'
				})
				.value(options.value)
				.disabled(options.disabled)
		)
}

export function webComponents<M>(): Components<Html.H<M>, PaneLeaf<View.Input<M>>, View.Content<M>> {
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
		notice: Notice,
		paragraph: Paragraph,
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
