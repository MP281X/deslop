import type {Component, View} from '@effect/ui'
import {HtmlSubscription} from '@effect/ui/html'
import type {Html} from '@effect/ui/html'

import {Boolean, Function, Schema} from 'effect'

const COMPACT_WIDTH = '(width < 640px)'
const SPLIT_SEGMENTS = '(horizontal-viewport-segments: 2), (vertical-viewport-segments: 2)'

export type Pane = typeof Pane.Type
export const Pane = Schema.Literals(['list', 'detail'])

export function singlePane() {
	return matchMedia(COMPACT_WIDTH).matches && !matchMedia(SPLIT_SEGMENTS).matches
}

// The caller reads singlePane() in update: either query changing can flip the layout.
export function watchPanes<M>(update: () => M) {
	return [HtmlSubscription.onMediaQuery(COMPACT_WIDTH, update), HtmlSubscription.onMediaQuery(SPLIT_SEGMENTS, update)]
}

export function Split<M>(
	h: Html.H<M>,
	options: {
		show: Pane
		narrow: boolean
		listHidden: boolean
		list: {label: string; content: View.Input<M>}
		detail: {label: string; content: View.Input<M>; key: string}
	}
) {
	return h.div
		.class('fold axis-split')
		.attrs({
			'data-layout': Boolean.match(options.narrow, {
				onFalse: Function.constant('split'),
				onTrue: Function.constant('single')
			}),
			'data-list-hidden': Boolean.match(options.listHidden, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('')
			}),
			'data-show': options.show
		})
		.children(
			h.section.class('fold-list').attr('aria-label', options.list.label).children(options.list.content),
			h.section
				.key(options.detail.key)
				.class('fold-detail')
				.attr('aria-label', options.detail.label)
				.children(options.detail.content)
		)
}

export function panelUpdates<Model extends {panel: unknown; narrow: boolean}, Message>() {
	return {
		Panel: ($: Component.Step<Model, Message, never>, message: {panel: NonNullable<Model['panel']>}) => {
			if ($.model.panel === message.panel) return $.set({...$.model, panel: undefined})
			return $.set({...$.model, panel: message.panel})
		},
		PanelClosed: ($: Component.Step<Model, Message, never>, message: {panel: NonNullable<Model['panel']>}) => {
			if ($.model.panel !== message.panel) return $.model
			return $.set({...$.model, panel: undefined})
		},
		Posture: ($: Component.Step<Model, Message, never>, message: {narrow: boolean}) => {
			if ($.model.narrow === message.narrow) return $.model
			return $.set({...$.model, narrow: message.narrow, panel: undefined}).viewTransition(['axis-layout'])
		}
	}
}
