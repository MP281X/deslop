import {Array, Option, Record, String} from 'effect'

// Each Deslop app's icon hue, as the theme names it; a service without one stays zinc grey.
export const APP_HUES: Record<string, string> = {
	auth: 'var(--slate)',
	deploy: 'var(--blue)',
	gateway: 'var(--pink)',
	opm: 'var(--ivory)',
	portfolio: 'var(--coral)',
	scope: 'var(--cyan)',
	stash: 'var(--amber)',
	trips: 'var(--orange)'
}

// Inlined with the bundle, so a bar's app marks paint with its tabs instead of appearing one by one.
const icons = import.meta.glob<string>('../../../apps/*/src/routes/icon.svg', {
	eager: true,
	import: 'default',
	query: '?inline'
})

// Every app's canonical mark, keyed by the folder its routes' icon lives in.
export const appMarks: Record<string, string> = Record.fromEntries(
	Array.flatMap(Record.toEntries(icons), entry =>
		Option.match(
			Option.flatMap(String.match(/\/(?<app>[^/]+)\/src\/routes\/icon\.svg$/u)(entry[0]), match =>
				Option.fromUndefinedOr(match.groups?.['app'])
			),
			{onNone: () => [], onSome: app => [[app, entry[1]] as const]}
		)
	)
)
