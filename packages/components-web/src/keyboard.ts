import {Array, Boolean, Number, Option} from 'effect'

import type {KeyboardEvent} from 'react'

// j and k move focus through a list's rows, stopping at its ends; modified keys stay with the browser.
export function moveRowFocus(event: KeyboardEvent<HTMLElement>, listSelector: string, rowSelector: string) {
	if (event.key !== 'j' && event.key !== 'k') return
	if (event.metaKey || event.ctrlKey || event.altKey) return
	const list = event.currentTarget.closest(listSelector)
	if (list === null) return
	const rows = Array.fromIterable(list.querySelectorAll<HTMLElement>(rowSelector))
	const current = Array.findFirstIndex(rows, row => row === document.activeElement)
	if (current < 0) return
	const next = Number.clamp(
		current + Boolean.match(event.key === 'j', {onFalse: () => -1, onTrue: () => 1}),
		{maximum: rows.length - 1, minimum: 0}
	)
	if (next === current) return
	event.preventDefault()
	Option.map(Array.get(rows, next), row => row.focus())
}
