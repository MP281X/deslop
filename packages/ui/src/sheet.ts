import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Boolean, Function} from 'effect'

import {Button} from './control.ts'
import {SymbolIcon} from './symbol.ts'
import {FitSheet} from './viewport.ts'

export function Sheet<M>(
	h: Html.H<M>,
	options: {
		className?: string
		key?: string
		title: string
		titleId: string
		close: M
		closeDisabled?: boolean
		closeLabel?: string
		closeHidden?: boolean
		action?: View.Input<M>
		submit?: M
		body: View.Input<M>
	}
) {
	const content = [
		h.div.class('axis-sheet-heading').children(
			options.closeHidden !== true &&
				Button(h, {disabled: options.closeDisabled ?? false})
					.class('axis-control axis-sheet-close')
					.attr('aria-label', options.closeLabel ?? 'Close')
					.on('click', options.close)
					.children(SymbolIcon(h, 'xmark')),
			h.h2
				.id(options.titleId)
				.attrs(
					Boolean.match(options.closeHidden === true, {
						onFalse: Function.constant({}),
						onTrue: Function.constant({autofocus: '', tabindex: '-1'})
					})
				)
				.children(options.title),
			options.action
		),
		h.div.class('axis-sheet-body').children(options.body)
	]
	function layout() {
		if (options.submit === undefined) return h.div.class('axis-sheet-content').children(content)
		return h.form.class('axis-sheet-content').on('submit', options.submit, {preventDefault: true}).children(content)
	}
	const dialog = h.dialog
		.class('axis-sheet', options.className)
		.attr('aria-labelledby', options.titleId)
		.modal(true)
		.onMount(FitSheet({}))
		.on(
			'cancel',
			() => {
				if (options.closeDisabled === true) return undefined
				return options.close
			},
			{preventDefault: true}
		)
		.children(layout())
	if (options.key === undefined) return dialog
	return dialog.key(options.key)
}
