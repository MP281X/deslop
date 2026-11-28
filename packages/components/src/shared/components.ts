import type {Native} from '@effect/ui-native'

import type {DateTime, Record} from 'effect'

import type {Reading} from '#src/shared/chart.ts'
import type {
	Absent,
	ButtonOptions,
	FactsOptions,
	Figure,
	LayoutOptions,
	ListOptions,
	PaneLeaf,
	Press,
	RowOptions,
	Status
} from '#src/shared/model.ts'

export type LayoutStyle = Record.ReadonlyRecord<string, string | number>
export type ViewStyle = LayoutStyle & Native.ViewStyle
export type TextStyle = LayoutStyle & Native.TextStyle

export type ViewOptions = {
	// Hidden from assistive technology on the web.
	decorative?: boolean | Absent
	key?: string | Absent
	style?: ViewStyle | Absent
}

export type ImageOptions = {pixel: boolean; size: number; source: string}

export type MetricOptions<Content> = {
	value: string
	leading?: Content | Absent
	// The iPhone gives the value a fixed column; the web always does.
	wide?: boolean | Absent
}

export type HistoryOptions = {
	empty: string
	now: DateTime.Utc
	readings: readonly Reading[]
	restarts: readonly DateTime.Utc[]
	title: string
}

export type FieldOptions = {disabled: boolean; input: Press; label: string; placeholder: string; value: string}

// What a screen's view draws with, implemented once per host: `H` is the host's element builders and `C` its content.
export type Components<H, C, S> = {
	bar: (host: H, proportion: number) => PaneLeaf<C>
	button: (host: H, options: ButtonOptions) => PaneLeaf<C>
	caption: (host: H, text: string) => PaneLeaf<C>
	facts: (host: H, options: FactsOptions) => readonly PaneLeaf<C>[]
	figures: (host: H, values: readonly Figure[]) => PaneLeaf<C>
	form: (host: H, id: string, submit: Press, children: readonly C[]) => PaneLeaf<C>
	headline: (host: H, title: string, dot?: Status) => PaneLeaf<C>
	history: (host: H, options: HistoryOptions) => PaneLeaf<C>
	image: (host: H, options: ImageOptions) => PaneLeaf<C>
	layout: (host: H, options: LayoutOptions<C> & {content: C}) => S
	listDetail: (host: H, options: ListOptions<C>) => S
	logs: (host: H, text: string) => PaneLeaf<C>
	message: (host: H, text: string, actions: readonly C[]) => PaneLeaf<C>
	metric: (host: H, options: MetricOptions<C>) => PaneLeaf<C>
	notice: (host: H, text: string, retry?: Press) => PaneLeaf<C>
	paragraph: (host: H, text: string, alert?: boolean) => PaneLeaf<C>
	// The iPhone's regular sheet detent; the web sizes the sheet to its content.
	regularSheetHeight?: number | Absent
	row: (host: H, options: RowOptions<C>) => PaneLeaf<C>
	rowWithAction: (host: H, id: string, row: C, action?: C) => PaneLeaf<C>
	section: (host: H, title: string, content: C) => PaneLeaf<C>
	skeleton: (host: H) => PaneLeaf<C>
	sparkline: (host: H, readings: readonly Reading[], now: DateTime.Utc) => PaneLeaf<C>
	text: (host: H, style: TextStyle, text: string) => PaneLeaf<C>
	textField: (host: H, options: FieldOptions) => PaneLeaf<C>
	view: (host: H, options: ViewOptions, children: readonly C[]) => PaneLeaf<C>
}
